import { describe, expect, it } from "vitest";
import { SubtitleCue } from "./subtitle";
import {
  buildGeminiPrompt,
  createTranslationSettings,
  isCueEligibleForTranslation,
  parseGeminiBatchResponse,
  planTranslationBatches,
  sourceFingerprint,
} from "./translation";

function cue(index: number, status: SubtitleCue["status"] = "empty", translatedText = ""): SubtitleCue {
  return {
    uid: `cue-${index}`,
    index,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    sourceText: `Line ${index}`,
    translatedText,
    status,
  };
}

describe("translation domain", () => {
  it("plans large request-efficient batches and protects human work", () => {
    const cues = Array.from({ length: 451 }, (_, index) => cue(index + 1));
    cues[3] = cue(4, "edited", "Bản dịch tay");
    cues[4] = cue(5, "approved", "Đã duyệt");
    cues[5] = cue(6, "draft", "Import");
    const batches = planTranslationBatches(cues, 200);
    expect(batches.map((batch) => batch.cues.length)).toEqual([200, 200, 48]);
    expect(batches.flatMap((batch) => batch.cues).some((item) => item.index === 4)).toBe(false);
    expect(isCueEligibleForTranslation(cues[3])).toBe(false);
  });

  it("builds one compact prompt containing memory and character choices", () => {
    const cues = [cue(1), cue(2), cue(3)];
    const batch = planTranslationBatches(cues, 150)[0];
    const prompt = buildGeminiPrompt(cues, batch, createTranslationSettings({ characterBible: "Mai xưng em với An." }), "An là anh của Mai.");
    expect(prompt).toContain("Mai xưng em với An.");
    expect(prompt).toContain("An là anh của Mai.");
    expect(prompt).toContain('"id":"cue-1"');
  });

  it("salvages completed cue objects from a truncated stream", () => {
    const partial = '{"translations":[{"id":"cue-1","text":"Xin chào"},{"id":"cue-2","text":"Dở dang';
    expect(parseGeminiBatchResponse(partial).translations).toEqual([{ id: "cue-1", text: "Xin chào" }]);
  });

  it("creates a stable source fingerprint", () => {
    expect(sourceFingerprint("hello")).toBe(sourceFingerprint("hello"));
    expect(sourceFingerprint("hello")).not.toBe(sourceFingerprint("Hello"));
  });
});
