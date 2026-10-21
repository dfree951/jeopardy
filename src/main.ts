import "./style.css";
import {
  activeCard,
  isCardReady,
  blankBoard,
  readyCards,
  uid,
  validateBoard,
  type Board,
  type Card,
  type Game,
} from "./model";
import { sampleBoard } from "./sample";
import { upload } from "@vercel/blob/client";
import {
  MAX_MEDIA_BYTES,
  MEDIA_ACCEPT,
  mediaKind,
  type ClueMedia,
} from "./media";
import {
  clueMedia,
  preserveMedia,
  syncMedia,
  enablePlayback,
  toggleMediaSound,
} from "./media-view";
const uploadingCards = new Set<string>();

const app = document.querySelector<HTMLDivElement>("#app")!;
const apiOrigin = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`;
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("Device storage is full. Export your board to keep a copy.", true);
  }
}
let boards = read<Board[]>("jeopardy.boards", []);
let board: Board | undefined;
let selected: string | null = null;
let game: Game | undefined;
let hostToken = "";
let playerId = "";
let playerToken = "";
let view = "";
let poll: ReturnType<typeof setInterval> | undefined;
let pollInFlight = false;
let busy = false;
let toastTimer: ReturnType<typeof setTimeout>;
let lastGameRender = "";
let routeGeneration = 0;
const pendingSaves = new Map<string, Board>();
const syncErrors = new Map<string, string>();
let syncTimer: ReturnType<typeof setTimeout>;
let syncPromise: Promise<void> | undefined;
function updateSaveStatus() {
  const state = document.querySelector("#save-state");
  if (!state || !board) return;
  state
    .closest(".save-line")
    ?.setAttribute(
      "data-state",
      syncErrors.has(board.id)
        ? "error"
        : pendingSaves.has(board.id)
          ? "saving"
          : "saved",
    );
  state.textContent =
    syncErrors.get(board.id) ||
    (pendingSaves.has(board.id) ? "Saving…" : "Saved");
}
function queueSave(value: Board) {
  pendingSaves.set(value.id, structuredClone(value));
  syncErrors.delete(value.id);
  store("jeopardy.pending", [...pendingSaves.keys()]);
  updateSaveStatus();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void flushSaves(), 700);
}
function flushSaves(): Promise<void> {
  clearTimeout(syncTimer);
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const failed = new Set<string>();
    while (pendingSaves.size) {
      const entry = [...pendingSaves].find(([id]) => !failed.has(id));
      if (!entry) break;
      const [id, snapshot] = entry;
      try {
        validateBoard(snapshot, true);
        await api(`boards/${id}`, "PUT", { board: snapshot });
        if (pendingSaves.get(id) === snapshot) pendingSaves.delete(id);
        syncErrors.delete(id);
      } catch (error) {
        failed.add(id);
        syncErrors.set(id, "Not synced. Saved on this device; retrying.");
      }
      store("jeopardy.pending", [...pendingSaves.keys()]);
      updateSaveStatus();
    }
  })().finally(() => {
    syncPromise = undefined;
    if (pendingSaves.size)
      syncTimer = setTimeout(() => void flushSaves(), 10000);
  });
  return syncPromise;
}

function toast(message: string, error = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 5000);
}
async function api(path: string, method = "GET", body?: unknown, token = "") {
  const response = await fetch(`${apiOrigin}/api/${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "The game server did not respond. Try again." }));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
