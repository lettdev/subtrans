export type CueStatus = "empty" | "machine" | "draft" | "edited" | "approved";

export interface CueTranslationMeta {
  provider: "gemini";
  model: string;
  sourceHash: string;
  translatedAt: string;
}

export interface SubtitleCue {
  uid: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText: string;
  status: CueStatus;
  translationMeta?: CueTranslationMeta;
}

export interface ParseIssue {
  block: number;
  message: string;
}

export interface ParseResult {
  cues: SubtitleCue[];
  issues: ParseIssue[];
}

const TIMESTAMP_PATTERN = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/;

export function timestampToMs(value: string): number | null {
  const match = value.trim().match(new RegExp(`^${TIMESTAMP_PATTERN.source}$`));
  if (!match) return null;

  const [, hours, minutes, seconds, milliseconds] = match;
  const minute = Number(minutes);
  const second = Number(seconds);
  if (minute > 59 || second > 59) return null;

  return (
    Number(hours) * 3_600_000 +
    minute * 60_000 +
    second * 1_000 +
    Number(milliseconds.padEnd(3, "0").slice(0, 3))
  );
}

export function msToTimestamp(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  const hours = Math.floor(safeValue / 3_600_000);
  const minutes = Math.floor((safeValue % 3_600_000) / 60_000);
  const seconds = Math.floor((safeValue % 60_000) / 1_000);
  const milliseconds = safeValue % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function createCueUid(index: number, startMs: number, ordinal: number): string {
  return `cue-${index}-${startMs}-${ordinal}`;
}

export function parseSrt(content: string): ParseResult {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) return { cues: [], issues: [] };

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  const issues: ParseIssue[] = [];

  blocks.forEach((rawBlock, blockIndex) => {
    const lines = rawBlock.split("\n");
    if (lines.length < 2) {
      issues.push({ block: blockIndex + 1, message: "Khối subtitle không đủ dữ liệu." });
      return;
    }

    let timeLineIndex = 0;
    let sourceIndex = blockIndex + 1;
    if (!lines[0].includes("-->")) {
      const parsedIndex = Number.parseInt(lines[0].trim(), 10);
      if (Number.isFinite(parsedIndex)) sourceIndex = parsedIndex;
      timeLineIndex = 1;
    }

    const timeLine = lines[timeLineIndex]?.trim() ?? "";
    const arrowIndex = timeLine.indexOf("-->");
    if (arrowIndex < 0) {
      issues.push({ block: blockIndex + 1, message: "Không tìm thấy dòng thời gian." });
      return;
    }

    const startMs = timestampToMs(timeLine.slice(0, arrowIndex).trim());
    const endToken = timeLine.slice(arrowIndex + 3).trim().split(/\s+/)[0];
    const endMs = timestampToMs(endToken);
    if (startMs === null || endMs === null || endMs <= startMs) {
      issues.push({ block: blockIndex + 1, message: "Mốc thời gian không hợp lệ." });
      return;
    }

    const sourceText = lines.slice(timeLineIndex + 1).join("\n").trim();
    cues.push({
      uid: createCueUid(sourceIndex, startMs, blockIndex),
      index: sourceIndex,
      startMs,
      endMs,
      sourceText,
      translatedText: "",
      status: "empty",
    });
  });

  return { cues, issues };
}

export function generateSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      const outputText = (cue.translatedText.trim() || cue.sourceText.trim())
        .replace(/\r\n?/g, "\n")
        .replace(/\n/g, "\r\n");
      return `${index + 1}\r\n${msToTimestamp(cue.startMs)} --> ${msToTimestamp(cue.endMs)}\r\n${outputText}\r\n`;
    })
    .join("\r\n");
}

export function findCueAtTime(cues: SubtitleCue[], currentMs: number): SubtitleCue | null {
  return cues.find((cue) => currentMs >= cue.startMs && currentMs <= cue.endMs) ?? null;
}
