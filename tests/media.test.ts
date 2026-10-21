import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankBoard,
  publicGame,
  activeCard,
  readyCards,
  validateBoard,
  type Game,
} from "../src/model";
import { createGame, hostAction } from "../server/game";
import {
  MAX_MEDIA_BYTES,
  playbackPosition,
  validateMedia,
  type ClueMedia,
} from "../src/media";

const file: ClueMedia = {
  url: "https://test.public.blob.vercel-storage.com/jeopardy/test.wav",
  type: "audio",
  contentType: "audio/wav",
  name: "answer.wav",
  size: 100,
  displayByDefault: false,
};
function mediaGame(type: ClueMedia["type"] = "audio") {
  const board = blankBoard();
  board.categories[0].cards[0].media =
    type === "image" ? { ...file, type, contentType: "image/png" } : file;
  board.categories[0].cards[0].answer = "Answer";
  validateBoard(board);
  assert.equal(readyCards(board).length, 1);
  let game = createGame(board, "ABC234", "screen", "teams", ["Team 1"]);
  game = hostAction(game, { type: "start" });
  return hostAction(game, {
    type: "select",
    cardId: board.categories[0].cards[0].id,
  });
}
test("default attachments display on selection without starting playback", () => {
  for (const type of ["image", "video", "audio"] as const) {
    for (const displayByDefault of [true, undefined]) {
      const board = blankBoard();
      const card = board.categories[0].cards[0];
      card.answer = "Answer";
      card.media = {
        ...file,
        type,
        contentType:
          type === "image"
            ? "image/png"
            : type === "video"
              ? "video/mp4"
              : "audio/wav",
        displayByDefault,
      };
      let game = createGame(board, "ABC234", "screen", "teams", ["Team 1"]);
      game = hostAction(game, { type: "start" });
      game = hostAction(game, { type: "select", cardId: card.id });
      assert.equal(game.mediaPlayback?.visible, true);
      assert.equal(game.mediaPlayback?.playing, false);
      assert.equal(game.mediaPlayback?.position, 0);
      assert.ok(activeCard(publicGame(game))?.media);
    }
  }
});
test("media-only clues are optional and stay hidden until the host shows them", () => {
  let game = mediaGame();
  assert.equal(activeCard(publicGame(game))?.media, undefined);
  game = hostAction(game, { type: "media", command: "play" });
  assert.equal(activeCard(publicGame(game))?.media?.url, file.url);
  assert.equal(activeCard(publicGame(game))?.media?.name, "Clue media");
  assert.equal(activeCard(publicGame(game))?.answer, "");
  game = hostAction(game, { type: "media", command: "hide" });
  assert.equal(activeCard(publicGame(game))?.media, undefined);
  assert.equal(game.mediaPlayback?.playing, false);
});
test("pause holds position, replay starts at zero, and returning to the board clears playback", () => {
  let game = mediaGame();
  game = hostAction(game, { type: "media", command: "play" });
  game.mediaPlayback!.changedAt -= 5000;
  game = hostAction(game, { type: "media", command: "pause" });
  assert.ok(game.mediaPlayback!.position >= 5);
  assert.equal(game.mediaPlayback!.playing, false);
  game = hostAction(game, { type: "media", command: "replay" });
  assert.equal(game.mediaPlayback!.position, 0);
  assert.equal(game.mediaPlayback!.playing, true);
  game = hostAction(game, { type: "finish-card" });
  assert.equal(game.mediaPlayback, undefined);
  assert.equal(publicGame(game).categories[0].cards[0].media, undefined);
  game = hostAction(game, { type: "undo" });
  assert.equal(game.mediaPlayback, undefined);
});
test("images support show/hide and reject playback commands", () => {
  let game = mediaGame("image");
  assert.throws(() => hostAction(game, { type: "media", command: "play" }));
  game = hostAction(game, { type: "media", command: "show" });
  assert.equal(game.mediaPlayback?.visible, true);
});
test("unsafe URLs, unsupported types, and oversize media are rejected", () => {
  validateMedia(file);
  assert.throws(() => validateMedia({ ...file, url: "javascript:alert(1)" }));
  assert.throws(() =>
    validateMedia({ ...file, url: "https://example.com/file.wav" }),
  );
  assert.throws(() => validateMedia({ ...file, contentType: "image/svg+xml" }));
  assert.throws(() => validateMedia({ ...file, size: MAX_MEDIA_BYTES + 1 }));
  assert.equal(
    playbackPosition(
      { visible: true, playing: false, position: 4, changedAt: 0 },
      10000,
    ),
    4,
  );
});
