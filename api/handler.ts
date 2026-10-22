import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { publicGame, validateBoard, type Game } from "../src/model.js";
import { buzz, createGame, hostAction } from "../server/game.js";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { MAX_MEDIA_BYTES, MEDIA_TYPES } from "../src/media.js";
import { searchAudio, audioFiles } from "../server/audio-sources.js";

let initialized: Promise<void> | undefined;
function database() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Shared games are not configured yet. Your boards are still saved on this device.",
    );
  return neon(process.env.DATABASE_URL);
}
async function init() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS jeopardy_boards (id text PRIMARY KEY, secret text NOT NULL, board jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE jeopardy_boards ADD COLUMN IF NOT EXISTS archived_at timestamptz`;
  await sql`CREATE TABLE IF NOT EXISTS jeopardy_games (code text PRIMARY KEY, host_token text NOT NULL, state jsonb NOT NULL, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now())`;
}
function same(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function secret() {
  return randomBytes(24).toString("hex");
}
type Request = IncomingMessage & { body?: unknown };
export default async function handler(req: Request, res: ServerResponse) {
  const origin = req.headers.origin;
  const allowed = [
    process.env.FRONTEND_ORIGIN || "https://dfree951.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  if (
    origin &&
    (allowed.includes(origin) || origin === `https://${req.headers.host}`)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (origin) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const send = (status: number, data: unknown) => {
    res.writeHead(status).end(JSON.stringify(data));
  };
  try {
    if (!initialized)
      initialized = init().catch((e) => {
        initialized = undefined;
        throw e;
      });
    await initialized;
    const sql = database();
    const url = new URL(req.url || "/", "https://localhost");
    const parts = (
      url.searchParams.get("route") || url.pathname.replace(/^\/api\//, "")
    )
      .split("/")
      .filter(Boolean);
    const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
    let body: Record<string, any> = {};
    if (req.method !== "GET") {
      if (req.body && typeof req.body === "object")
        body = req.body as Record<string, any>;
      else if (typeof req.body === "string") body = JSON.parse(req.body);
      else {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 200000) {
            send(413, { error: "This board is too large." });
            return;
          }
        }
        body = raw ? JSON.parse(raw) : {};
      }
      if (Buffer.byteLength(JSON.stringify(body)) > 200000) {
        send(413, { error: "This board is too large." });
        return;
      }
    }
    if (parts[0] === "audio-sources" && req.method === "GET") {
      send(
        200,
        url.searchParams.has("id")
          ? await audioFiles(url.searchParams.get("id") || "")
          : await searchAudio(url.searchParams.get("q") || ""),
      );
      return;
    }
    if (parts[0] === "media" && req.method === "POST") {
      if (!process.env.BLOB_READ_WRITE_TOKEN)
        throw new Error("Media uploads are not configured.");
      const result = await handleUpload({
        request: req,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          if (
            !/^jeopardy\/[a-f0-9-]{36}\.(jpg|png|gif|webp|mp4|webm|mp3|m4a|wav|ogg)$/.test(
              pathname,
            )
          )
            throw new Error("Invalid upload path.");
          const payload = JSON.parse(clientPayload || "{}");
          if (
            typeof payload.boardId !== "string" ||
            typeof payload.cardId !== "string"
          )
            throw new Error("Choose a clue before uploading.");
          const rows =
            await sql`SELECT board FROM jeopardy_boards WHERE id = ${payload.boardId} AND archived_at IS NULL`;
          if (
            !rows.length ||
            !rows[0].board.categories.some(
              (category: { cards: { id: string }[] }) =>
                category.cards.some((card) => card.id === payload.cardId),
            )
          )
            throw new Error("Save this clue before uploading.");
          return {
            allowedContentTypes: [...Object.values(MEDIA_TYPES).flat()],
            maximumSizeInBytes: MAX_MEDIA_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil: Date.now() + 15 * 60 * 1000,
          };
        },
      });
      send(200, result);
      return;
    }
    if (parts[0] === "boards") {
      const id = parts[1];
      if (!id && req.method === "GET") {
        const rows =
          await sql`SELECT board, archived_at FROM jeopardy_boards ORDER BY updated_at DESC`;
        send(200, {
          boards: rows
            .filter((row) => !row.archived_at)
            .map((row) => row.board),
          archivedIds: rows
            .filter((row) => row.archived_at)
            .map((row) => row.board.id),
        });
        return;
      }
      if (!id || id.length > 100) {
        send(400, { error: "Invalid board." });
        return;
      }
      const rows = await sql`SELECT * FROM jeopardy_boards WHERE id = ${id}`;
      if (rows[0]?.archived_at) {
        send(404, { error: "This game was removed from My games." });
        return;
      }
      if (parts[2] === "archive" && req.method === "POST") {
        await sql`UPDATE jeopardy_boards SET archived_at = now(), updated_at = now() WHERE id = ${id}`;
        send(200, { archived: true });
        return;
      }
      if (req.method === "GET") {
        send(
          rows.length ? 200 : 404,
          rows.length
            ? { board: rows[0].board }
            : { error: "Board not found." },
        );
        return;
      }
      if (req.method === "PUT") {
        const board = validateBoard(body.board, true);
        if (board.id !== id) throw new Error("Invalid board.");
        const saved =
          await sql`INSERT INTO jeopardy_boards (id, secret, board) VALUES (${id}, ${secret()}, ${JSON.stringify(board)}::jsonb) ON CONFLICT (id) DO UPDATE SET board = EXCLUDED.board, updated_at = now() WHERE jeopardy_boards.archived_at IS NULL RETURNING id`;
        if (!saved.length) {
          send(409, { error: "This game was removed from My games." });
          return;
        }
        send(200, { saved: true });
        return;
      }
    }
    if (parts[0] === "games" && !parts[1] && req.method === "POST") {
      if (
        !Array.isArray(body.names) ||
        body.names.some((n: unknown) => typeof n !== "string")
      )
        throw new Error("Enter team or player names.");
      for (let i = 0; i < 5; i++) {
        const code = Array.from(
          randomBytes(6),
          (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32],
        ).join("");
        const token = secret();
        const game = createGame(
          body.board,
          code,
          body.mode,
          body.format,
          body.names,
        );
        const saved =
          await sql`INSERT INTO jeopardy_games (code, host_token, state) VALUES (${code}, ${token}, ${JSON.stringify(game)}::jsonb) ON CONFLICT DO NOTHING RETURNING code`;
        if (saved.length) {
          send(201, { game, hostToken: token });
          return;
        }
      }
      throw new Error("Could not create a room. Try again.");
    }
    if (parts[0] === "games" && /^[A-Z2-9]{6}$/.test(parts[1] || "")) {
      const code = parts[1];
      for (let attempt = 0; attempt < 8; attempt++) {
        const rows =
          await sql`SELECT * FROM jeopardy_games WHERE code = ${code}`;
        if (!rows.length) {
          send(404, { error: "Room not found. Check the code." });
          return;
        }
        const row = rows[0];
        let game = row.state as Game;
        const host = same(row.host_token, auth);
        if (req.method === "GET") {
          send(200, { game: host ? game : publicGame(game) });
          return;
        }
        let result: Record<string, unknown> = {};
        if (parts[2] === "join" && req.method === "POST") {
          if (game.mode !== "buzzer" || game.status !== "lobby")
            throw new Error("This room is not accepting players.");
          let player;
          if (game.format === "teams") {
            player = game.players.find((p) => p.id === body.playerId);
            if (!player) throw new Error("Choose a team.");
            if (!player.token) player.token = secret();
          } else {
            const name = typeof body.name === "string" ? body.name.trim() : "";
            if (!name || name.length > 40)
              throw new Error("Enter a name under 40 characters.");
            if (game.players.length >= 12)
              throw new Error("This room has reached 12 players.");
            if (
              game.players.some(
                (p) => p.name.toLowerCase() === name.toLowerCase(),
              )
            )
              throw new Error("That name is already in use.");
            player = { id: randomUUID(), name, score: 0, token: secret() };
            game.players.push(player);
          }
          result = { playerId: player.id, playerToken: player.token };
          game.version++;
        } else if (parts[2] === "buzz" && req.method === "POST") {
          game = buzz(game, body.playerId, auth);
        } else if (parts[2] === "action" && req.method === "POST") {
          if (!host) {
            send(403, { error: "Only the host can control this game." });
            return;
          }
          if (body.version !== game.version) {
            send(409, { error: "The game changed. Try again." });
            return;
          }
          game = hostAction(game, body);
        } else {
          send(405, { error: "Action not supported." });
          return;
        }
        const saved =
          await sql`UPDATE jeopardy_games SET state = ${JSON.stringify(game)}::jsonb, version = ${game.version}, updated_at = now() WHERE code = ${code} AND version = ${row.version} RETURNING code`;
        if (saved.length) {
          send(200, { ...result, game: host ? game : publicGame(game) });
          return;
        }
      }
      send(409, { error: "The room is busy. Try again." });
      return;
    }
    send(404, { error: "Not found." });
  } catch (error) {
    const known =
      error instanceof Error ? error.message : "Something went wrong.";
    const internal =
      /connection|password|relation|database|syntax|fetch failed|ECONN|timeout/i.test(
        known,
      ) && !known.startsWith("Shared games");
    if (internal)
      console.error(
        "Game request failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
    send(internal ? 503 : 400, {
      error: internal
        ? "The game server is unavailable. Try again shortly."
        : known,
    });
  }
}
