import { trimBounds } from "./audio-trim";
type SourceResult = {
  id: string;
  title: string;
  page: string;
  provider?: string;
  detail?: string;
};
type SourceFile = {
  name: string;
  url: string;
  size: number;
  duration?: number;
  contentType?: string;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function openAudioSource(
  apiOrigin: string,
  attach: (file: File) => Promise<boolean>,
  clue: { boardId: string; cardId: string },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "audio-source";
  dialog.setAttribute("aria-labelledby", "source-heading");
  dialog.innerHTML = `<div class="section-heading"><h2 id="source-heading">Source MP3</h2><button type="button" id="source-close" aria-label="Close Source MP3">Close</button></div>
    <form id="source-search"><label for="source-provider">Search in</label><select id="source-provider"><option value="youtube">YouTube</option><option value="archive">Internet Archive</option></select><label for="source-query">Song or sound</label><div class="source-search-row"><input id="source-query" maxlength="200" placeholder="powerpuff girls intro song" required><button type="submit">Search</button></div></form>
    <p class="field-help">Search by title or paste a video link. Recordings can be up to 10 minutes long. Nothing plays automatically.</p>
    <label class="source-file-label" for="source-file">Or open audio or video from your device</label><input id="source-file" type="file" accept="audio/*,video/mp4,video/webm">
    <p id="source-status" role="status" aria-live="polite"></p><div id="source-results"></div>
    <section id="source-trim" hidden><h3 id="source-title"></h3><audio id="source-audio" controls preload="metadata"></audio>
    <div class="trim-times"><label for="trim-start">Start (seconds)<input id="trim-start" type="number" min="0" step="0.001" value="0"></label><label for="trim-end">End (seconds)<input id="trim-end" type="number" min="0" step="0.001"></label></div>
    <div class="trim-buttons"><button type="button" id="trim-mark-start">Set start here</button><button type="button" id="trim-mark-end">Set end here</button><button type="button" id="trim-preview">Preview clip</button></div>
    <p class="field-help">Up to two minutes. Playback stays under the host’s control during the game.</p><p id="trim-length"></p><button type="button" id="trim-attach" class="primary">Attach trimmed MP3</button></section>`;
  document.body.append(dialog);
  const find = <T extends HTMLElement>(id: string) =>
    dialog.querySelector<T>(`#${id}`)!;
  const status = find("source-status");
  const results = find("source-results");
  const audio = find<HTMLAudioElement>("source-audio");
  const start = find<HTMLInputElement>("trim-start");
  const end = find<HTMLInputElement>("trim-end");
  const controller = new AbortController();
  let context: AudioContext | undefined;
  let decoded: AudioBuffer | undefined;
  let objectUrl = "";
  let filename = "clip";
  let pending = false;
  let previewing = false;
  let worker: Worker | undefined;
  let generation = 0;
  const message = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle("error", error);
  };
  const lock = (value: boolean) => {
    pending = value;
    dialog
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select")
      .forEach((el) => (el.disabled = value));
  };
  function close() {
    if (pending) return;
    generation++;
    controller.abort();
    worker?.terminate();
    audio.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    void context?.close();
    dialog.close();
    dialog.remove();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  find("source-close").onclick = close;
  async function request(query: string, body?: unknown) {
    const response = await fetch(
      `${apiOrigin}/api/audio-sources${body ? "/convert" : "?" + query}`,
      {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(body ? 110000 : 20000),
        ]),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "The source could not be loaded.");
    return data;
  }
  const updateLength = () => {
    previewing = false;
    audio.pause();
    try {
      const range = trimBounds(
        Number(start.value),
        Number(end.value),
        decoded?.duration || 0,
      );
      find("trim-length").textContent =
        `${(range.end - range.start).toFixed(1)} seconds selected`;
    } catch (error) {
      find("trim-length").textContent = (error as Error).message;
    }
  };
  async function load(blob: Blob, name: string) {
    if (!blob.size || blob.size > 50 * 1024 * 1024)
      throw new Error("Choose a recording under 50 MB.");
    audio.pause();
    previewing = false;
    decoded = undefined;
    find("source-trim").hidden = true;
    context ??= new AudioContext({ sampleRate: 44100 });
    const buffer = await context
      .decodeAudioData(await blob.arrayBuffer())
      .catch(() => {
        throw new Error(
          "This recording could not be opened. Try an MP3, WAV, or MP4 file.",
        );
      });
    if (buffer.duration > 600)
      throw new Error("Choose a source recording under 10 minutes.");
    decoded = buffer;
    filename =
      name
        .replace(/\.[^.]+$/, "")
        .replace(/[<>:"/\\|?*]/g, " ")
        .slice(0, 160) || "clip";
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    find("source-title").textContent = name;
    start.value = "0";
    end.value = String(Math.floor(Math.min(buffer.duration, 30) * 1000) / 1000);
    start.max = end.max = String(buffer.duration);
    find("source-trim").hidden = false;
    updateLength();
    message("Recording ready. Choose the part you want to use.");
  }
  async function loadRemote(file: SourceFile) {
    message("Loading recording…");
    lock(true);
    try {
      // Only URLs returned by our source endpoints are used.
      const response = await fetch(file.url, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45000),
        ]),
      });
      if (!response.ok)
        throw new Error("This recording is unavailable. Try another result.");
      const reader = response.body!.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 50 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("This recording is over 50 MB.");
        }
        chunks.push(new Uint8Array(chunk.value));
      }
      await load(
        new Blob(chunks, { type: file.contentType || "audio/mpeg" }),
        file.name,
      );
    } catch (error) {
      message(
        (error as Error).message || "Could not load this recording.",
        true,
      );
    } finally {
      lock(false);
    }
  }
  find<HTMLFormElement>("source-search").onsubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    const ticket = ++generation;
    message("Searching…");
    results.replaceChildren();
    try {
      const data = await request(
        new URLSearchParams({
          q: find<HTMLInputElement>("source-query").value.trim(),
          provider: find<HTMLSelectElement>("source-provider").value,
        }).toString(),
      );
      if (ticket !== generation) return;
      const matches: SourceResult[] = data.results;
      message(
        matches.length
          ? "Choose a recording."
          : "No matches. Try fewer words, another title, or a file from your device.",
      );
      for (const match of matches) {
        const row = document.createElement("div");
        row.className = "source-result";
        row.innerHTML = `<div><strong>${escape(match.title)}</strong><a href="${escape(match.page)}" target="_blank" rel="noopener noreferrer">${match.provider === "youtube" ? "YouTube" : "Internet Archive"} ↗</a>${match.detail ? `<small>${escape(match.detail)}</small>` : ""}</div><button type="button">Choose</button>`;
        row.querySelector("button")!.onclick = async () => {
          if (pending) return;
          lock(true);
          message("Finding audio files…");
          try {
            if (match.provider === "youtube") {
              message("Sourcing YouTube audio… This may take a minute.");
              const file = await request("", { id: match.id, ...clue });
              results.replaceChildren();
              await loadRemote(file);
              return;
            }
            const item = await request(
              new URLSearchParams({ id: match.id }).toString(),
            );
            results.replaceChildren();
            for (const file of item.files as SourceFile[]) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "source-track";
              button.textContent = `${file.name}${file.duration ? ` · ${Math.round(file.duration)} seconds` : ""}`;
              button.onclick = () => {
                if (!pending) void loadRemote(file);
              };
              results.append(button);
            }
            message("Choose a track to preview and trim.");
            if (item.files.length === 1) {
              lock(false);
              await loadRemote(item.files[0]);
            }
          } catch (error) {
            message((error as Error).message, true);
          } finally {
            lock(false);
          }
        };
        results.append(row);
      }
    } catch (error) {
      if (ticket === generation) message((error as Error).message, true);
    }
  };
  find<HTMLInputElement>("source-file").onchange = async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || pending) return;
    generation++;
    lock(true);
    message("Opening recording…");
    try {
      await load(file, file.name);
    } catch (error) {
      message((error as Error).message, true);
    } finally {
      input.value = "";
      lock(false);
    }
  };
  start.oninput = end.oninput = updateLength;
  find("trim-mark-start").onclick = () => {
    start.value = audio.currentTime.toFixed(1);
    updateLength();
  };
  find("trim-mark-end").onclick = () => {
    end.value = audio.currentTime.toFixed(1);
    updateLength();
  };
  find("trim-preview").onclick = async () => {
    try {
      const range = trimBounds(
        Number(start.value),
        Number(end.value),
        decoded?.duration || 0,
      );
      audio.currentTime = range.start;
      previewing = true;
      await audio.play();
      message("Playing selected clip.");
    } catch (error) {
      message((error as Error).message, true);
    }
  };
  audio.ontimeupdate = () => {
    if (previewing && audio.currentTime >= Number(end.value)) {
      audio.pause();
      previewing = false;
    }
  };
  find("trim-attach").onclick = async () => {
    if (!decoded || pending) return;
    try {
      const range = trimBounds(
        Number(start.value),
        Number(end.value),
        decoded.duration,
      );
      audio.pause();
      lock(true);
      message("Creating MP3…");
      const channels = Array.from(
        { length: Math.min(decoded.numberOfChannels, 2) },
        (_, index) =>
          decoded!
            .getChannelData(index)
            .slice(
              Math.floor(range.start * decoded!.sampleRate),
              Math.floor(range.end * decoded!.sampleRate),
            ),
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        worker = new Worker(new URL("./mp3-worker.ts", import.meta.url), {
          type: "module",
        });
        worker.onmessage = (event) =>
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.blob);
        worker.onerror = () =>
          reject(
            new Error("The MP3 could not be created. Try another recording."),
          );
        worker.postMessage(
          { channels, sampleRate: decoded!.sampleRate },
          channels.map((channel) => channel.buffer),
        );
      });
      worker?.terminate();
      worker = undefined;
      message("Uploading clip…");
      const saved = await attach(
        new File(
          [blob],
          `${filename} (${range.start.toFixed(1)}-${range.end.toFixed(1)}s).mp3`,
          { type: "audio/mpeg" },
        ),
      );
      lock(false);
      if (saved) close();
      else
        message(
          "The clip could not be uploaded. Try attaching it again.",
          true,
        );
    } catch (error) {
      message((error as Error).message, true);
    } finally {
      worker?.terminate();
      worker = undefined;
      lock(false);
    }
  };
  dialog.showModal();
  find("source-query").focus();
}
