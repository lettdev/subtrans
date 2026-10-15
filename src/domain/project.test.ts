import { describe, expect, it } from "vitest";
import { createProject, parseProject, projectFileName, serializeProject } from "./project";
import { parseSrt } from "./subtitle";
import { validateCues } from "./validation";

const content = `1\n00:00:01,000 --> 00:00:01,400\nA very long subtitle line that should be reported by validation\n\n2\n00:00:01,300 --> 00:00:03,000\nHello`;

describe("project domain", () => {
  it("round-trips a versioned project", () => {
    const project = createProject(parseSrt(content).cues, {
      name: "Movie: One",
      externalAudioName: "episode.m4a",
      externalAudioPath: "C:\\Media\\episode.m4a",
    });
    const restored = parseProject(serializeProject(project));
    expect(restored.version).toBe(3);
    expect(restored.cues).toHaveLength(2);
    expect(restored.externalAudioName).toBe("episode.m4a");
    expect(restored.externalAudioPath).toBe("C:\\Media\\episode.m4a");
    expect(projectFileName(restored.name)).toBe("Movie- One.subtrans.json");
  });

  it("rejects an unknown project version", () => {
    expect(() => parseProject('{"version":99,"cues":[]}')).toThrow(/version 99/);
  });

  it("migrates a Phase 2 project without storing any API key", () => {
    const restored = parseProject('{"version":1,"name":"Legacy","cues":[]}');
    expect(restored.version).toBe(3);
    expect(restored.translation.settings.batchSize).toBe(220);
    expect(JSON.stringify(restored)).not.toContain("apiKey");
  });

  it("migrates a Phase 3 project and keeps its translation settings", () => {
    const restored = parseProject('{"version":2,"name":"Phase 3","cues":[],"translation":{"settings":{"batchSize":180},"session":{"status":"paused"}}}');
    expect(restored.version).toBe(3);
    expect(restored.translation.settings.batchSize).toBe(180);
    expect(restored.translation.session.status).toBe("paused");
  });

  it("finds timing, overlap, line length and reading-speed issues", () => {
    const cues = parseSrt(content).cues;
    const issues = validateCues(cues);
    expect(issues.get(cues[0].uid)?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["short", "line", "cps"]),
    );
    expect(issues.get(cues[1].uid)?.map((issue) => issue.code)).toContain("overlap");
  });
});