function navigate(hash: string) {
  location.hash = hash;
}
function page(title: string, body: string, tools = "") {
  app
    .querySelectorAll<HTMLMediaElement>("audio, video")
    .forEach((media) => media.pause());
  document.body.className = "";
  app.innerHTML = `<header class="site-header"><a class="wordmark" href="#library" aria-label="Jeopardy home">JEOPARDY<span>!</span></a><nav aria-label="Main navigation"><a href="#library" ${["library", "edit", "setup"].includes(view) ? 'aria-current="page"' : ""}>My games</a><a href="#join" ${view === "join" ? 'aria-current="page"' : ""}>Join a game</a></nav></header><main class="workspace"><div class="page-heading"><h1>${esc(title)}</h1><div class="actions">${tools}</div></div>${body}</main>`;
}
function persistBoard(value = board) {
  if (!value) return;
  value.updatedAt = new Date().toISOString();
  boards = [value, ...boards.filter((b) => b.id !== value.id)];
  store("jeopardy.boards", boards);
  queueSave(value);
}
function saveDownload(board: Board) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${board.title.replace(/[^\w-]+/g, "-").toLowerCase() || "jeopardy"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function library() {
  page(
    "My games",
    `<div class="library-intro"><p>Create a board, add your clues, and choose how to play.</p><button class="text-button" data-action="sample">Try a sample game <span aria-hidden="true">↗</span></button></div>${boards.length ? `<div class="game-list">${boards.map((b) => `<article class="game-row"><div class="game-thumbnail" aria-hidden="true">${Array.from({ length: 12 }, () => "<i></i>").join("")}</div><div class="game-details"><h2><a href="#edit/${esc(b.id)}">${esc(b.title.trim() || "Jeopardy")}</a></h2><p>${b.categories.length} categories <span>·</span> ${readyCards(b).length} of ${b.categories.length * 5} cards ready</p></div><div class="row-actions"><a class="button primary" href="#setup/${esc(b.id)}">Play</a><a class="button" href="#edit/${esc(b.id)}">Edit</a><button class="icon-button" data-action="delete" data-id="${esc(b.id)}" aria-label="Delete ${esc(b.title.trim() || "Jeopardy")}">×</button></div></article>`).join("")}</div>` : `<section class="empty-state"><div class="empty-board" aria-hidden="true"><span>?</span><span>?</span><span>?</span></div><h2>No games yet.</h2><p>Add categories and clues, or try the sample game.</p><button class="primary" data-action="new">Create a game</button></section>`}<section class="resume-section">${Object.entries(
      read<Record<string, string>>("jeopardy.hosts", {}),
    )
      .map(
        ([code]) =>
          `<a class="resume-link" href="#host/${esc(code)}">Resume room ${esc(code)} <span>→</span></a>`,
      )
      .join(
        "",
      )}</section><input type="file" id="import-file" accept="application/json,.json" hidden>`,
    '<button data-action="refresh-library">Refresh</button><button data-action="import">Import</button><button class="primary" data-action="new">+ Create a game</button>',
  );
  if (libraryMessage) {
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = libraryMessage;
    document.querySelector(".page-heading")!.after(message);
  }
}
let libraryLoading = false;
let libraryMessage = "";
async function loadLibrary() {
  const generation = routeGeneration;
  libraryLoading = true;
  libraryMessage = "Loading saved games…";
  library();
  try {
    await flushSaves();
    const result = await api("boards");
    const remote = (result.boards as unknown[]).map((value) =>
      validateBoard(value, true),
    );
    const archived = new Set<string>(result.archivedIds || []);
    for (const id of archived) pendingSaves.delete(id);
    const byId = new Map(remote.map((value) => [value.id, value]));
    for (const local of boards) {
      if (archived.has(local.id)) continue;
      if (pendingSaves.has(local.id)) byId.set(local.id, local);
      else if (!byId.has(local.id)) {
        byId.set(local.id, local);
        queueSave(local);
      }
    }
    boards = [...byId.values()];
    store("jeopardy.boards", boards);
    store("jeopardy.pending", [...pendingSaves.keys()]);
    libraryMessage = "";
  } catch {
    libraryMessage =
      "Couldn’t load saved games. Showing device copies. Try Refresh.";
  } finally {
    libraryLoading = false;
    if (view === "library" && generation === routeGeneration) library();
  }
}
function editor() {
  if (!board) return;
  if (board.title === "Untitled game") {
    board.title = "";
    board.categories.forEach((category, index) => {
      if (category.name === `Category ${index + 1}`) category.name = "";
    });
    persistBoard();
  }
  if (
    !selected ||
    !board.categories.some((c) => c.cards.some((card) => card.id === selected))
  )
    selected = board.categories[0].cards[0].id;
  page(
    "Edit game",
    `<div class="editor-title"><label for="board-title">Game title</label><input id="board-title" maxlength="100" placeholder="Jeopardy" value="${esc(board.title)}"><div class="save-line"><span class="status-dot"></span><span id="save-state" role="status">Saving…</span></div></div><div class="editor-layout"><section class="board-editor" aria-label="Categories and cards"><div class="section-heading"><h2>Board</h2><span id="card-count">${readyCards(board).length} / ${board.categories.length * 5} cards ready</span></div><div class="edit-grid" style="--columns:${board.categories.length}">${board.categories.map((c, index) => `<div class="edit-category"><div class="category-name"><label class="sr-only" for="category-${index}">Category ${index + 1}</label><input id="category-${index}" data-category="${esc(c.id)}" maxlength="60" placeholder="Category ${index + 1}" value="${esc(c.name)}"><button class="remove-category" data-action="remove-category" data-id="${esc(c.id)}" aria-label="Remove ${esc(c.name.trim() || `Category ${index + 1}`)}" ${board!.categories.length === 1 ? "disabled" : ""}>×</button></div>${c.cards.map((card) => `<button class="edit-card ${card.id === selected ? "selected" : ""} ${isCardReady(card) ? "complete" : ""}" data-action="edit-card" data-id="${esc(card.id)}" aria-pressed="${card.id === selected}" aria-label="${esc(c.name.trim() || `Category ${index + 1}`)}, ${money(card.value)}, ${isCardReady(card) ? "ready" : "empty"}"><strong>${money(card.value)}</strong><span>${isCardReady(card) ? "Ready" : "Add clue"}</span></button>`).join("")}</div>`).join("")}</div><button class="text-button add-category" data-action="add-category" ${board.categories.length >= 8 ? "disabled" : ""}>+ Add category</button></section><aside class="card-editor" id="card-editor"></aside></div><footer class="editor-footer"><p>Changes save automatically and appear in My games on every device.</p><button data-action="export">Export game</button></footer>`,
    `<a class="button" href="#library">Done</a><button data-action="share-edit">Share edit link</button><a class="button primary" href="#setup/${esc(board.id)}">Play game →</a>`,
  );
  renderCardEditor();
  updateSaveStatus();
}
function renderCardEditor() {
  app
    .querySelectorAll<HTMLMediaElement>(
      ".media-preview audio, .media-preview video",
    )
    .forEach((media) => media.pause());
  const category = board?.categories.find((c) =>
    c.cards.some((c) => c.id === selected),
  );
  const card = category?.cards.find((c) => c.id === selected);
  if (!card) return;
  document.querySelector("#card-editor")!.innerHTML =
    `<div class="section-heading"><h2>Card details</h2><span>${esc(category!.name.trim() || `Category ${board!.categories.indexOf(category!) + 1}`)}</span></div><label for="card-value">Value</label><div class="value-input"><span>$</span><input type="number" id="card-value" min="1" max="100000" step="1" value="${card.value}"></div><label for="card-clue">Clue <span>Shown to players</span></label><textarea id="card-clue" maxlength="2000" rows="6" placeholder="Enter the clue…">${esc(card.clue)}</textarea><label for="card-answer">Answer <span>Hidden until revealed</span></label><textarea id="card-answer" maxlength="1000" rows="3" placeholder="Enter the answer…">${esc(card.answer)}</textarea><section class="media-editor"><label for="card-media">Media <span>Optional</span></label><input type="file" id="card-media" accept="${MEDIA_ACCEPT}" ${uploadingCards.has(card.id) ? "disabled" : ""}><p class="field-help">JPG, PNG, GIF, WebP, MP4, WebM, MP3, M4A, WAV, or OGG. Up to 50 MB.</p><p id="upload-progress" role="status">${uploadingCards.has(card.id) ? "Uploading…" : ""}</p>${card.media ? `<label class="media-default" for="media-default"><input type="checkbox" id="media-default" ${card.media.displayByDefault !== false ? "checked" : ""}>Display by default</label><p class="field-help">Video and audio stay paused until the host presses Play.</p><div class="media-preview">${card.media.type === "image" ? `<img src="${esc(card.media.url)}" alt="${esc(card.media.alt || "Clue image")}">` : `<${card.media.type} src="${esc(card.media.url)}" controls preload="metadata" ${card.media.type === "video" ? "playsinline" : ""}></${card.media.type}>`}<p>${esc(card.media.name)}</p><button class="text-button" data-action="remove-media">Remove media</button></div>${card.media.type === "image" ? `<label for="media-alt">Image description</label><input id="media-alt" maxlength="300" placeholder="Describe the picture" value="${esc(card.media.alt || "")}">` : ""}` : ""}</section><div class="card-editor-footer"><button class="text-button" data-action="clear-card" ${uploadingCards.has(card.id) ? "disabled" : ""}>Clear card</button><button data-action="next-card">Next card →</button></div>`;
}
async function uploadMedia(file: File) {
  if (!board || !selected || uploadingCards.has(selected)) return;
  const type = mediaKind(file.type);
  if (!type || file.size < 1 || file.size > MAX_MEDIA_BYTES) {
    toast("Choose a supported image, video, or audio file under 50 MB.", true);
    return;
  }
  const targetBoard = board;
  const targetCard = board.categories
    .flatMap((c) => c.cards)
    .find((c) => c.id === selected)!;
  uploadingCards.add(targetCard.id);
  renderCardEditor();
  try {
    persistBoard(targetBoard);
    await flushSaves();
    if (pendingSaves.has(targetBoard.id))
      throw new Error("Wait for this board to save before uploading.");
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/wav": "wav",
      "audio/ogg": "ogg",
      "audio/webm": "webm",
    };
    const blob = await upload(
      `jeopardy/${uid()}.${extensions[file.type]}`,
      file,
      {
        access: "public",
        contentType: file.type,
        handleUploadUrl: `${apiOrigin}/api/media`,
        clientPayload: JSON.stringify({
          boardId: targetBoard.id,
          cardId: targetCard.id,
        }),
        multipart: file.size > 4 * 1024 * 1024,
        onUploadProgress: (progress) => {
          const label = document.querySelector("#upload-progress");
          if (
            view === "edit" &&
            board?.id === targetBoard.id &&
            selected === targetCard.id &&
            label
          )
            label.textContent = `Uploading… ${Math.round(progress.percentage)}%`;
        },
      },
    );
    if (
      !targetBoard.categories.some((c) =>
        c.cards.some((card) => card.id === targetCard.id),
      )
    )
      return;
    targetCard.media = {
      url: blob.url,
      type,
      contentType: file.type,
      name: file.name.slice(0, 250),
      size: file.size,
      displayByDefault: targetCard.media?.displayByDefault ?? true,
    } satisfies ClueMedia;
    persistBoard(targetBoard);
    toast("Media uploaded.");
  } catch (error) {
    toast((error as Error).message || "Upload failed. Try again.", true);
  } finally {
    uploadingCards.delete(targetCard.id);
    if (
      view === "edit" &&
      board?.id === targetBoard.id &&
      selected === targetCard.id
    )
      editor();
  }
}
function setup() {
  if (!board) return;
  page(
    "Set up game",
    `<a class="back-link" href="#edit/${esc(board.id)}">← Back to editor</a><form id="setup-form" class="setup-form"><div class="setup-summary"><div class="eyebrow">${readyCards(board).length} CARDS READY</div><h2>${esc(board.title.trim() || "Jeopardy")}</h2><p>Empty cards stay off the game board.</p></div><fieldset><legend>How are you playing?</legend><div class="choice-grid"><label class="choice"><input type="radio" name="mode" value="screen" checked><strong>Shared screen</strong><span>The host chooses clues and keeps score. Players answer aloud.</span></label><label class="choice"><input type="radio" name="mode" value="buzzer"><strong>Phone buzzers</strong><span>Players join with a room code and buzz in from their devices.</span></label></div></fieldset><fieldset><legend>Who’s playing?</legend><div class="segmented"><label><input type="radio" name="format" value="teams" checked> Teams</label><label><input type="radio" name="format" value="individuals"> Individuals</label></div><label for="names" class="names-label">Team names</label><textarea id="names" name="names" rows="4" maxlength="500" placeholder="Team 1&#10;Team 2"></textarea><p class="field-help" id="names-help">One name per line. Up to 12 teams or players.</p></fieldset><div class="form-footer"><p id="setup-error" role="alert"></p><button class="primary" type="submit" ${!readyCards(board).length ? "disabled" : ""}>Create room →</button></div></form>`,
  );
}
function join(code = "") {
  page(
    "Join a game",
    `<form class="join-form" id="join-form"><label for="room-code">Room code</label><input id="room-code" name="code" value="${esc(code)}" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123" required pattern="[A-Za-z2-9]{6}"><p>Get the six-character code from your host.</p><button class="primary" type="submit">Join game →</button></form>`,
  );
}
function roomShell(content: string) {
  document.body.className = "game-theme";
  preserveMedia(content, app);
}
function boardGrid(g: Game, clickable: boolean) {
  return `<div class="board-scroll"><div class="play-board" style="--columns:${g.categories.length}">${g.categories.map((c) => `<div class="play-category"><h2>${esc(c.name)}</h2>${c.cards.map((card) => `<button class="play-card ${g.used.includes(card.id) ? "used" : ""}" data-action="select" data-id="${esc(card.id)}" ${!clickable || g.used.includes(card.id) ? "disabled" : ""} aria-label="${esc(c.name)}, ${money(card.value)}${g.used.includes(card.id) ? ", used" : ""}">${g.used.includes(card.id) ? '<span class="sr-only">Used</span>' : money(card.value)}</button>`).join("")}</div>`).join("")}</div></div>`;
}
function scores(g: Game) {
  return `<div class="scoreboard" aria-label="Scores">${g.players.map((p) => `<div class="score ${p.id === g.buzzed ? "buzzed" : ""}"><span>${esc(p.name)}${p.id === g.buzzed ? " • Buzzed in" : ""}</span><strong class="${p.score < 0 ? "negative" : ""}">${money(p.score)}</strong></div>`).join("")}</div>`;
}
function renderGame() {
  if (!game) return;
  const g = game;
  const host = view === "host";
  const display = view === "display";
  const card = activeCard(g);
  const category = g.categories.find((c) =>
    c.cards.some((c) => c.id === g.active),
  );
  const remaining = g.categories.flatMap((c) => c.cards).length - g.used.length;
  roomShell(
    `<header class="game-header"><a class="wordmark" href="#library">JEOPARDY<span>!</span></a><div class="game-title">${esc(g.title)}<span>${g.status === "lobby" ? "Waiting to start" : g.status === "finished" ? "Game over" : `${remaining} cards left`}</span></div><div class="game-tools"><span class="room-label">ROOM <b>${esc(g.code)}</b></span>${host ? '<button data-action="display">Open player view ↗</button>' : ""}<button data-action="fullscreen" aria-label="Toggle full screen">⛶</button></div></header><main class="game-main">${
      g.status === "lobby"
        ? `<section class="lobby"><div class="eyebrow">${g.mode === "buzzer" ? "JOIN AT " + esc(location.origin + location.pathname) + "#join" : "SHARED SCREEN"}</div><h1>${g.mode === "buzzer" ? esc(g.code) : "Ready to play?"}</h1><p>${g.mode === "buzzer" ? "Enter the room code on your phone." : "Choose a clue from the board. The host keeps score."}</p>${g.mode === "buzzer" ? '<button data-action="copy-join">Copy join link</button>' : ""}<div class="lobby-players">${g.players.map((p) => `<span>${esc(p.name)} ${g.mode === "buzzer" && g.format === "teams" ? `<small>${p.token || p.connected ? "Connected" : "Waiting"}</small>` : ""}</span>`).join("") || "<p>Waiting for players…</p>"}</div>${host ? `<button class="gold large" data-action="start" ${!g.players.length ? "disabled" : ""}>Start game →</button>` : "<p>The host will start the game.</p>"}</section>`
        : g.status === "finished"
          ? `<section class="results"><div class="eyebrow">FINAL SCORES</div><h1>${
              g.players.length
                ? esc(
                    [...g.players]
                      .sort((a, b) => b.score - a.score)
                      .filter(
                        (p) =>
                          p.score ===
                          Math.max(...g.players.map((p) => p.score)),
                      )
                      .map((p) => p.name)
                      .join(" & "),
                  )
                : "Game over"
            } ${g.players.length && g.players.filter((p) => p.score === Math.max(...g.players.map((p) => p.score))).length > 1 ? "tie!" : "wins!"}</h1>${scores(g)}${host ? '<a class="button gold" href="#library">Back to my games</a>' : ""}</section>`
          : card
            ? `<section class="clue-view"><div class="clue-meta">${esc(category?.name)} <span>•</span> ${money(card.value)}</div><h1 class="clue-text">${esc(card.clue || "Media clue")}</h1>${clueMedia(g, card)}${g.revealed ? `<div class="answer"><span>ANSWER</span><p>${esc(card.answer)}</p></div>` : ""}${g.buzzed ? `<p class="buzz-announcement" role="status">${esc(g.players.find((p) => p.id === g.buzzed)?.name)} buzzed in</p>` : g.buzzOpen ? '<p class="buzz-announcement">Buzzers open</p>' : ""}</section>`
            : boardGrid(g, host)
    }${g.status === "playing" ? scores(g) : ""}${host ? hostControls(g, card) : ""}</main><div class="connection-status" id="connection-status" role="status">Connected${display ? " · Player view" : ""}</div>`,
  );
  syncMedia(g);
}
function hostControls(g: Game, card: Card | undefined) {
  return `<section class="host-controls" aria-label="Host controls">${
    card
      ? `<div class="clue-actions">${!g.revealed ? '<button data-action="reveal">Reveal answer</button>' : ""}${g.mode === "buzzer" && !g.revealed ? `<button class="gold" data-action="${g.buzzOpen ? "close" : "open"}">${g.buzzOpen ? "Close buzzers" : "Open buzzers"}</button>` : ""}<button data-action="finish-card">Skip / back to board</button></div>${card.media ? `<div class="host-media-controls" aria-label="Media controls"><span>${card.media.type === "image" ? "Picture" : card.media.type === "video" ? "Video" : "Audio"}</span>${card.media.type === "image" ? `<button data-action="media-show">${g.mediaPlayback?.visible ? "Hide picture" : "Show picture"}</button>` : `<button class="gold" data-action="media-play">${g.mediaPlayback?.playing ? "Pause" : "Play"} ${card.media.type}</button><button data-action="media-replay">Replay from start</button>${g.mediaPlayback?.visible ? '<button data-action="media-hide">Hide media</button>' : '<button data-action="media-show">Show media</button>'}`}</div>` : ""}<div class="scoring-controls">${g.players
          .filter((p) => g.mode === "screen" || p.id === g.buzzed)
          .map(
            (p) =>
              `<div class="score-actions"><span>${esc(p.name)}</span><button data-action="score" data-player="${esc(p.id)}" data-direction="-1" aria-label="${esc(p.name)} incorrect, subtract ${money(card.value)}" ${g.attempted.includes(p.id) ? "disabled" : ""}>− ${money(card.value)}</button><button class="gold" data-action="score" data-player="${esc(p.id)}" data-direction="1" aria-label="${esc(p.name)} correct, add ${money(card.value)}" ${g.attempted.includes(p.id) ? "disabled" : ""}>+ ${money(card.value)}</button></div>`,
          )
          .join(
            "",
          )}${g.mode === "buzzer" && !g.buzzed ? "<p>Open the buzzers, then score the first player to buzz in.</p>" : ""}</div>`
      : ""
  }<div class="host-bottom"><span>Host controls</span><div><button data-action="undo" ${!g.history.length ? "disabled" : ""}>Undo last score</button><button data-action="finish" ${g.status === "finished" ? "disabled" : ""}>End game</button></div></div></section>`;
}
function renderPlayer() {
  if (!game) return;
  const g = game;
  const player = g.players.find((p) => p.id === playerId);
  const card = activeCard(g);
  const canBuzz =
    g.status === "playing" &&
    g.buzzOpen &&
    !g.buzzed &&
    !g.attempted.includes(playerId);
  if (!playerId && g.status !== "lobby") {
    page(
      "Room already started",
      '<p>Watch the game on the shared screen.</p><a class="button primary" href="#display/' +
        esc(g.code) +
        '">View board</a>',
    );
    return;
  }
  if (!playerId && g.mode !== "buzzer") {
    navigate(`display/${g.code}`);
    return;
  }
  if (!playerId) {
    page(
      "Join " + g.title,
      `<form id="player-form" class="join-form"><span class="eyebrow">ROOM ${esc(g.code)}</span>${g.format === "teams" ? `<label for="team">Choose your team</label><select id="team" name="playerId" required>${g.players.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><p>Players on the same team share a buzzer.</p>` : '<label for="player-name">Your name</label><input id="player-name" name="name" maxlength="40" autocomplete="nickname" required>'}<button class="primary" type="submit">Join game →</button></form>`,
    );
    return;
  }
  roomShell(
    `<header class="game-header"><span class="wordmark">JEOPARDY<span>!</span></span><span class="room-label">ROOM <b>${esc(g.code)}</b></span></header><main class="player-main"><p class="eyebrow">${esc(player?.name || "Player")}</p><div class="player-score">${money(player?.score || 0)}</div>${g.status === "finished" ? `<h1>Game over</h1>${scores(g)}` : g.status === "lobby" ? `<h1>You’re in.</h1><p>Waiting for the host to start.</p>` : `<div class="player-clue">${card ? `<span>${money(card.value)}</span><h1>${esc(card.clue || "Media clue")}</h1>${clueMedia(g, card)}${g.revealed ? `<p class="player-answer">${esc(card.answer)}</p>` : ""}` : "<h1>Choose the next clue on the board.</h1>"}</div><button class="buzzer ${g.buzzed === playerId ? "first" : ""}" data-action="buzz" ${canBuzz ? "" : "disabled"}>${g.buzzed === playerId ? "YOU’RE UP" : canBuzz ? "BUZZ IN" : g.attempted.includes(playerId) && card ? "ANSWERED" : "WAIT"}</button><p role="status">${g.buzzed ? esc(g.players.find((p) => p.id === g.buzzed)?.name) + " buzzed in" : canBuzz ? "Buzzers are open." : "Watch for the host to open the buzzers."}</p>`}</main><div class="connection-status" id="connection-status" role="status">Connected</div>`,
  );
  syncMedia(g);
}
async function refreshRoom(force = false) {
  if (!game || pollInFlight) return;
  pollInFlight = true;
  const generation = routeGeneration;
  try {
    const result = await api(
      `games/${game.code}`,
      "GET",
      undefined,
      view === "host" ? hostToken : "",
    );
    if (generation !== routeGeneration) return;
    if (game && result.game.version < game.version) return;
    game = result.game;
    const signature = `${view}:${game!.version}:${playerId}`;
    if (force || signature !== lastGameRender) {
      lastGameRender = signature;
      view === "player" ? renderPlayer() : renderGame();
    }
    const indicator = document.querySelector("#connection-status");
    if (indicator) indicator.textContent = "Connected";
  } catch {
    const indicator = document.querySelector("#connection-status");
    if (indicator) indicator.textContent = "Reconnecting…";
  } finally {
    pollInFlight = false;
  }
}
async function loadRoom(code: string) {
  const generation = routeGeneration;
  page(
    "Loading room…",
    '<div class="loading-board" aria-label="Loading"></div>',
  );
  const result = await api(
    `games/${code}`,
    "GET",
    undefined,
    view === "host" ? hostToken : "",
  );
  if (generation !== routeGeneration) return;
  game = result.game;
  if (view === "host" && !hostToken) {
    page(
      "Host link unavailable",
      '<p>Open this room on the device that created it, or use the host link you saved.</p><a class="button" href="#display/' +
        esc(code) +
        '">View game</a>',
    );
    return;
  }
  lastGameRender = `${view}:${game!.version}:${playerId}`;
  view === "player" ? renderPlayer() : renderGame();
  poll = setInterval(() => {
    if (!document.hidden) void refreshRoom();
  }, 1200);
}
async function route() {
  const generation = ++routeGeneration;
  clearInterval(poll);
  poll = undefined;
  game = undefined;
  lastGameRender = "";
  selected = null;
  const [path, query = ""] = location.hash.slice(1).split("?");
  const [nextView = "library", id = ""] = path.split("/");
  view = nextView || "library";
  const params = new URLSearchParams(query);
  try {
    if (view === "library") await loadLibrary();
    else if (view === "join") join();
    else if (view === "edit" || view === "setup") {
      board = boards.find((b) => b.id === id);
      if (!pendingSaves.has(id)) {
        page("Loading game…", "<p>Getting your saved board.</p>");
        const result = await api(`boards/${encodeURIComponent(id)}`);
        if (generation !== routeGeneration) return;
        board = validateBoard(result.board, true);
        boards = [board, ...boards.filter((value) => value.id !== id)];
        store("jeopardy.boards", boards);
      }
      if (!board) {
        navigate("library");
        return;
      }
      view === "edit" ? editor() : setup();
    } else if (["host", "display", "player"].includes(view)) {
      if (!/^[A-Z2-9]{6}$/.test(id)) {
        navigate("join");
        return;
      }
      hostToken =
        params.get("key") ||
        read<Record<string, string>>("jeopardy.hosts", {})[id] ||
        "";
      if (view === "host" && hostToken) {
        const hosts = read<Record<string, string>>("jeopardy.hosts", {});
        hosts[id] = hostToken;
        store("jeopardy.hosts", hosts);
      }
      const player = read<Record<string, { id: string; token: string }>>(
        "jeopardy.players",
        {},
      )[id];
      playerId = player?.id || "";
      playerToken = player?.token || "";
      await loadRoom(id);
    } else navigate("library");
  } catch (error) {
    page(
      "Couldn’t open this game",
      `<p role="alert">${esc((error as Error).message)}</p><a class="button" href="#library">Back to my games</a>`,
    );
  }
}
async function action(type: string, extra: Record<string, unknown> = {}) {
  if (!game) return;
  const result = await api(
    `games/${game.code}/action`,
    "POST",
    { type, version: game.version, ...extra },
    hostToken,
  );
  game = result.game;
  renderGame();
}
async function shareEditLink() {
  if (!board) return;
  const id = board.id;
  queueSave(board);
  await flushSaves();
  if (pendingSaves.has(id))
    throw new Error(
      "The board hasn’t synced yet. Check the connection and try again.",
    );
  if (view !== "edit" || board.id !== id) return;
  const url = `${location.origin}${location.pathname}#edit/${id}`;
  document.querySelector("#share-board")?.remove();
  const block = document.createElement("section");
  block.id = "share-board";
  block.className = "share-board";
  block.innerHTML = `<label for="edit-link">Edit link <span>Open this board directly. It’s also available in My games.</span></label><div class="link-row"><input id="edit-link" readonly value="${esc(url)}"><button data-action="copy-edit">Copy link</button><button data-action="close-share" aria-label="Close edit link">×</button></div>`;
  document.querySelector(".editor-title")!.after(block);
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied.");
  } catch {
    toast(
      "Couldn’t copy. Select and copy the link from the address field.",
      true,
    );
  }
}

