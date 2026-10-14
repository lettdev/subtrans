import { SubtitleCue } from "./subtitle";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const ECONOMY_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MIN_BATCH_SIZE = 150;
export const MAX_BATCH_SIZE = 300;
export const DEFAULT_BATCH_SIZE = 220;
const DEFAULT_MAX_SOURCE_CHARACTERS = 36_000;

export interface TranslationSettings {
  model: string;
  batchSize: number;
  dailyRequestBudget: number;
  reserveRequests: number;
  targetLanguage: string;
  projectContext: string;
  characterBible: string;
}

export type TranslationRunStatus = "idle" | "running" | "paused" | "quota" | "error" | "complete";

export interface TranslationSession {
  status: TranslationRunStatus;
  requestsUsed: number;
  inputTokens: number;
  outputTokens: number;
  translatedCues: number;
  rollingMemory: string;
  lastError: string;
  usageDate: string;
  updatedAt: string;
}

export interface TranslationBatch {
  id: string;
  cues: SubtitleCue[];
  sourceCharacters: number;
}

export interface GeminiTranslation {
  id: string;
  text: string;
}

export interface GeminiBatchResponse {
  translations: GeminiTranslation[];
  memory: string;
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function clampBatchSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.round(value)));
}

export function createTranslationSettings(input: Partial<TranslationSettings> = {}): TranslationSettings {
  return {
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : DEFAULT_GEMINI_MODEL,
    batchSize: clampBatchSize(input.batchSize ?? DEFAULT_BATCH_SIZE),
    dailyRequestBudget: Math.max(1, Math.round(input.dailyRequestBudget ?? 20)),
    reserveRequests: Math.max(0, Math.round(input.reserveRequests ?? 2)),
    targetLanguage: typeof input.targetLanguage === "string" && input.targetLanguage.trim() ? input.targetLanguage.trim() : "Vietnamese",
    projectContext: typeof input.projectContext === "string" ? input.projectContext.slice(0, 12_000) : "",
    characterBible: typeof input.characterBible === "string" ? input.characterBible.slice(0, 16_000) : "",
  };
}

