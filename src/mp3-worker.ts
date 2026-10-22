import { Mp3Encoder } from "@breezystack/lamejs";
import { pcm16 } from "./audio-trim";
self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>,
) => {
  try {
    const channels = event.data.channels.map(pcm16);
    const encoder = new Mp3Encoder(channels.length, event.data.sampleRate, 128);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < channels[0].length; offset += 1152) {
      const chunk = encoder.encodeBuffer(
        channels[0].subarray(offset, offset + 1152),
        channels[1]?.subarray(offset, offset + 1152),
      );
      if (chunk.length) chunks.push(new Uint8Array(chunk));
    }
    chunks.push(new Uint8Array(encoder.flush()));
    self.postMessage({ blob: new Blob(chunks, { type: "audio/mpeg" }) });
  } catch {
    self.postMessage({
      error: "The MP3 could not be created. Try another recording.",
    });
  }
};
