import { describe, expect, it } from "vitest";
import { findCueAtTime, generateSrt, msToTimestamp, parseSrt, timestampToMs } from "./subtitle";

const sample = `\uFEFF1\r
00:00:01,250 --> 00:00:03,500\r
First line\r
Second line\r
\r
2\r
00:00:04.000 --> 00:00:05.100\r
Hello there`;

describe("subtitle domain", () => {
  it("parses BOM, CRLF, multiline text and dot milliseconds", () => {
    const result = parseSrt(sample);
    expect(result.issues).toEqual([]);
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].sourceText).toBe("First line\nSecond line");
    expect(result.cues[1].startMs).toBe(4_000);
  });

  it("reports malformed blocks without discarding valid cues", () => {
    const result = parseSrt(`${sample}\n\n3\ninvalid\nBroken`);
    expect(result.cues).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
  });

  it("converts timestamps both ways", () => {
    expect(timestampToMs("01:02:03,004")).toBe(3_723_004);
    expect(msToTimestamp(3_723_004)).toBe("01:02:03,004");
  });

  it("exports translated text and falls back to source", () => {
    const cues = parseSrt(sample).cues;
    cues[0].translatedText = "Dòng một\nDòng hai";
    const output = generateSrt(cues);
    expect(output).toContain("Dòng một\r\nDòng hai");
    expect(output).toContain("Hello there");
  });

  it("finds a cue at the current playback time", () => {
    const cues = parseSrt(sample).cues;
    expect(findCueAtTime(cues, 2_000)?.index).toBe(1);
    expect(findCueAtTime(cues, 3_750)).toBeNull();
  });

  it("still finds the active cue after manual timing edits make cues unsorted", () => {
    const cues = parseSrt(sample).cues;
    cues[0].startMs = 8_000;
    cues[0].endMs = 9_000;
    expect(findCueAtTime(cues, 4_500)?.index).toBe(2);
  });
});
