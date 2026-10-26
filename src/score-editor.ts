import { recentCardValue, type Game } from "./model";
export function openScoreEditor(
  getGame: () => Game | undefined,
  update: (type: string, extra: Record<string, unknown>) => Promise<void>,
) {
  if (!getGame()) return;
  const dialog = document.createElement("dialog");
  dialog.className = "audio-source score-editor";
  dialog.setAttribute("aria-labelledby", "score-heading");
  dialog.innerHTML = `<div class="section-heading"><h2 id="score-heading">Edit scores</h2><button type="button" id="scores-close">Done</button></div><p id="score-value-help"></p><div id="score-rows"></div><p id="score-edit-status" role="status"></p>`;
  document.body.append(dialog);
  let pending = false;
  const close = () => {
    if (!pending) {
      dialog.close();
      dialog.remove();
    }
  };
  dialog.querySelector<HTMLButtonElement>("#scores-close")!.onclick = close;
  dialog.oncancel = (event) => {
    event.preventDefault();
    close();
  };
  function rows() {
    const game = getGame();
    if (!game) return;
    const value = recentCardValue(game);
    dialog.querySelector("#score-value-help")!.textContent = value
      ? `Adjust by the most recent card’s value ($${value.toLocaleString()}), or enter a score.`
      : "Enter a score. Card-value buttons become available after the first clue opens.";
    const container = dialog.querySelector("#score-rows")!;
    container.replaceChildren();
    for (const player of game.players) {
      const form = document.createElement("form");
      form.className = "score-edit-row";
      const label = document.createElement("label");
      label.htmlFor = `score-${player.id}`;
      label.textContent = player.name;
      const controls = document.createElement("div");
      controls.className = "score-edit-fields";
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.min = "-1000000000";
      input.max = "1000000000";
      input.required = true;
      input.id = label.htmlFor;
      input.value = String(player.score);
      const save = document.createElement("button");
      save.type = "submit";
      save.textContent = "Set score";
      controls.append(input, save);
      const quick = document.createElement("div");
      quick.className = "trim-buttons";
      for (const direction of [-1, 1]) {
        const button = document.createElement("button");
        button.type = "button";
        button.disabled = !value;
        button.textContent = `${direction < 0 ? "−" : "+"} $${(value || 0).toLocaleString()}`;
        button.setAttribute(
          "aria-label",
          `${direction < 0 ? "Subtract" : "Add"} ${value || 0} ${direction < 0 ? "from" : "to"} ${player.name}`,
        );
        button.onclick = () => void submit({ playerId: player.id, direction });
        quick.append(button);
      }
      form.append(label, controls, quick);
      form.onsubmit = (event) => {
        event.preventDefault();
        if (input.value.trim())
          void submit({ playerId: player.id, score: Number(input.value) });
      };
      container.append(form);
    }
  }
  async function submit(extra: Record<string, unknown>) {
    if (pending) return;
    pending = true;
    const status = dialog.querySelector<HTMLElement>("#score-edit-status")!;
    status.textContent = "Saving score…";
    dialog
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input")
      .forEach((element) => (element.disabled = true));
    try {
      await update("edit-score", extra);
      rows();
      status.textContent = "Score saved.";
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      pending = false;
      dialog
        .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input")
        .forEach((element) => (element.disabled = false));
      if (!recentCardValue(getGame()!))
        dialog
          .querySelectorAll<HTMLButtonElement>(".trim-buttons button")
          .forEach((button) => (button.disabled = true));
    }
  }
  rows();
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>("input")?.focus();
}
