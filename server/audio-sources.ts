const archive = "https://archive.org";
const safeId = /^[a-zA-Z0-9_.-]{1,150}$/;
export function searchWords(query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const useful = words.filter(
    (word) =>
      ![
        "the",
        "a",
        "an",
        "song",
        "intro",
        "theme",
        "music",
        "audio",
        "clip",
        "find",
        "me",
        "please",
      ].includes(word),
  );
  return (useful.length ? useful : words).slice(0, 12);
}
export function matchScore(title: string, query: string) {
  const text = title.toLowerCase();
  return (
    searchWords(query).reduce(
      (score, word) => score + (text.includes(word) ? 10 : 0),
      0,
    ) +
    (/intro/i.test(query) && /intro/i.test(title) ? 15 : 0) +
    (/theme|song|intro/i.test(query) && /theme song/i.test(title) ? 5 : 0) -
    title.length / 1000
  );
}
async function json(url: URL | string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok)
    throw new Error(
      "Audio search is unavailable. Try again shortly or open a file from your device.",
    );
  return response.json();
}
export async function searchAudio(query: string) {
  if (!query.trim() || query.length > 200)
    throw new Error("Enter a search of up to 200 characters.");
  if (/^https?:\/\//i.test(query)) {
    const url = new URL(query);
    if (
      url.hostname !== "archive.org" ||
      !["details", "download"].includes(url.pathname.split("/")[1])
    )
      throw new Error(
        "Paste an Internet Archive link, or search by title. YouTube links cannot be converted here.",
      );
    const id = url.pathname.split("/")[2];
    const data = await audioFiles(id);
    return {
      results: [{ id, title: data.title, page: `${archive}/details/${id}` }],
    };
  }
  const words = searchWords(query);
  if (!words.length) throw new Error("Enter the name of a song or sound.");
  const url = new URL(`${archive}/advancedsearch.php`);
  url.search = new URLSearchParams({
    q: `mediatype:audio AND (${words.map((word) => `title:"${word}"`).join(" AND ")})`,
    output: "json",
    rows: "80",
    "fl[]": "identifier,title",
  }).toString();
  const data = await json(url);
  return {
    results: (data.response?.docs || [])
      .filter(
        (item: any) =>
          safeId.test(item.identifier) && typeof item.title === "string",
      )
      .sort(
        (a: any, b: any) =>
          matchScore(b.title, query) - matchScore(a.title, query),
      )
      .slice(0, 12)
      .map((item: any) => ({
        id: item.identifier,
        title: item.title,
        page: `${archive}/details/${item.identifier}`,
      })),
  };
}
export async function audioFiles(id: string) {
  if (!safeId.test(id || "")) throw new Error("Invalid audio source.");
  const data = await json(`${archive}/metadata/${id}`);
  if (data.is_dark || data.metadata?.access_restricted)
    throw new Error("This recording is not available for download.");
  const files = (data.files || [])
    .filter(
      (file: any) =>
        typeof file.name === "string" &&
        /\.mp3$/i.test(file.name) &&
        !file.private &&
        Number(file.size) > 0 &&
        Number(file.size) <= 50 * 1024 * 1024 &&
        (!file.length || Number(file.length) <= 600),
    )
    .slice(0, 60)
    .map((file: any) => ({
      name: file.name,
      size: Number(file.size),
      duration: Number(file.length) || undefined,
      url: `${archive}/download/${encodeURIComponent(id)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
    }));
  if (!files.length)
    throw new Error(
      "No downloadable MP3 under 50 MB and 10 minutes was found in this item. Choose another result.",
    );
  return { title: String(data.metadata?.title || id), files };
}
