import { describe, expect, it } from "vitest";
import { assessMediaFile, externalAudioNeedsSync, getFileExtension } from "./media";

describe("media compatibility", () => {
  it("routes Windows-unfriendly containers through the proxy workflow", () => {
    expect(assessMediaFile({ name: "episode.mkv", type: "video/x-matroska" }).compatibility).toBe("uncertain");
    expect(assessMediaFile({ name: "archive.AVI", type: "video/x-msvideo" }).compatibility).toBe("uncertain");
  });

  it("keeps common WebView2 containers on direct playback", () => {
    expect(assessMediaFile({ name: "episode.mp4", type: "video/mp4" }).compatibility).toBe("direct");
    expect(getFileExtension("movie.final.MOV")).toBe("mov");
  });

  it("only corrects external-audio drift after the tolerance is exceeded", () => {
    expect(externalAudioNeedsSync(12, 12.5)).toBe(false);
    expect(externalAudioNeedsSync(12, 12.751)).toBe(true);
  });
});
