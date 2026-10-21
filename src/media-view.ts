import type { Card, Game } from "./model";
import { playbackPosition } from "./media";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let screenMuted = false;
let currentGame: Game | undefined;
export function clueMedia(game: Game, card: Card) {
  if (!card.media || !game.mediaPlayback?.visible) return "";
  const media = card.media;
  const key = `${game.code}/${card.id}/${media.url}`;
  const content =
    media.type === "image"
      ? `<img src="${escape(media.url)}" alt="${escape(media.alt || "Clue image")}">`
      : media.type === "video"
        ? `<video class="media-element" src="${escape(media.url)}" playsinline preload="metadata" aria-label="Clue video"></video>`
        : `<div class="audio-caption" aria-hidden="true">♫<span>Audio clip</span></div><audio class="media-element" src="${escape(media.url)}" preload="metadata" aria-label="Clue audio"></audio>`;
  return `<div class="game-media" data-media-key="${escape(key)}">${content}${media.type !== "image" ? `<div class="media-local-controls"><span class="media-playback-label" role="status"></span><button data-action="media-sound">${screenMuted ? "Unmute this screen" : "Mute this screen"}</button><button class="gold" data-action="allow-playback" hidden>Enable playback on this screen</button></div>` : ""}<p class="media-notice" role="status" hidden></p></div>`;
}
export function preserveMedia(content: string, app: HTMLElement) {
  const previous = app.querySelector<HTMLElement>(".game-media");
  app.innerHTML = content;
  const next = app.querySelector<HTMLElement>(".game-media");
  if (previous && next && next.dataset.mediaKey === previous.dataset.mediaKey)
    next.replaceWith(previous);
  else previous?.querySelector<HTMLMediaElement>(".media-element")?.pause();
}
export function syncMedia(game: Game) {
  currentGame = game;
  const root = document.querySelector<HTMLElement>(".game-media");
  const media = root?.querySelector<HTMLMediaElement>(".media-element");
  const state = game.mediaPlayback;
  if (!root || !media || !state) return;
  const cueChanged = root.dataset.cue !== String(state.changedAt);
  root.dataset.cue = String(state.changedAt);
  media.muted = screenMuted;
  const label = root.querySelector<HTMLElement>(".media-playback-label")!;
  label.textContent = state.playing ? "Playing" : "Paused";
  if (cueChanged) delete root.dataset.finishedCue;
  if (state.playing && root.dataset.finishedCue === String(state.changedAt)) {
    label.textContent = "Finished";
    return;
  }
  if (!root.dataset.bound) {
    root.dataset.bound = "true";
    media.addEventListener("loadedmetadata", () => {
      if (currentGame) syncMedia(currentGame);
    });
    media.addEventListener("ended", () => {
      label.textContent = "Finished";
      root.dataset.finishedCue = root.dataset.cue;
    });
    media.addEventListener("error", () => {
      const notice = root.querySelector<HTMLElement>(".media-notice")!;
      notice.hidden = false;
      notice.textContent =
        "This file couldn’t play in this browser. Try an MP4 video or MP3 audio file.";
    });
  }
  if (media.readyState >= 1) {
    const target = Math.min(
      playbackPosition(state),
      Number.isFinite(media.duration)
        ? Math.max(0, media.duration - 0.02)
        : Infinity,
    );
    if (cueChanged || Math.abs(media.currentTime - target) > 2)
      media.currentTime = target;
  }
  if (!state.playing) {
    media.pause();
    root.querySelector<HTMLButtonElement>(
      '[data-action="allow-playback"]',
    )!.hidden = true;
  } else if (media.paused) {
    void media
      .play()
      .then(() => {
        const button = root.querySelector<HTMLButtonElement>(
          '[data-action="allow-playback"]',
        );
        if (button) button.hidden = true;
      })
      .catch(() => {
        const button = root.querySelector<HTMLButtonElement>(
          '[data-action="allow-playback"]',
        );
        if (button) button.hidden = false;
        label.textContent = "Playback needs permission on this screen";
      });
  }
}
export function enablePlayback() {
  if (
    !currentGame?.mediaPlayback?.playing ||
    !currentGame.mediaPlayback.visible
  )
    return;
  screenMuted = false;
  const media = document.querySelector<HTMLMediaElement>(
    ".game-media .media-element",
  );
  if (media) {
    media.muted = false;
    void media
      .play()
      .then(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-action="allow-playback"]',
        );
        if (button) button.hidden = true;
        const label = document.querySelector<HTMLElement>(
          ".media-playback-label",
        );
        if (label) label.textContent = "Playing";
        const sound = document.querySelector<HTMLButtonElement>(
          '[data-action="media-sound"]',
        );
        if (sound) sound.textContent = "Mute this screen";
      })
      .catch(() => {});
  }
}
export function toggleMediaSound() {
  screenMuted = !screenMuted;
  const media = document.querySelector<HTMLMediaElement>(
    ".game-media .media-element",
  );
  if (media) media.muted = screenMuted;
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="media-sound"]',
  );
  if (button)
    button.textContent = screenMuted
      ? "Unmute this screen"
      : "Mute this screen";
}
