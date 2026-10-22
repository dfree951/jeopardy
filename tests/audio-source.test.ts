import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchWords,
  matchScore,
  searchAudio,
  audioFiles,
} from "../server/audio-sources.js";
import { trimBounds, pcm16 } from "../src/audio-trim.js";
test("description searches retain the subject and rank an intro above alternate songs", () => {
  assert.deepEqual(searchWords("powerpuff girls intro song"), [
    "powerpuff",
    "girls",
  ]);
  assert.ok(
    matchScore(
      "Powerpuff Girls - Intro - Theme Song",
      "powerpuff girls intro song",
    ) >
      matchScore(
        "Powerpuff Girls - Ending - Theme Song",
        "powerpuff girls intro song",
      ),
  );
});
test("source lookup rejects arbitrary URLs and invalid identifiers", async () => {
  await assert.rejects(
    () => searchAudio("https://localhost/private"),
    /Internet Archive/,
  );
  await assert.rejects(
    () => searchAudio("https://youtube.com/watch?v=abc"),
    /YouTube/,
  );
  await assert.rejects(() => audioFiles("../private"), /Invalid/);
});
test("trim validation prevents reversed, out of range, and overlong clips", () => {
  assert.deepEqual(trimBounds(2.5, 8, 10), { start: 2.5, end: 8 });
  for (const range of [
    [-1, 5, 10],
    [5, 4, 10],
    [2, 11, 10],
    [0, 121, 130],
    [NaN, 5, 10],
  ]) {
    assert.throws(() => trimBounds(...(range as [number, number, number])));
  }
  assert.deepEqual(
    [...pcm16(new Float32Array([-2, -1, 0, 1, 2]))],
    [-32768, -32768, 0, 32767, 32767],
  );
});
