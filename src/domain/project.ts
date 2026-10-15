import { SubtitleCue } from "./subtitle";
import {
  createTranslationSettings,
  createTranslationSession,
  TranslationSession,
  TranslationSettings,
} from "./translation";

export const PROJECT_VERSION = 3;
export const AUTOSAVE_KEY = "subtrans.phase2.autosave";

export interface SubTransProject {
  version: 3;
  name: string;
  subtitleFileName: string;
  mediaName: string;
  mediaPath?: string;
  mediaProxyPath?: string;
  externalAudioName: string;
  externalAudioPath?: string;
  cues: SubtitleCue[];
  translation: {
    settings: TranslationSettings;
    session: TranslationSession;
  };
  createdAt: string;
  updatedAt: string;
}

export function createProject(
  cues: SubtitleCue[] = [],
  options: Partial<Pick<SubTransProject, "name" | "subtitleFileName" | "mediaName" | "mediaPath" | "mediaProxyPath" | "externalAudioName" | "externalAudioPath">> = {},
): SubTransProject {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    name: options.name || options.subtitleFileName?.replace(/\.srt$/i, "") || "Untitled project",
    subtitleFileName: options.subtitleFileName || "",
    mediaName: options.mediaName || "",
    mediaPath: options.mediaPath,
    mediaProxyPath: options.mediaProxyPath,
    externalAudioName: options.externalAudioName || "",
    externalAudioPath: options.externalAudioPath,
    cues,
    translation: {
      settings: createTranslationSettings(),
      session: createTranslationSession(),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeProject(project: SubTransProject): string {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

export function parseProject(content: string): SubTransProject {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") throw new Error("Project không hợp lệ.");

  const version = (parsed as { version?: unknown }).version;
  if (version !== 1 && version !== 2 && version !== PROJECT_VERSION) {
    throw new Error(`Không hỗ trợ project version ${String(version)}.`);
  }
  const candidate = parsed as Partial<SubTransProject>;
  if (!Array.isArray(candidate.cues)) throw new Error("Project không chứa danh sách cue.");

  const cues = candidate.cues.map((cue, index) => {
    if (
      !cue ||
      typeof cue.uid !== "string" ||
      typeof cue.startMs !== "number" ||
      typeof cue.endMs !== "number" ||
      typeof cue.sourceText !== "string" ||
      typeof cue.translatedText !== "string"
    ) {
      throw new Error(`Cue ${index + 1} trong project không hợp lệ.`);
    }
    return { ...cue, index: index + 1 } as SubtitleCue;
  });

  return {
    version: PROJECT_VERSION,
    name: typeof candidate.name === "string" ? candidate.name : "Untitled project",
    subtitleFileName: typeof candidate.subtitleFileName === "string" ? candidate.subtitleFileName : "",
    mediaName: typeof candidate.mediaName === "string" ? candidate.mediaName : "",
    mediaPath: typeof candidate.mediaPath === "string" ? candidate.mediaPath : undefined,
    mediaProxyPath: typeof candidate.mediaProxyPath === "string" ? candidate.mediaProxyPath : undefined,
    externalAudioName: typeof candidate.externalAudioName === "string" ? candidate.externalAudioName : "",
    externalAudioPath: typeof candidate.externalAudioPath === "string" ? candidate.externalAudioPath : undefined,
    cues,
    translation: {
      settings: createTranslationSettings(candidate.translation?.settings),
      session: createTranslationSession(candidate.translation?.session),
    },
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}

export function projectFileName(name: string): string {
  const safe = name.trim().replace(/[<>:"/\\|?*]+/g, "-") || "untitled";
  return `${safe}.subtrans.json`;
}
