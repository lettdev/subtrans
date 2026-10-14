import { SubtitleCue } from "./subtitle";

export type CueIssueCode = "empty" | "timing" | "overlap" | "short" | "line" | "cps";

export interface CueIssue {
  code: CueIssueCode;
  message: string;
}

export function validateCue(cue: SubtitleCue, previous?: SubtitleCue): CueIssue[] {
  const issues: CueIssue[] = [];
  const text = cue.translatedText.trim() || cue.sourceText.trim();
  const durationSeconds = (cue.endMs - cue.startMs) / 1_000;

  if (!text) issues.push({ code: "empty", message: "Cue không có nội dung." });
  if (cue.startMs < 0 || cue.endMs <= cue.startMs) {
    issues.push({ code: "timing", message: "Timing không hợp lệ." });
  }
  if (previous && cue.startMs < previous.endMs) {
    issues.push({ code: "overlap", message: "Cue chồng thời gian với cue trước." });
  }
  if (durationSeconds > 0 && durationSeconds < 0.7) {
    issues.push({ code: "short", message: "Thời lượng ngắn hơn 0,7 giây." });
  }
  if (text.split("\n").some((line) => line.length > 42)) {
    issues.push({ code: "line", message: "Có dòng dài hơn 42 ký tự." });
  }
  if (durationSeconds > 0 && text.replace(/\s/g, "").length / durationSeconds > 20) {
    issues.push({ code: "cps", message: "Tốc độ đọc vượt 20 ký tự/giây." });
  }

  return issues;
}

export function validateCues(cues: SubtitleCue[]): Map<string, CueIssue[]> {
  const result = new Map<string, CueIssue[]>();
  cues.forEach((cue, index) => {
    const issues = validateCue(cue, cues[index - 1]);
    if (issues.length) result.set(cue.uid, issues);
  });
  return result;
}
