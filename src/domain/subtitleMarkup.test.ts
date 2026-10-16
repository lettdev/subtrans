import { describe, expect, it } from "vitest";
import { parseSubtitleMarkup } from "./subtitleMarkup";

describe("subtitle markup", () => {
  it("renders nested SRT formatting tags as styled text runs", () => {
    const runs = parseSubtitleMarkup("Normal <i>italic <b>and bold</b></i> end");
    expect(runs.map((run) => [run.text, run.italic, run.bold])).toEqual([
      ["Normal ", false, false],
      ["italic ", true, false],
      ["and bold", true, true],
      [" end", false, false],
    ]);
  });

  it("supports safe font colors, line breaks, and ASS style toggles", () => {
    const runs = parseSubtitleMarkup('<font color="#ffcc00">Gold</font><br>{\\i1}Italic{\\i0}');
    expect(runs[0]).toMatchObject({ text: "Gold", color: "#ffcc00" });
    expect(runs[1].text).toBe("\n");
    expect(runs[2]).toMatchObject({ text: "Italic", italic: true });
  });

  it("never exposes unsupported HTML as executable markup", () => {
    const runs = parseSubtitleMarkup('<img src=x onerror="alert(1)">Safe &amp; sound<script>alert(2)</script>');
    expect(runs.map((run) => run.text).join("")).toBe("Safe & soundalert(2)");
  });
});
