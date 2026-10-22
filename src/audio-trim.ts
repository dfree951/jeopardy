export function trimBounds(start: number, end: number, duration: number) {
  if (
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end > duration + 0.001 ||
    end <= start
  )
    throw new Error(
      "Choose an end time after the start time, within the recording.",
    );
  if (end - start > 120)
    throw new Error("Keep the clip to two minutes or less.");
  if (end - start < 0.1)
    throw new Error("Select at least 0.1 seconds of audio.");
  return { start, end: Math.min(end, duration) };
}
export function pcm16(channel: Float32Array) {
  return Int16Array.from(channel, (value) => {
    const sample = Math.max(-1, Math.min(1, value));
    return Math.round(sample * (sample < 0 ? 32768 : 32767));
  });
}
