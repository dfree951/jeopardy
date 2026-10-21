export const MEDIA_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  video: ["video/mp4", "video/webm"],
  audio: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"],
} as const;
export type MediaKind = keyof typeof MEDIA_TYPES;
export type ClueMedia = {
  url: string;
  type: MediaKind;
  contentType: string;
  name: string;
  size: number;
  alt?: string;
  displayByDefault?: boolean;
};
export type MediaPlayback = {
  visible: boolean;
  playing: boolean;
  position: number;
  changedAt: number;
};
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MEDIA_ACCEPT = Object.values(MEDIA_TYPES).flat().join(",");
export function mediaKind(contentType: string): MediaKind | undefined {
  return (Object.keys(MEDIA_TYPES) as MediaKind[]).find((kind) =>
    (MEDIA_TYPES[kind] as readonly string[]).includes(contentType),
  );
}
export function validateMedia(media: ClueMedia) {
  let url: URL;
  try {
    url = new URL(media.url);
  } catch {
    throw new Error("Invalid media link.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    !url.pathname.startsWith("/jeopardy/") ||
    url.username ||
    url.password ||
    mediaKind(media.contentType) !== media.type ||
    !["image", "audio", "video"].includes(media.type) ||
    !Number.isInteger(media.size) ||
    media.size < 1 ||
    media.size > MAX_MEDIA_BYTES ||
    typeof media.name !== "string" ||
    media.name.length > 250 ||
    (media.displayByDefault !== undefined &&
      typeof media.displayByDefault !== "boolean") ||
    (media.alt !== undefined &&
      (typeof media.alt !== "string" || media.alt.length > 300))
  )
    throw new Error("Use a supported image, video, or audio file under 50 MB.");
}
export function playbackPosition(state: MediaPlayback, now = Date.now()) {
  return (
    state.position +
    (state.playing ? Math.max(0, now - state.changedAt) / 1000 : 0)
  );
}
