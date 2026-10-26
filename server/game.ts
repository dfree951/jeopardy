import {
  activeCard,
  recentCardValue,
  isCardReady,
  readyCards,
  validateBoard,
  type Board,
  type Game,
} from "../src/model.js";
import { playbackPosition } from "../src/media.js";
import { randomUUID } from "node:crypto";

export function createGame(
  board: Board,
  code: string,
  mode: Game["mode"],
  format: Game["format"],
  names: string[],
): Game {
  validateBoard(board);
  if (!readyCards(board).length)
    throw new Error("Add at least one complete card before playing.");
  if (
    !["screen", "buzzer"].includes(mode) ||
    !["teams", "individuals"].includes(format)
  )
    throw new Error("Choose a play mode.");
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (
    clean.length > 12 ||
    clean.some((n) => n.length > 40) ||
    new Set(clean.map((n) => n.toLowerCase())).size !== clean.length
  )
    throw new Error("Use up to 12 unique names, each under 40 characters.");
  if ((mode === "screen" || format === "teams") && !clean.length)
    throw new Error("Add at least one team or player.");
  return {
    code,
    title: board.title.trim() || "Jeopardy",
    mode,
    format,
    categories: board.categories.map((category, index) => ({
      ...structuredClone(category),
      name: category.name.trim() || `Category ${index + 1}`,
    })),
    players: clean.map((name) => ({ id: randomUUID(), name, score: 0 })),
    used: board.categories
      .flatMap((c) => c.cards)
      .filter((c) => !isCardReady(c))
      .map((c) => c.id),
    active: null,
    revealed: false,
    buzzOpen: false,
    buzzed: null,
    attempted: [],
    status: "lobby",
    version: 0,
    history: [],
  };
}
export function hostAction(game: Game, action: Record<string, unknown>): Game {
  const g = structuredClone(game);
  const card = activeCard(g);
  let undoScoreOnly = false;
  switch (action.type) {
    case "start":
      if (g.status !== "lobby" || !g.players.length)
        throw new Error("Wait for at least one player to join.");
      g.status = "playing";
      break;
    case "select": {
      if (g.status !== "playing" || g.active)
        throw new Error("Return to the board before selecting a clue.");
      const next = g.categories
        .flatMap((c) => c.cards)
        .find((c) => c.id === action.cardId);
      if (!next || g.used.includes(next.id))
        throw new Error("That card is unavailable.");
      g.active = next.id;
      g.lastCardValue = next.value;
      g.revealed = false;
      g.buzzOpen = false;
      g.buzzed = null;
      g.attempted = [];
      break;
    }
    case "reveal":
      if (!card) throw new Error("Select a clue first.");
      g.revealed = true;
      g.buzzOpen = false;
      break;
    case "media": {
      if (g.status !== "playing" || !card?.media)
        throw new Error("This clue has no media.");
      const previous = g.mediaPlayback;
      const now = Date.now();
      const command = action.command;
      if (
        !["show", "hide", "play", "pause", "replay"].includes(command as string)
      )
        throw new Error("Unknown media control.");
      if (
        card.media.type === "image" &&
        !["show", "hide"].includes(command as string)
      )
        throw new Error("Images can be shown or hidden.");
      g.mediaPlayback = {
        visible: command !== "hide",
        playing: command === "play" || command === "replay",
        position:
          command === "replay" || command === "hide"
            ? 0
            : previous
              ? playbackPosition(previous, now)
              : 0,
        changedAt: now,
      };
      break;
    }
    case "open":
      if (!card || g.revealed || g.mode !== "buzzer")
        throw new Error("Buzzers are unavailable.");
      g.buzzOpen = true;
      g.buzzed = null;
      break;
    case "close":
      g.buzzOpen = false;
      break;
    case "edit-score": {
      if (!["playing", "finished"].includes(g.status))
        throw new Error("Start the game before editing scores.");
      const player = g.players.find((player) => player.id === action.playerId);
      if (!player) throw new Error("Choose a team or player.");
      let score: number;
      if (action.direction !== undefined) {
        const value = recentCardValue(g);
        if (!value || ![1, -1].includes(action.direction as number))
          throw new Error("Select a clue before using its value.");
        score = player.score + value * (action.direction as number);
      } else score = action.score as number;
      if (!Number.isSafeInteger(score) || Math.abs(score) > 1000000000)
        throw new Error(
          "Enter a whole-number score between −1,000,000,000 and 1,000,000,000.",
        );
      g.history.push({
        players: structuredClone(g.players),
        used: [...g.used],
        active: g.active,
        revealed: g.revealed,
        attempted: [...g.attempted],
        scoreEdit: true,
      });
      g.history = g.history.slice(-50);
      player.score = score;
      break;
    }
    case "score": {
      if (!card || g.status !== "playing")
        throw new Error("Select a clue first.");
      const player = g.players.find((p) => p.id === action.playerId);
      if (!player || ![1, -1].includes(action.direction as number))
        throw new Error("Choose a player and result.");
      if (g.mode === "buzzer" && g.buzzed !== player.id)
        throw new Error("Score the player who buzzed in.");
      if (g.attempted.includes(player.id))
        throw new Error("This player has already answered this clue.");
      g.history.push({
        players: structuredClone(g.players),
        used: [...g.used],
        active: g.active,
        revealed: g.revealed,
        attempted: [...g.attempted],
      });
      g.history = g.history.slice(-50);
      player.score += card.value * (action.direction as number);
      g.attempted.push(player.id);
      g.buzzed = null;
      g.buzzOpen = false;
      if (action.direction === 1) {
        g.used.push(card.id);
        g.active = null;
        g.revealed = false;
      }
      break;
    }
    case "finish-card":
      if (!card) throw new Error("Select a clue first.");
      g.history.push({
        players: structuredClone(g.players),
        used: [...g.used],
        active: g.active,
        revealed: g.revealed,
        attempted: [...g.attempted],
      });
      g.used.push(card.id);
      g.active = null;
      g.revealed = false;
      g.buzzOpen = false;
      g.buzzed = null;
      break;
    case "undo": {
      const previous = g.history.pop();
      if (!previous) throw new Error("Nothing to undo.");
      undoScoreOnly = !!previous.scoreEdit;
      if (undoScoreOnly) g.players = previous.players;
      else {
        Object.assign(g, previous);
        g.buzzOpen = false;
        g.buzzed = null;
        g.status = "playing";
      }
      break;
    }
    case "finish":
      g.status = "finished";
      g.active = null;
      g.buzzOpen = false;
      g.buzzed = null;
      break;
    default:
      throw new Error("Unknown action.");
  }
  if (
    g.active !== game.active ||
    (action.type === "undo" && !undoScoreOnly) ||
    g.status === "finished"
  )
    g.mediaPlayback =
      action.type === "select" &&
      activeCard(g)?.media &&
      activeCard(g)!.media!.displayByDefault !== false
        ? { visible: true, playing: false, position: 0, changedAt: Date.now() }
        : undefined;
  if (
    g.status === "playing" &&
    g.categories.every((c) => c.cards.every((c) => g.used.includes(c.id)))
  )
    g.status = "finished";
  g.version++;
  return g;
}
export function buzz(game: Game, playerId: string, token: string): Game {
  if (
    game.status !== "playing" ||
    !game.active ||
    !game.buzzOpen ||
    game.buzzed ||
    game.revealed
  )
    throw new Error("Buzzers are closed.");
  if (!game.players.some((p) => p.id === playerId && p.token === token))
    throw new Error("Join the game first.");
  if (game.attempted.includes(playerId))
    throw new Error("You have already answered this clue.");
  return {
    ...game,
    buzzed: playerId,
    buzzOpen: false,
    version: game.version + 1,
  };
}
