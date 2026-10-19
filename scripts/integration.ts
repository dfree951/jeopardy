import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sampleBoard } from "../src/sample";

const origin = process.env.TEST_BASE_URL;
if (!origin) throw new Error("Set TEST_BASE_URL to the API host.");
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  token = "",
  expected = 200,
) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://dfree951.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://dfree951.github.io",
  );
  return body;
}
const board = sampleBoard();
board.title = "Integration check";
const key = randomBytes(24).toString("hex");
await request(`boards/${board.id}`, "PUT", { board }, key);
assert.deepEqual(
  (await request(`boards/${board.id}`, "GET", undefined, key)).board,
  board,
);
await request(`boards/${board.id}`, "GET", undefined, "", 403);
console.log("Board persistence, edit key, and cross-origin access passed.");
const created = await request(
  "games",
  "POST",
  { board, mode: "buzzer", format: "individuals", names: [] },
  "",
  201,
);
const code = created.game.code;
const one = await request(`games/${code}/join`, "POST", { name: "Player one" });
const two = await request(`games/${code}/join`, "POST", { name: "Player two" });
await request(
  `games/${code}/action`,
  "POST",
  { type: "start", version: 2 },
  "",
  403,
);
let game = (await request(`games/${code}`, "GET", undefined, created.hostToken))
  .game;
async function action(type: string, extra: Record<string, unknown> = {}) {
  game = (
    await request(
      `games/${code}/action`,
      "POST",
      { type, version: game.version, ...extra },
      created.hostToken,
    )
  ).game;
}
await action("start");
await action("select", { cardId: board.categories[0].cards[0].id });
let visible = (await request(`games/${code}`)).game;
assert.equal(visible.categories[0].cards[0].answer, "");
assert.ok(visible.categories[0].cards[0].clue);
assert.equal(visible.categories[0].cards[1].clue, "");
assert.ok(visible.players.every((p: { token?: string }) => !p.token));
await action("open");
const attempts = await Promise.all(
  [one, two].map((p) =>
    fetch(`${origin}/api/games/${code}/buzz`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.playerToken}`,
      },
      body: JSON.stringify({ playerId: p.playerId }),
    }),
  ),
);
assert.equal(attempts.filter((r) => r.status === 200).length, 1);
game = (await request(`games/${code}`, "GET", undefined, created.hostToken))
  .game;
await action("score", { playerId: game.buzzed, direction: 1 });
assert.equal(
  Math.max(...game.players.map((p: { score: number }) => p.score)),
  200,
);
await action("undo");
assert.ok(game.players.every((p: { score: number }) => p.score === 0));
await action("reveal");
visible = (await request(`games/${code}`)).game;
assert.equal(visible.categories[0].cards[0].answer, "Paris");
await action("finish");
console.log(
  "Phone joining, concurrent buzzing, hidden answers, scoring, undo, and completion passed.",
);
const screen = await request(
  "games",
  "POST",
  { board, mode: "screen", format: "teams", names: ["Team 1", "Team 2"] },
  "",
  201,
);
game = screen.game;
const screenCode = game.code;
for (const body of [
  { type: "start" },
  { type: "select", cardId: board.categories[0].cards[0].id },
  { type: "score", playerId: game.players[0].id, direction: -1 },
  { type: "finish" },
]) {
  game = (
    await request(
      `games/${screenCode}/action`,
      "POST",
      { ...body, version: game.version },
      screen.hostToken,
    )
  ).game;
}
assert.equal(game.players[0].score, -200);
console.log("Shared-screen team game passed.");
