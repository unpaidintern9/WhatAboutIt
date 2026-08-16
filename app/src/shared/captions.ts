import type { TimelineCaptionCue } from "./timeline";

function parseTimestamp(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length > 0 ? Number(parts[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) return undefined;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function cleanCaptionText(lines: string[]) {
  return lines.join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function parseTimedCaptionDocument(text: string, idPrefix = "caption-import"): TimelineCaptionCue[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: TimelineCaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    const startMs = parseTimestamp(rawStart);
    const endMs = parseTimestamp(rawEnd.trim().split(/\s+/)[0]);
    const cueText = cleanCaptionText(lines.slice(timingIndex + 1));
    if (startMs === undefined || endMs === undefined || endMs <= startMs || !cueText) continue;
    cues.push({ id: `${idPrefix}-${cues.length + 1}`, startMs, endMs, text: cueText });
  }
  return cues.sort((left, right) => left.startMs - right.startMs);
}

function splitTranscript(text: string) {
  const paragraphs = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sentences = paragraphs.flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean));
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (const word of words) {
      const candidate = [...current, word].join(" ");
      if (current.length > 0 && (current.length >= 12 || candidate.length > 72)) {
        chunks.push(current.join(" "));
        current = [word];
      } else {
        current.push(word);
      }
    }
    if (current.length > 0) chunks.push(current.join(" "));
  }
  return chunks;
}

export function autoTimeTranscript(text: string, startMs: number, endMs: number, idPrefix = "caption-auto"): TimelineCaptionCue[] {
  const chunks = splitTranscript(text);
  if (chunks.length === 0) return [];
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart + 250, Math.round(endMs));
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let elapsedWeight = 0;
  return chunks.map((chunk, index) => {
    const cueStart = safeStart + Math.round(((safeEnd - safeStart) * elapsedWeight) / totalWeight);
    elapsedWeight += weights[index];
    const cueEnd = index === chunks.length - 1 ? safeEnd : safeStart + Math.round(((safeEnd - safeStart) * elapsedWeight) / totalWeight);
    return { id: `${idPrefix}-${index + 1}`, startMs: cueStart, endMs: Math.max(cueStart + 1, cueEnd), text: chunk };
  });
}
