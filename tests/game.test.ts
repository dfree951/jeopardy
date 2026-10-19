import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleBoard } from "../src/sample";
import { activeCard, publicGame, validateBoard } from "../src/model";
import { createGame, hostAction, buzz } from "../server/game";

function playing(mode: "screen" | "buzzer" = "screen") {
  let game = createGame(sampleBoard(), "ABC234", mode, "teams", ["Dan", "Syd"]);
  game = hostAction(game, { type: "start" });
  return hostAction(game, {
    type: "select",
    cardId: game.categories[0].cards[0].id,
  });
}
test("public state conceals unselected clues, unrevealed answers, and credentials", () => {
  const game = playing();
  game.players[0].token = "private";
  let state = publicGame(game);
  assert.equal(activeCard(state)?.clue, activeCard(game)?.clue);
  assert.equal(activeCard(state)?.answer, "");
  assert.equal(state.categories[0].cards[1].clue, "");
  assert.equal(state.players[0].token, undefined);
  assert.deepEqual(state.history, []);
  state = publicGame(hostAction(game, { type: "reveal" }));
  assert.equal(activeCard(state)?.answer, activeCard(game)?.answer);
});
test("scoring supports incorrect answers, another player, and undo", () => {
  let game = playing();
  const id = game.active;
  game = hostAction(game, {
    type: "score",
    playerId: game.players[0].id,
    direction: -1,
  });
  assert.equal(game.players[0].score, -200);
  assert.equal(game.active, id);
  assert.throws(() =>
    hostAction(game, {
      type: "score",
      playerId: game.players[0].id,
      direction: -1,
    }),
  );
  game = hostAction(game, {
    type: "score",
    playerId: game.players[1].id,
    direction: 1,
  });
  assert.equal(game.players[1].score, 200);
  assert.equal(game.active, null);
  game = hostAction(game, { type: "undo" });
  assert.equal(game.players[1].score, 0);
  assert.equal(game.players[0].score, -200);
  assert.equal(game.active, id);
  assert.equal(game.used.includes(id!), false);
});
test("buzzing requires a player token and an open clue, and locks out the second buzz", () => {
  let game = playing("buzzer");
  game.players[0].token = "one";
  game.players[1].token = "two";
  assert.throws(() => buzz(game, game.players[0].id, "one"));
  game = hostAction(game, { type: "open" });
  assert.throws(() => buzz(game, game.players[0].id, "wrong"));
  game = buzz(game, game.players[0].id, "one");
  assert.equal(game.buzzed, game.players[0].id);
  assert.throws(() => buzz(game, game.players[1].id, "two"));
  assert.throws(() =>
    hostAction(game, {
      type: "score",
      playerId: game.players[1].id,
      direction: 1,
    }),
  );
  game = hostAction(game, {
    type: "score",
    playerId: game.players[0].id,
    direction: -1,
  });
  game = hostAction(game, { type: "open" });
  assert.throws(() => buzz(game, game.players[0].id, "one"));
  game = buzz(game, game.players[1].id, "two");
  assert.equal(game.buzzed, game.players[1].id);
});
test("a game finishes when all playable cards are used, and undo reopens it", () => {
  const board = sampleBoard();
  board.categories.forEach((category, i) =>
    category.cards.forEach((card, j) => {
      if (i || j) {
        card.clue = "";
        card.answer = "";
      }
    }),
  );
  let game = createGame(board, "ABC234", "screen", "individuals", ["Dan"]);
  game = hostAction(game, { type: "start" });
  game = hostAction(game, {
    type: "select",
    cardId: board.categories[0].cards[0].id,
  });
  game = hostAction(game, { type: "finish-card" });
  assert.equal(game.status, "finished");
  game = hostAction(game, { type: "undo" });
  assert.equal(game.status, "playing");
  assert.ok(game.active);
});
test("imports reject duplicate card IDs, partial clues, and invalid values", () => {
  const board = sampleBoard();
  board.categories[0].cards[0].answer = "";
  assert.throws(() => validateBoard(board));
  board.categories[0].cards[0].answer = "Paris";
  board.categories[0].cards[0].value = -1;
  assert.throws(() => validateBoard(board));
  board.categories[0].cards[0].value = 200;
  board.categories[0].cards[1].id = board.categories[0].cards[0].id;
  assert.throws(() => validateBoard(board));
});