export function createTranslationSession(input: Partial<TranslationSession> = {}): TranslationSession {
  const allowedStatuses: TranslationRunStatus[] = ["idle", "running", "paused", "quota", "error", "complete"];
  const status = allowedStatuses.includes(input.status as TranslationRunStatus) ? input.status as TranslationRunStatus : "idle";
  return {
    status: status === "running" ? "paused" : status,
    requestsUsed: Math.max(0, Math.round(input.requestsUsed ?? 0)),
    inputTokens: Math.max(0, Math.round(input.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.round(input.outputTokens ?? 0)),
    translatedCues: Math.max(0, Math.round(input.translatedCues ?? 0)),
    rollingMemory: typeof input.rollingMemory === "string" ? input.rollingMemory.slice(0, 8_000) : "",
    lastError: typeof input.lastError === "string" ? input.lastError : "",
    usageDate: typeof input.usageDate === "string" ? input.usageDate : geminiQuotaDate(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

export function geminiQuotaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function resetDailyUsageIfNeeded(session: TranslationSession, date = new Date()): TranslationSession {
  const usageDate = geminiQuotaDate(date);
  if (session.usageDate === usageDate) return session;
  return {
    ...session,
    status: session.status === "quota" ? "paused" : session.status,
    requestsUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageDate,
    lastError: "",
    updatedAt: date.toISOString(),
  };
}

export function isCueProtected(cue: SubtitleCue): boolean {
  return cue.status === "edited" || cue.status === "approved" || cue.status === "draft";
}

export function isCueEligibleForTranslation(cue: SubtitleCue): boolean {
  return Boolean(cue.sourceText.trim()) && !cue.translatedText.trim() && !isCueProtected(cue);
}

export function planTranslationBatches(
  cues: SubtitleCue[],
  requestedBatchSize = DEFAULT_BATCH_SIZE,
  maxSourceCharacters = DEFAULT_MAX_SOURCE_CHARACTERS,
): TranslationBatch[] {
  const batchSize = clampBatchSize(requestedBatchSize);
  const eligible = cues.filter(isCueEligibleForTranslation);
  const batches: TranslationBatch[] = [];
  let current: SubtitleCue[] = [];
  let characters = 0;

  const flush = () => {
    if (!current.length) return;
    batches.push({ id: `batch-${batches.length + 1}`, cues: current, sourceCharacters: characters });
    current = [];
    characters = 0;
  };

  for (const cue of eligible) {
    const cueCharacters = cue.sourceText.length;
    if (current.length && (current.length >= batchSize || characters + cueCharacters > maxSourceCharacters)) flush();
    current.push(cue);
    characters += cueCharacters;
  }
  flush();
  return batches;
}

export function estimateRemainingRequests(cues: SubtitleCue[], settings: TranslationSettings): number {
  return planTranslationBatches(cues, settings.batchSize).length;
}

export function remainingDailyRequests(settings: TranslationSettings, session: TranslationSession): number {
  return Math.max(0, settings.dailyRequestBudget - settings.reserveRequests - session.requestsUsed);
}

function contextSlice(cues: SubtitleCue[], firstIndex: number, lastIndex: number): Array<[string, string]> {
  return cues
    .slice(Math.max(0, firstIndex - 3), Math.min(cues.length, lastIndex + 4))
    .filter((cue) => cue.index < firstIndex || cue.index > lastIndex)
    .map((cue) => [cue.sourceText, cue.translatedText]);
}

export function buildGeminiPrompt(
  allCues: SubtitleCue[],
  batch: TranslationBatch,
  settings: TranslationSettings,
  rollingMemory: string,
): string {
  const firstIndex = batch.cues[0]?.index ?? 0;
  const lastIndex = batch.cues.at(-1)?.index ?? firstIndex;
  const payload = batch.cues.map((cue) => ({ id: cue.uid, text: cue.sourceText }));
  const neighbors = contextSlice(allCues, firstIndex, lastIndex);

  return [
    `Translate every subtitle cue to ${settings.targetLanguage}.`,
    "Preserve meaning, tone, line breaks, names, honorifics, pronouns, and consistent forms of address.",
    "Return exactly one translation for every input id. Never merge, omit, reorder, explain, or add formatting.",
    "Keep each subtitle concise and natural for screen reading.",
    settings.projectContext ? `PROJECT_CONTEXT:\n${settings.projectContext}` : "",
    settings.characterBible ? `CHARACTER_BIBLE:\n${settings.characterBible}` : "",
    rollingMemory ? `ROLLING_MEMORY:\n${rollingMemory}` : "ROLLING_MEMORY: none yet",
    neighbors.length ? `NEIGHBOR_CONTEXT_JSON:\n${JSON.stringify(neighbors)}` : "",
    `CUES_JSON:\n${JSON.stringify(payload)}`,
    "Update memory compactly (max 1200 characters) with only durable facts: character identities, relationships, chosen names, pronouns/forms of address, terminology, and unresolved ambiguity.",
  ].filter(Boolean).join("\n\n");
}

function normalizeResponse(value: unknown): GeminiBatchResponse {
  if (!value || typeof value !== "object") return { translations: [], memory: "" };
  const candidate = value as { translations?: unknown; memory?: unknown };
  const translations = Array.isArray(candidate.translations)
    ? candidate.translations.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as { id?: unknown; text?: unknown };
      return typeof entry.id === "string" && typeof entry.text === "string"
        ? [{ id: entry.id, text: entry.text.trim() }]
        : [];
    })
    : [];
  return { translations, memory: typeof candidate.memory === "string" ? candidate.memory.slice(0, 8_000) : "" };
}

function extractCompleteObjects(text: string): string[] {
  const keyIndex = text.indexOf('"translations"');
  const arrayStart = keyIndex >= 0 ? text.indexOf("[", keyIndex) : -1;
  if (arrayStart < 0) return [];

  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) objects.push(text.slice(start, index + 1));
    } else if (character === "]" && depth === 0) break;
  }
  return objects;
}

export function parseGeminiBatchResponse(text: string): GeminiBatchResponse {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return normalizeResponse(JSON.parse(cleaned));
  } catch {
    const translations = extractCompleteObjects(cleaned).flatMap((item) => {
      try {
        const parsed = JSON.parse(item) as { id?: unknown; text?: unknown };
        return typeof parsed.id === "string" && typeof parsed.text === "string"
          ? [{ id: parsed.id, text: parsed.text.trim() }]
          : [];
      } catch {
        return [];
      }
    });
    const memoryMatch = cleaned.match(/"memory"\s*:\s*"((?:\\.|[^"\\])*)"/s);
    let memory = "";
    if (memoryMatch) {
      try { memory = JSON.parse(`"${memoryMatch[1]}"`).slice(0, 8_000); } catch { memory = ""; }
    }
    return { translations, memory };
  }
}

export function sourceFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
