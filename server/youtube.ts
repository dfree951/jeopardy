import { Innertube, Log } from "youtubei.js";
import { put } from "@vercel/blob";
import { MAX_MEDIA_BYTES } from "../src/media.js";

Log.setLevel(0);
let client: ReturnType<typeof Innertube.create> | undefined;
export const SOURCE_CREDIT_LIMIT = 1000;
export const CONVERSION_CREDITS = 10;
export function creditAllowed(
  reserved: number,
  remaining: number,
  plan: string,
) {
  return (
    plan === "free" &&
    Number.isFinite(reserved) &&
    reserved >= 0 &&
    reserved + CONVERSION_CREDITS <= SOURCE_CREDIT_LIMIT &&
    Number.isFinite(remaining) &&
    remaining >= CONVERSION_CREDITS
  );
}
export function youtubeId(query: string) {
  let url: URL;
  try {
    url = new URL(query);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password)
    return undefined;
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const id =
    host === "youtu.be"
      ? url.pathname.split("/")[1]
      : host === "youtube.com"
        ? url.pathname === "/watch"
          ? url.searchParams.get("v")
          : /^\/(shorts|embed)\//.test(url.pathname)
            ? url.pathname.split("/")[2]
            : undefined
        : undefined;
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
}
export async function searchYouTube(query: string) {
  if (!query.trim() || query.length > 200)
    throw new Error("Enter a search of up to 200 characters.");
  const id = youtubeId(query);
  if (id)
    return {
      results: [
        {
          id,
          title: "YouTube video",
          page: `https://www.youtube.com/watch?v=${id}`,
          provider: "youtube",
        },
      ],
    };
  if (/^https?:/i.test(query))
    throw new Error("Paste a YouTube video link or search by title.");
  client ??= Innertube.create({ retrieve_player: false }).catch((error) => {
    client = undefined;
    throw error;
  });
  const result = await (await client).search(query, { type: "video" });
  const videos = result.videos as unknown as {
    id: string;
    title: { toString(): string };
    duration?: { seconds: number; text: string };
    author?: { name: string };
    is_live?: boolean;
  }[];
  return {
    results: videos
      .filter(
        (video) =>
          !video.is_live &&
          video.duration?.seconds &&
          video.duration.seconds <= 600,
      )
      .slice(0, 8)
      .map((video) => ({
        id: video.id,
        title: String(video.title),
        page: `https://www.youtube.com/watch?v=${video.id}`,
        provider: "youtube",
        detail: `${video.author?.name || "YouTube"} · ${video.duration?.text || ""}`,
      })),
  };
}
async function saveRequest(path: string, params?: URLSearchParams) {
  const key = process.env.SAVEAPI_KEY;
  if (!key) throw new Error("YouTube audio sourcing is not configured yet.");
  const response = await fetch(
    `https://api.saveapi.org/v1/${path}${params ? `?${params}` : ""}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(35000),
      redirect: "error",
    },
  );
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    const code = data.error?.code;
    if (code === "QUOTA_EXCEEDED")
      throw new Error(
        "The free YouTube conversion credits have been used. You can still search Internet Archive or open a file.",
      );
    if (code === "RATE_LIMITED")
      throw new Error(
        "The audio service is busy. Wait a minute and try again.",
      );
    throw new Error(
      "This YouTube recording could not be retrieved. Try another video.",
    );
  }
  return data;
}
export async function convertYouTube(id: string, reservedBefore: number) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id))
    throw new Error("Choose a YouTube video.");
  // /me is free. Never call a credit-consuming route with an unknown plan or balance.
  const account = await saveRequest("me");
  if (
    !creditAllowed(
      reservedBefore,
      Number(account.credits?.remaining),
      account.plan?.code,
    )
  )
    throw new Error(
      "YouTube conversion is stopped at the free credit limit. You can still search Internet Archive or open a file.",
    );
  const data = await saveRequest(
    "youtube/create",
    new URLSearchParams({
      url: `https://www.youtube.com/watch?v=${id}`,
      quality: "m4a",
    }),
  );
  const url = new URL(data.url);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "saveapi.org" || url.hostname.endsWith(".saveapi.org")
    ) ||
    url.username ||
    url.password
  )
    throw new Error("The audio service returned an invalid download link.");
  if (
    Number(data.file_size) > MAX_MEDIA_BYTES ||
    Number(data.duration_seconds) > 600
  )
    throw new Error("Choose a recording under 10 minutes and 50 MB.");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(50000),
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error("The audio download failed. Try another recording.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error("This recording is over 50 MB.");
    }
    chunks.push(chunk.value);
  }
  if (
    !size ||
    /text\/html|application\/json/.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new Error("The service did not return an audio recording.");
  const source = await put(`sources/youtube/${id}.m4a`, Buffer.concat(chunks), {
    access: "public",
    addRandomSuffix: true,
    contentType: "audio/mp4",
  });
  return {
    url: source.url,
    contentType: "audio/mp4",
    name: `${String(data.title || data.filename || "YouTube recording").replace(/\.m4a$/i, "")}.m4a`,
    size,
  };
}
