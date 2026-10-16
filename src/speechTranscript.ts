export type RecognitionResults = {
  length: number;
  [index: number]: { isFinal: boolean; [index: number]: { transcript: string } };
};

type SpeechDevice = { userAgent: string; platform: string; maxTouchPoints: number };

export function mobileSpeechService(device: SpeechDevice): boolean {
  return /Android|iPhone|iPad|iPod/i.test(device.userAgent)
    || (device.platform === 'MacIntel' && device.maxTouchPoints > 1);
}

function words(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)]
    .map(match => ({ key: match[0].toLocaleLowerCase('de'), start: match.index }));
}

function joinResult(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  const left = words(previous);
  const right = words(next);
  // Some mobile services return growing, overlapping hypotheses at NEW result
  // indices (occasionally even marked final). Remove only result-boundary overlap,
  // never repetitions inside a result such as "sehr, sehr wichtig".
  for (let count = Math.min(left.length, right.length); count > 0; count--) {
    const cumulativeExtension = count === left.length && right.length > count;
    if (count < 2 && !cumulativeExtension) continue;
    if (!right.slice(0, count).every((word, index) => word.key === left[left.length - count + index].key)) continue;
    if (count === right.length) return previous;
    return `${previous} ${next.slice(right[count].start)}`;
  }
  return `${previous} ${next}`;
}

export function speechTranscript(results: RecognitionResults): string {
  let transcript = '';
  // This is a complete session snapshot, not a list of newly spoken chunks.
  // Rebuild it so corrections and removed interim results replace old text.
  for (let index = 0; index < results.length; index++) {
    const next = results[index]?.[0]?.transcript.normalize('NFC').replace(/\s+/g, ' ').trim() || '';
    transcript = joinResult(transcript, next);
  }
  return transcript;
}