app.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (view === "edit" && board) {
    if (target.id === "board-title") board.title = target.value;
    if (target.dataset.category)
      board.categories.find((c) => c.id === target.dataset.category)!.name =
        target.value;
    const card = board.categories
      .flatMap((c) => c.cards)
      .find((c) => c.id === selected);
    if (card) {
      if (target.id === "card-clue") card.clue = target.value;
      if (target.id === "card-answer") card.answer = target.value;
      if (target.id === "media-default" && card.media)
        card.media.displayByDefault = target.checked;
      if (target.id === "media-alt" && card.media)
        card.media.alt = target.value;
      if (target.id === "card-value") card.value = Number(target.value);
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".edit-card"),
      ).find((b) => b.dataset.id === selected);
      if (button) {
        const ready = isCardReady(card);
        button.classList.toggle("complete", ready);
        button.querySelector("strong")!.textContent = money(card.value);
        button.querySelector("span")!.textContent = ready
          ? "Ready"
          : "Add clue";
      }
    }
    persistBoard();
    const count = document.querySelector("#card-count");
    if (count)
      count.textContent = `${readyCards(board).length} / ${board.categories.length * 5} cards ready`;
  }
});
app.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "card-media" && target.files?.[0]) {
    void uploadMedia(target.files[0]);
    return;
  }
  if (view === "setup" && ["mode", "format"].includes(target.name)) {
    const form = document.querySelector<HTMLFormElement>("#setup-form")!;
    const data = new FormData(form);
    const individuals = data.get("format") === "individuals";
    const phones = data.get("mode") === "buzzer";
    document.querySelector(".names-label")!.textContent = individuals
      ? "Player names"
      : "Team names";
    const names = document.querySelector<HTMLTextAreaElement>("#names")!;
    names.disabled = individuals && phones;
    names.hidden = individuals && phones;
    document
      .querySelector(".names-label")!
      .classList.toggle("hidden", individuals && phones);
    document.querySelector("#names-help")!.textContent =
      individuals && phones
        ? "Players enter their names when they join the room."
        : "One name per line. Up to 12 teams or players.";
  }
  if (target.id === "import-file" && target.files?.[0]) {
    const file = target.files[0];
    if (file.size > 200000) {
      toast("This file is too large.", true);
      return;
    }
    void file
      .text()
      .then((text) => {
        board = validateBoard(JSON.parse(text), true);
        board.id = uid();
        persistBoard();
        navigate(`edit/${board.id}`);
      })
      .catch((e) => toast(e.message || "Couldn’t import this file.", true));
  }
});
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  busy = true;
  if (submit) submit.disabled = true;
  try {
    if (form.id === "join-form")
      navigate(`player/${String(data.get("code")).trim().toUpperCase()}`);
    if (form.id === "setup-form") {
      const result = await api("games", "POST", {
        board: validateBoard(board),
        mode: data.get("mode"),
        format: data.get("format"),
        names: String(data.get("names") || "")
          .split("\n")
          .filter(Boolean),
      });
      const hosts = read<Record<string, string>>("jeopardy.hosts", {});
      hosts[result.game.code] = result.hostToken;
      store("jeopardy.hosts", hosts);
      navigate(`host/${result.game.code}`);
    }
    if (form.id === "player-form" && game) {
      const result = await api(
        `games/${game.code}/join`,
        "POST",
        Object.fromEntries(data),
      );
      playerId = result.playerId;
      playerToken = result.playerToken;
      const players = read<Record<string, unknown>>("jeopardy.players", {});
      players[game.code] = { id: playerId, token: playerToken };
      store("jeopardy.players", players);
      game = result.game;
      renderPlayer();
    }
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy = false;
    if (submit?.isConnected) submit.disabled = false;
  }
});
app.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-action]",
  );
  if (!button || button.disabled || busy) return;
  const name = button.dataset.action!;
  busy = true;
  try {
    switch (name) {
      case "refresh-library":
        if (!libraryLoading) await loadLibrary();
        break;
      case "media-sound":
        toggleMediaSound();
        break;
      case "allow-playback":
        enablePlayback();
        break;
      case "media-show":
        await action("media", {
          command: game!.mediaPlayback?.visible ? "hide" : "show",
        });
        break;
      case "media-play":
        await action("media", {
          command: game!.mediaPlayback?.playing ? "pause" : "play",
        });
        break;
      case "media-replay":
        await action("media", { command: "replay" });
        break;
      case "media-hide":
        await action("media", { command: "hide" });
        break;
      case "remove-media": {
        const card = board!.categories
          .flatMap((c) => c.cards)
          .find((c) => c.id === selected)!;
        delete card.media;
        persistBoard();
        editor();
        break;
      }
      case "new":
        board = blankBoard();
        persistBoard();
        navigate(`edit/${board.id}`);
        break;
      case "sample":
        board = sampleBoard();
        persistBoard();
        navigate(`edit/${board.id}`);
        break;
      case "import":
        document.querySelector<HTMLInputElement>("#import-file")!.click();
        break;
      case "delete":
        if (confirm("Remove this game from My games on all devices?")) {
          const id = button.dataset.id!;
          await flushSaves();
          await api(`boards/${id}/archive`, "POST", {});
          pendingSaves.delete(id);
          boards = boards.filter((b) => b.id !== id);
          store("jeopardy.boards", boards);
          library();
        }
        break;
      case "edit-card":
        selected = button.dataset.id!;
        document.querySelectorAll(".edit-card").forEach((el) => {
          const chosen = (el as HTMLElement).dataset.id === selected;
          el.classList.toggle("selected", chosen);
          el.setAttribute("aria-pressed", String(chosen));
        });
        renderCardEditor();
        break;
      case "next-card": {
        const cards = board!.categories.flatMap((c) => c.cards);
        selected =
          cards[(cards.findIndex((c) => c.id === selected) + 1) % cards.length]
            .id;
        editor();
        break;
      }
      case "clear-card":
        if (confirm("Clear this card’s clue, answer, and media?")) {
          const card = board!.categories
            .flatMap((c) => c.cards)
            .find((c) => c.id === selected)!;
          card.clue = "";
          card.answer = "";
          delete card.media;
          persistBoard();
          editor();
        }
        break;
      case "add-category":
        if (board!.categories.length < 8) {
          board!.categories.push(blankBoard().categories[0]);
          persistBoard();
          editor();
        }
        break;
      case "remove-category":
        if (
          board!.categories.length > 1 &&
          confirm("Remove this category and its five cards?")
        ) {
          board!.categories = board!.categories.filter(
            (c) => c.id !== button.dataset.id,
          );
          persistBoard();
          editor();
        }
        break;
      case "export":
        saveDownload(board!);
        break;
      case "share-edit":
        button.textContent = "Getting link…";
        await shareEditLink();
        break;
      case "copy-edit":
        await copy(
          document.querySelector<HTMLInputElement>("#edit-link")!.value,
        );
        break;
      case "close-share":
        document.querySelector("#share-board")?.remove();
        break;
      case "display":
        window.open(
          `${location.origin}${location.pathname}#display/${game!.code}`,
          "_blank",
          "noopener",
        );
        break;
      case "copy-join":
        await copy(
          `${location.origin}${location.pathname}#player/${game!.code}`,
        );
        break;
      case "fullscreen":
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        break;
      case "buzz": {
        const result = await api(
          `games/${game!.code}/buzz`,
          "POST",
          { playerId },
          playerToken,
        );
        game = result.game;
        renderPlayer();
        break;
      }
      case "select":
        await action("select", { cardId: button.dataset.id });
        break;
      case "score":
        await action("score", {
          playerId: button.dataset.player,
          direction: Number(button.dataset.direction),
        });
        break;
      case "finish":
        if (confirm("End this game and show final scores?"))
          await action("finish");
        break;
      default:
        if (
          ["start", "reveal", "open", "close", "finish-card", "undo"].includes(
            name,
          )
        )
          await action(name);
    }
  } catch (error) {
    toast((error as Error).message, true);
    if (game) void refreshRoom(true);
  } finally {
    busy = false;
    if (name === "share-edit" && button.isConnected)
      button.textContent = "Share edit link";
  }
});
window.addEventListener("hashchange", () => {
  void flushSaves();
  void route();
});
window.addEventListener("online", () => void flushSaves());
window.addEventListener("beforeunload", (event) => {
  if (pendingSaves.size) {
    event.preventDefault();
    event.returnValue = "";
  }
});
for (const id of read<string[]>("jeopardy.pending", [])) {
  const draft = boards.find((b) => b.id === id);
  if (draft) queueSave(draft);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && game) void refreshRoom(true);
  else if (!document.hidden && view === "library" && !libraryLoading)
    void loadLibrary();
});
document.addEventListener("keydown", (event) => {
  if (
    event.code === "Space" &&
    view === "player" &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLButtonElement)
  ) {
    const buzzer = document.querySelector<HTMLButtonElement>(".buzzer");
    if (buzzer && !buzzer.disabled) {
      event.preventDefault();
      buzzer.click();
    }
  }
});
void route();
