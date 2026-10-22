import { test } from "node:test";
import assert from "node:assert/strict";
import { creditAllowed, youtubeId, convertYouTube } from "../server/youtube.js";

test("YouTube links accept individual videos and reject other hosts", () => {
  for (const link of [
    "https://youtube.com/watch?v=GZqi2Nv2M04",
    "https://youtu.be/GZqi2Nv2M04",
    "https://music.youtube.com/watch?v=GZqi2Nv2M04",
    "https://youtube.com/shorts/GZqi2Nv2M04",
  ])
    assert.equal(youtubeId(link), "GZqi2Nv2M04");
  for (const link of [
    "https://youtube.com.attacker.test/watch?v=GZqi2Nv2M04",
    "https://youtube.com/playlist?list=x",
    "https://user:pass@youtube.com/watch?v=GZqi2Nv2M04",
    "hello",
  ])
    assert.equal(youtubeId(link), undefined);
});
test("credits allow the last conversion and fail closed at every limit", () => {
  assert.equal(creditAllowed(990, 10, "free"), true);
  for (const [used, remaining, plan] of [
    [1000, 1000, "free"],
    [991, 1000, "free"],
    [0, 9.9, "free"],
    [0, NaN, "free"],
    [NaN, 1000, "free"],
    [0, 1000, "pro"],
    [-10, 1000, "free"],
  ] as [number, number, string][])
    assert.equal(creditAllowed(used, remaining, plan), false);
});
test("an unknown balance, paid plan, or exhausted budget never calls conversion", async (t) => {
  const old = process.env.SAVEAPI_KEY;
  process.env.SAVEAPI_KEY = "test-key";
  try {
    for (const [used, credits, plan] of [
      [0, { remaining: 9 }, { code: "free" }],
      [0, {}, { code: "free" }],
      [0, { remaining: 1000 }, { code: "pro" }],
      [1000, { remaining: 1000 }, { code: "free" }],
    ] as [number, object, object][]) {
      const calls: string[] = [];
      const mock = t.mock.method(
        globalThis,
        "fetch",
        async (url: string | URL | Request) => {
          calls.push(String(url));
          return Response.json({ success: true, credits, plan });
        },
      );
      await assert.rejects(
        () => convertYouTube("GZqi2Nv2M04", used),
        /free credit limit/,
      );
      assert.deepEqual(calls, ["https://api.saveapi.org/v1/me"]);
      mock.mock.restore();
    }
  } finally {
    if (old === undefined) delete process.env.SAVEAPI_KEY;
    else process.env.SAVEAPI_KEY = old;
  }
});
