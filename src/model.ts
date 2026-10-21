import { validateMedia, type ClueMedia, type MediaPlayback } from "./media.js";
export type Card = {
  id: string;
  value: number;
  clue: string;
  answer: string;
  media?: ClueMedia;
};
export type Category = { id: string; name: string; cards: Card[] };
export type Board = {
  id: string;
  title: string;
  categories: Category[];
  updatedAt: string;
};
export type Player = {
  id: string;
  name: string;
  score: number;
  token?: string;
  connected?: boolean;
};
export type Game = {
  code: string;
  title: string;
  mode: "screen" | "buzzer";
  format: "teams" | "individuals";
  categories: Category[];
  players: Player[];
  used: string[];
  active: string | null;
  revealed: boolean;
  buzzOpen: boolean;
  buzzed: string | null;
  attempted: string[];
  status: "lobby" | "playing" | "finished";
  version: number;
  mediaPlayback?: MediaPlayback;
  history: {
    players: Player[];
    used: string[];
    active: string | null;
    revealed: boolean;
    attempted: string[];
  }[];
};
export const uid = () => crypto.randomUUID();
export function blankBoard(): Board {
  return {
    id: uid(),
    title: "",
    updatedAt: new Date().toISOString(),
    categories: Array.from({ length: 6 }, () => ({
      id: uid(),
      name: "",
      cards: [200, 400, 600, 800, 1000].map((value) => ({
        id: uid(),
        value,
        clue: "",
        answer: "",
      })),
    })),
  };
}
export function validateBoard(input: unknown, draft = false): Board {
  const b = input as Board;
  if (
    !b ||
    typeof b.id !== "string" ||
    !b.id ||
    typeof b.title !== "string" ||
    b.title.length > 100 ||
    !Array.isArray(b.categories) ||
    b.categories.length < 1 ||
    b.categories.length > 8
  )
    throw new Error(
      "Use between 1 and 8 categories and a title under 100 characters.",
    );
  const ids = new Set<string>();
  for (const category of b.categories) {
    if (
      typeof category.id !== "string" ||
      !category.id ||
      ids.has(category.id) ||
      typeof category.name !== "string" ||
      category.name.length > 60 ||
      !Array.isArray(category.cards) ||
      category.cards.length !== 5
    )
      throw new Error(
        "Each category needs five cards and a name under 60 characters.",
      );
    ids.add(category.id);
    for (const card of category.cards) {
      if (
        typeof card.id !== "string" ||
        !card.id ||
        ids.has(card.id) ||
        !Number.isInteger(card.value) ||
        card.value < 1 ||
        card.value > 100000 ||
        typeof card.clue !== "string" ||
        typeof card.answer !== "string" ||
        card.clue.length > 2000 ||
        card.answer.length > 1000
      )
        throw new Error("Check card values and text lengths.");
      ids.add(card.id);
      if (card.media) validateMedia(card.media);
      if (!draft && !!(card.clue.trim() || card.media) !== !!card.answer.trim())
        throw new Error("Add both a clue and an answer, or leave both blank.");
    }
  }
  return b;
}
export function readyCards(board: Board) {
  return board.categories.flatMap((c) => c.cards).filter(isCardReady);
}
export function isCardReady(card: Card) {
  return !!(card.answer.trim() && (card.clue.trim() || card.media));
}
export function activeCard(game: Game) {
  return game.categories
    .flatMap((c) => c.cards)
    .find((c) => c.id === game.active);
}
export function publicGame(game: Game): Game {
  return {
    ...game,
    categories: game.categories.map((c) => ({
      ...c,
      cards: c.cards.map((card) => ({
        ...card,
        clue: card.id === game.active ? card.clue : "",
        answer: card.id === game.active && game.revealed ? card.answer : "",
        media:
          card.id === game.active && game.mediaPlayback?.visible
            ? card.media && { ...card.media, name: "Clue media" }
            : undefined,
      })),
    })),
    players: game.players.map(({ token, ...player }) => ({
      ...player,
      connected: !!token,
    })),
    history: [],
  };
}
