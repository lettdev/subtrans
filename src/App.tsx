import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { assessMediaFile, MediaAssessment } from "./domain/media";
import {
  AUTOSAVE_KEY,
  createProject,
  parseProject,
  projectFileName,
  serializeProject,
  SubTransProject,
} from "./domain/project";
import {
  CueStatus,
  findCueAtTime,
  generateSrt,
  msToTimestamp,
  parseSrt,
  SubtitleCue,
  timestampToMs,
} from "./domain/subtitle";
import { parseSubtitleMarkup } from "./domain/subtitleMarkup";
import { validateCues } from "./domain/validation";
import {
  buildGeminiPrompt,
  createTranslationSettings,
  estimateRemainingRequests,
  isCueEligibleForTranslation,
  planTranslationBatches,
  remainingDailyRequests,
  resetDailyUsageIfNeeded,
  sourceFingerprint,
  TranslationBatch,
} from "./domain/translation";
import {
  baseName,
  chooseNativePath,
  nativeMediaUrl,
  readNativeText,
  runningInTauri,
  saveNativeProjectPath,
  saveNativeSubtitlePath,
  writeNativeProject,
  writeNativeText,
} from "./platform/files";
import { deleteGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey } from "./platform/secrets";
import {
  cancelMediaProxy,
  createMediaProxy,
  FfmpegStatus,
  getFfmpegStatus,
  onProxyProgress,
  ProxyProgress,
} from "./platform/mediaProxy";

type IconName =
  | "ai"
  | "approve"
  | "audio"
  | "captions"
  | "check"
  | "chevron"
  | "clock"
  | "download"
  | "film"
  | "filter"
  | "folder"
  | "info"
  | "key"
  | "merge"
  | "new"
  | "play"
  | "pause"
  | "plus"
  | "redo"
  | "save"
  | "search"
  | "settings"
  | "split"
  | "subtitles"
  | "trash"
  | "undo"
  | "upload"
  | "warning";

const ICON_PATHS: Record<IconName, ReactNode> = {
  ai: <><path d="m12 3 1.2 4.1a5.2 5.2 0 0 0 3.7 3.7L21 12l-4.1 1.2a5.2 5.2 0 0 0-3.7 3.7L12 21l-1.2-4.1a5.2 5.2 0 0 0-3.7-3.7L3 12l4.1-1.2a5.2 5.2 0 0 0 3.7-3.7Z"/><path d="m19 3 .4 1.4A2 2 0 0 0 21 6l-1.6.4A2 2 0 0 0 18 8l-.4-1.6A2 2 0 0 0 16 5l1.6-.6A2 2 0 0 0 19 3Z"/></>,
  approve: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  audio: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  captions: <><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M9 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3"/></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 16h4M17 8h4M17 16h4"/></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></>,
  merge: <><path d="M7 4v4c0 2.2 1.8 4 4 4h6"/><path d="M7 20v-4c0-2.2 1.8-4 4-4"/><path d="m14 9 3 3-3 3"/></>,
  new: <><path d="M5 3h10l4 4v14H5Z"/><path d="M14 3v5h5M9 14h6M12 11v6"/></>,
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  plus: <path d="M12 5v14M5 12h14" />,
  redo: <><path d="m15 6 4 4-4 4"/><path d="M19 10h-7a6 6 0 0 0-6 6v2"/></>,
  save: <><path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  split: <><path d="M12 3v18"/><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/></>,
  subtitles: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 11h4M7 15h2M13 11h4M11 15h6"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
  undo: <><path d="m9 6-4 4 4 4"/><path d="M5 10h7a6 6 0 0 1 6 6v2"/></>,
  upload: <><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></>,
  warning: <><path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name]}</svg>;
}

function formatPlaybackTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${minuteText}:${String(seconds).padStart(2, "0")}`;
}

function translatedFileName(sourceName: string): string {
  if (!sourceName) return "translated.vi.srt";
  return sourceName.replace(/(?:\.[a-z]{2,3})?\.srt$/i, ".vi.srt");
}

function downloadText(contents: string, fileName: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function nextUid(): string {
  return typeof crypto.randomUUID === "function"
    ? `cue-${crypto.randomUUID()}`
    : `cue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function reindex(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, index) => ({ ...cue, index: index + 1 }));
}

function splitText(text: string): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text, ""];
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

function AutoTextarea({ value, label, placeholder, onChange, onFocus, onBlur }: {
  value: string;
  label: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = `${Math.max(62, ref.current.scrollHeight)}px`;
  }, []);
  useEffect(resize, [resize, value]);

  return <textarea ref={ref} aria-label={label} value={value} placeholder={placeholder} rows={2} spellCheck={false} onFocus={onFocus} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} onInput={resize} />;
}

function SubtitleOverlayText({ text }: { text: string }) {
  const runs = useMemo(() => parseSubtitleMarkup(text), [text]);
  return <>{runs.map((run, index) => <span
    key={`${index}-${run.text.length}`}
    style={{
      color: run.color,
      fontStyle: run.italic ? "italic" : undefined,
      fontWeight: run.bold ? 800 : undefined,
      textDecorationLine: [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
    }}
  >{run.text}</span>)}</>;
}

function TimeInput({ value, label, onBegin, onCommit, onEnd }: {
  value: number;
  label: string;
  onBegin: () => void;
  onCommit: (value: number) => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState(msToTimestamp(value));
  useEffect(() => setDraft(msToTimestamp(value)), [value]);
  const commit = () => {
    const parsed = timestampToMs(draft);
    if (parsed === null) setDraft(msToTimestamp(value));
    else onCommit(parsed);
    onEnd();
  };

  return <input aria-label={label} value={draft} onFocus={onBegin} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

type CueFilter = "all" | "empty" | "translated" | "edited" | "approved" | "issues";
type SaveState = "idle" | "saving" | "saved" | "error";
type ProxyRunState = "idle" | "running" | "error" | "complete";

const FFMPEG_PATH_KEY = "subtrans.ffmpeg-path";
const EXTERNAL_AUDIO_VOLUME_KEY = "subtrans.external-audio-volume";

function App() {
  const [project, setProject] = useState<SubTransProject>(() => createProject());
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [parseIssueCount, setParseIssueCount] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [externalAudioUrl, setExternalAudioUrl] = useState<string | null>(null);
  const [externalAudioVolume, setExternalAudioVolume] = useState(() => {
    const stored = Number.parseFloat(localStorage.getItem(EXTERNAL_AUDIO_VOLUME_KEY) ?? "1");
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1;
  });
  const [mediaAssessment, setMediaAssessment] = useState<MediaAssessment | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [notice, setNotice] = useState("Sẵn sàng mở một project mới.");
  const [searchQuery, setSearchQuery] = useState("");
  const [cueFilter, setCueFilter] = useState<CueFilter>("all");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [ffmpegPath, setFfmpegPath] = useState(() => localStorage.getItem(FFMPEG_PATH_KEY) ?? "");
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [ffmpegChecking, setFfmpegChecking] = useState(false);
  const [proxyRunState, setProxyRunState] = useState<ProxyRunState>("idle");
  const [proxyProgress, setProxyProgress] = useState<ProxyProgress>({ phase: "starting", processedMs: 0, percent: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const externalAudioRef = useRef<HTMLAudioElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const translatedInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pastRef = useRef<SubtitleCue[][]>([]);
  const futureRef = useRef<SubtitleCue[][]>([]);
  const editingKeyRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const translationAbortRef = useRef<AbortController | null>(null);

  const cues = project.cues;
  const activeCue = useMemo(() => findCueAtTime(cues, currentMs), [cues, currentMs]);
  const selectedCue = useMemo(() => cues.find((cue) => cue.uid === selectedUid) ?? null, [cues, selectedUid]);
  const validation = useMemo(() => validateCues(cues), [cues]);
  const translatedCount = useMemo(() => cues.filter((cue) => cue.translatedText.trim()).length, [cues]);
  const approvedCount = useMemo(() => cues.filter((cue) => cue.status === "approved").length, [cues]);
  const progress = cues.length === 0 ? 0 : Math.round((translatedCount / cues.length) * 100);
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const translationSettings = project.translation.settings;
  const translationSession = resetDailyUsageIfNeeded(project.translation.session);
  const plannedRequests = useMemo(() => estimateRemainingRequests(cues, translationSettings), [cues, translationSettings]);
  const translatableCount = useMemo(() => cues.filter(isCueEligibleForTranslation).length, [cues]);
  const dailyRequestsLeft = remainingDailyRequests(translationSettings, translationSession);
  const isTranslating = translationSession.status === "running";

  const visibleCues = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");
    return cues.filter((cue) => {
      const matchesSearch = !query || cue.sourceText.toLocaleLowerCase("vi").includes(query) || cue.translatedText.toLocaleLowerCase("vi").includes(query) || String(cue.index) === query;
      if (!matchesSearch) return false;
      if (cueFilter === "empty") return !cue.translatedText.trim();
      if (cueFilter === "translated") return Boolean(cue.translatedText.trim());
      if (cueFilter === "edited") return cue.status === "edited";
      if (cueFilter === "approved") return cue.status === "approved";
      if (cueFilter === "issues") return validation.has(cue.uid);
      return true;
    });
  }, [cueFilter, cues, searchQuery, validation]);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    editingKeyRef.current = null;
    setHistoryVersion((value) => value + 1);
  }, []);

  const checkpoint = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-99), project.cues.map((cue) => ({ ...cue }))];
    futureRef.current = [];
    setHistoryVersion((value) => value + 1);
  }, [project.cues]);

  const beginEdit = useCallback((key: string) => {
    if (editingKeyRef.current === key) return;
    editingKeyRef.current = key;
    checkpoint();
  }, [checkpoint]);

  const endEdit = () => { editingKeyRef.current = null; };

  const replaceCues = useCallback((next: SubtitleCue[] | ((current: SubtitleCue[]) => SubtitleCue[]), withCheckpoint = true) => {
    if (withCheckpoint) checkpoint();
    setProject((current) => ({
      ...current,
      cues: typeof next === "function" ? next(current.cues) : next,
      updatedAt: new Date().toISOString(),
    }));
  }, [checkpoint]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, project.cues.map((cue) => ({ ...cue }))];
    setProject((current) => ({ ...current, cues: previous }));
    setHistoryVersion((value) => value + 1);
  }, [project.cues]);

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1);
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, project.cues.map((cue) => ({ ...cue }))];
    setProject((current) => ({ ...current, cues: next }));
    setHistoryVersion((value) => value + 1);
  }, [project.cues]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const autosave = localStorage.getItem(AUTOSAVE_KEY);
    if (!autosave) return;
    try {
      const restored = parseProject(autosave);
      if (restored.cues.length || restored.subtitleFileName || restored.mediaName || restored.externalAudioName) {
        setProject(restored);
        setSelectedUid(restored.cues[0]?.uid ?? null);
        if (runningInTauri() && (restored.mediaProxyPath || restored.mediaPath)) {
          setVideoUrl(nativeMediaUrl(restored.mediaProxyPath || restored.mediaPath!));
        }
        if (runningInTauri() && restored.externalAudioPath) {
          setExternalAudioUrl(nativeMediaUrl(restored.externalAudioPath));
        }
        setNotice(`Đã khôi phục autosave “${restored.name}”.`);
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadGeminiApiKey()
      .then((value) => { if (active) setApiKey(value ?? ""); })
      .catch(() => { if (active) setNotice("Không đọc được API key từ kho bảo mật của hệ điều hành."); })
      .finally(() => { if (active) setApiKeyLoaded(true); });
    return () => { active = false; };
  }, []);

  const checkFfmpeg = useCallback(async (path = ffmpegPath) => {
    if (!runningInTauri()) {
      setFfmpegStatus({ available: false });
      return;
    }
    setFfmpegChecking(true);
    try {
      const status = await getFfmpegStatus(path);
      setFfmpegStatus(status);
      if (status.available && status.path) {
        setNotice(`FFmpeg sẵn sàng: ${status.path}`);
      }
    } catch {
      setFfmpegStatus({ available: false });
    } finally {
      setFfmpegChecking(false);
    }
  }, [ffmpegPath]);

  useEffect(() => {
    void checkFfmpeg();
    if (!runningInTauri()) return;
    let unlisten: (() => void) | undefined;
    void onProxyProgress(setProxyProgress).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const normalized = resetDailyUsageIfNeeded(project.translation.session);
    if (normalized === project.translation.session) return;
    setProject((current) => ({ ...current, translation: { ...current.translation, session: normalized } }));
  }, [project.translation.session]);

  useEffect(() => () => translationAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!restoredRef.current || (!project.cues.length && !project.subtitleFileName && !project.mediaName && !project.externalAudioName)) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      const serialized = serializeProject(project);
      localStorage.setItem(AUTOSAVE_KEY, serialized);
      try {
        if (projectPath && runningInTauri()) await writeNativeProject(projectPath, serialized);
        setSaveState("saved");
        setLastSavedAt(new Date());
      } catch {
        setSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, projectPath]);

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (externalAudioUrl?.startsWith("blob:")) URL.revokeObjectURL(externalAudioUrl);
    };
  }, [externalAudioUrl]);

  useEffect(() => {
    localStorage.setItem(EXTERNAL_AUDIO_VOLUME_KEY, String(externalAudioVolume));
    if (externalAudioRef.current) externalAudioRef.current.volume = externalAudioVolume;
  }, [externalAudioUrl, externalAudioVolume]);

  useEffect(() => {
    if (!activeCue) return;
    rowRefs.current.get(activeCue.uid)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeCue?.uid]);

  useEffect(() => {
    if (selectedUid && !cues.some((cue) => cue.uid === selectedUid)) {
      setSelectedUid(cues[0]?.uid ?? null);
    }
  }, [cues, selectedUid]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = externalAudioRef.current;
    if (!video || !audio || !videoUrl || !externalAudioUrl) return;

    const alignAudio = () => {
      if (audio.readyState === 0) return;
      audio.currentTime = Math.max(0, video.currentTime);
    };
    const matchRate = () => {
      audio.playbackRate = video.playbackRate;
      audio.preservesPitch = true;
    };
    const playAudio = () => {
      alignAudio();
      matchRate();
      void audio.play().catch(() => {
        setNotice("Audio rời chưa phát được. Hãy thử play lại hoặc chọn một file audio khác.");
      });
    };
    const pauseAudio = () => audio.pause();
    const handleAudioReady = () => {
      alignAudio();
      matchRate();
      if (!video.paused) void audio.play().catch(() => undefined);
    };

    video.addEventListener("play", playAudio);
    video.addEventListener("pause", pauseAudio);
    video.addEventListener("seeking", alignAudio);
    video.addEventListener("ratechange", matchRate);
    video.addEventListener("ended", pauseAudio);
    audio.addEventListener("loadedmetadata", handleAudioReady);
    matchRate();
    if (!video.paused) playAudio();

    return () => {
      video.removeEventListener("play", playAudio);
      video.removeEventListener("pause", pauseAudio);
      video.removeEventListener("seeking", alignAudio);
      video.removeEventListener("ratechange", matchRate);
      video.removeEventListener("ended", pauseAudio);
      audio.removeEventListener("loadedmetadata", handleAudioReady);
      audio.pause();
    };
  }, [externalAudioUrl, videoUrl]);

  const jumpToCue = useCallback((cue: SubtitleCue, autoplay = true) => {
    setSelectedUid(cue.uid);
    if (!videoRef.current) return;
    videoRef.current.currentTime = cue.startMs / 1_000;
    setCurrentMs(cue.startMs);
    if (autoplay) void videoRef.current.play().catch(() => undefined);
  }, []);

  const saveProject = useCallback(async (saveAs = false) => {
    const contents = serializeProject(project);
    if (runningInTauri()) {
      let target = saveAs ? null : projectPath;
      if (!target) target = await saveNativeProjectPath(projectFileName(project.name));
      if (!target) return;
      try {
        await writeNativeProject(target, contents);
        setProjectPath(target);
        setSaveState("saved");
        setLastSavedAt(new Date());
        setNotice(`Đã lưu project ${baseName(target)}.`);
      } catch {
        setSaveState("error");
        setNotice("Không thể lưu project vào đường dẫn đã chọn.");
      }
    } else {
      downloadText(contents, projectFileName(project.name));
      setSaveState("saved");
      setLastSavedAt(new Date());
      setNotice("Đã tải project xuống máy.");
    }
  }, [project, projectPath]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      const player = videoRef.current;

      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (event.ctrlKey && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === "Space" && (!isEditing || event.ctrlKey || event.shiftKey)) {
        event.preventDefault();
        if (event.shiftKey && selectedCue) jumpToCue(selectedCue);
        else if (player) player.paused ? void player.play() : player.pause();
      }
      if (event.ctrlKey && (event.key === "ArrowDown" || event.key === "ArrowUp") && cues.length) {
        event.preventDefault();
        const anchorUid = selectedUid ?? activeCue?.uid ?? cues[0].uid;
        const currentIndex = Math.max(0, cues.findIndex((cue) => cue.uid === anchorUid));
        const delta = event.key === "ArrowDown" ? 1 : -1;
        jumpToCue(cues[Math.min(cues.length - 1, Math.max(0, currentIndex + delta))]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeCue?.uid, cues, jumpToCue, redo, saveProject, selectedCue, selectedUid, undo]);

  const loadSrtContent = (content: string, fileName: string) => {
    const result = parseSrt(content);
    if (!result.cues.length) {
      setNotice("Không tìm thấy cue hợp lệ trong file SRT.");
      return;
    }
    const next = createProject(result.cues, {
      name: fileName.replace(/\.srt$/i, ""),
      subtitleFileName: fileName,
      mediaName: project.mediaName,
      mediaPath: project.mediaPath,
      mediaProxyPath: project.mediaProxyPath,
      externalAudioName: project.externalAudioName,
      externalAudioPath: project.externalAudioPath,
    });
    setProject(next);
    setProjectPath(null);
    setParseIssueCount(result.issues.length);
    setSelectedUid(result.cues[0].uid);
    resetHistory();
    setNotice(result.issues.length ? `Đã mở ${result.cues.length} cue; bỏ qua ${result.issues.length} khối lỗi.` : `Đã mở ${result.cues.length} cue từ ${fileName}.`);
  };

  const chooseSubtitle = async () => {
    if (!runningInTauri()) return subtitleInputRef.current?.click();
    const path = await chooseNativePath("subtitle");
    if (path) loadSrtContent(await readNativeText(path), baseName(path));
  };

  const chooseVideo = async () => {
    if (!runningInTauri()) return videoInputRef.current?.click();
    const path = await chooseNativePath("video");
    if (!path) return;
    const name = baseName(path);
    setVideoUrl(nativeMediaUrl(path));
    setMediaAssessment(assessMediaFile({ name, type: "video/unknown" }));
    setMediaError("");
    setProject((current) => ({ ...current, mediaName: name, mediaPath: path, mediaProxyPath: undefined }));
    setNotice(`Đã nạp video ${name}.`);
  };

  const chooseExternalAudio = async () => {
    if (!runningInTauri()) return audioInputRef.current?.click();
    const path = await chooseNativePath("audio");
    if (!path) return;
    const name = baseName(path);
    setExternalAudioUrl(nativeMediaUrl(path));
    setProject((current) => ({ ...current, externalAudioName: name, externalAudioPath: path }));
    setNotice(`Đã nạp audio rời ${name}; track âm thanh trong video sẽ được tắt.`);
  };

  const removeExternalAudio = () => {
    externalAudioRef.current?.pause();
    setExternalAudioUrl(null);
    setProject((current) => ({ ...current, externalAudioName: "", externalAudioPath: undefined }));
    setNotice("Đã gỡ audio rời; đang dùng lại âm thanh trong video.");
  };

  const openProject = async () => {
    if (!runningInTauri()) return projectInputRef.current?.click();
    const path = await chooseNativePath("project");
    if (!path) return;
    try {
      const loaded = parseProject(await readNativeText(path));
      setProject(loaded);
      setProjectPath(path);
      setSelectedUid(loaded.cues[0]?.uid ?? null);
      setVideoUrl(loaded.mediaProxyPath || loaded.mediaPath ? nativeMediaUrl(loaded.mediaProxyPath || loaded.mediaPath!) : null);
      setExternalAudioUrl(loaded.externalAudioPath ? nativeMediaUrl(loaded.externalAudioPath) : null);
      if (loaded.mediaName) setMediaAssessment(loaded.mediaProxyPath
        ? { compatibility: "direct", message: "Đang dùng editing proxy H.264/AAC do SubTrans tạo." }
        : assessMediaFile({ name: loaded.mediaName, type: "video/unknown" }));
      resetHistory();
      setNotice(`Đã mở project ${baseName(path)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể mở project.");
    }
  };

  const importTranslationContent = (content: string, fileName: string) => {
    const translated = parseSrt(content).cues;
    if (!translated.length || !cues.length) return setNotice("Không có cue để ghép bản dịch.");
    checkpoint();
    let matched = 0;
    const used = new Set<string>();
    const merged = cues.map((cue) => {
      const sameIndex = translated.find((item) => item.index === cue.index && Math.abs(item.startMs - cue.startMs) <= 1_000 && !used.has(item.uid));
      const byTime = sameIndex ?? translated.find((item) => Math.abs(item.startMs - cue.startMs) <= 500 && !used.has(item.uid));
      if (!byTime) return cue;
      used.add(byTime.uid);
      matched += 1;
      return { ...cue, translatedText: byTime.sourceText, status: "draft" as CueStatus };
    });
    setProject((current) => ({ ...current, cues: merged }));
    setNotice(`Đã ghép ${matched}/${cues.length} cue từ ${fileName}.`);
  };

  const chooseTranslation = async () => {
    if (!runningInTauri()) return translatedInputRef.current?.click();
    const path = await chooseNativePath("translation");
    if (path) importTranslationContent(await readNativeText(path), baseName(path));
  };

  const newProject = () => {
    if ((cues.length || project.mediaName || project.externalAudioName) && !window.confirm("Tạo project mới? Project hiện tại đã được autosave.")) return;
    if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    if (externalAudioUrl?.startsWith("blob:")) URL.revokeObjectURL(externalAudioUrl);
    externalAudioRef.current?.pause();
    setProject(createProject());
    setProjectPath(null);
    setVideoUrl(null);
    setExternalAudioUrl(null);
    setMediaAssessment(null);
    setMediaError("");
    setSelectedUid(null);
    setSearchQuery("");
    localStorage.removeItem(AUTOSAVE_KEY);
    resetHistory();
    setNotice("Đã tạo project mới.");
  };

  const updateCueText = (uid: string, field: "sourceText" | "translatedText", value: string) => {
    replaceCues((current) => current.map((cue) => cue.uid !== uid ? cue : field === "translatedText" ? { ...cue, translatedText: value, status: value.trim() ? "edited" : "empty" } : { ...cue, sourceText: value }), false);
  };

  const updateCueTime = (uid: string, field: "startMs" | "endMs", value: number) => {
    replaceCues((current) => current.map((cue) => cue.uid === uid ? { ...cue, [field]: value } : cue), false);
  };

  const addCue = () => {
    const selectedIndex = cues.findIndex((cue) => cue.uid === selectedUid);
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : cues.length;
    const previous = cues[insertionIndex - 1];
    const startMs = previous ? previous.endMs + 100 : Math.round(currentMs);
    const cue: SubtitleCue = { uid: nextUid(), index: insertionIndex + 1, startMs, endMs: startMs + 2_000, sourceText: "", translatedText: "", status: "empty" };
    replaceCues((current) => reindex([...current.slice(0, insertionIndex), cue, ...current.slice(insertionIndex)]));
    setSelectedUid(cue.uid);
  };

  const deleteCue = () => {
    if (!selectedCue) return;
    const index = cues.findIndex((cue) => cue.uid === selectedCue.uid);
    const nextSelected = cues[index + 1] ?? cues[index - 1] ?? null;
    replaceCues((current) => reindex(current.filter((cue) => cue.uid !== selectedCue.uid)));
    setSelectedUid(nextSelected?.uid ?? null);
  };

  const splitCue = () => {
    if (!selectedCue) return;
    const splitAt = currentMs > selectedCue.startMs + 100 && currentMs < selectedCue.endMs - 100 ? Math.round(currentMs) : Math.round((selectedCue.startMs + selectedCue.endMs) / 2);
    const [sourceLeft, sourceRight] = splitText(selectedCue.sourceText);
    const [translationLeft, translationRight] = splitText(selectedCue.translatedText);
    const right: SubtitleCue = { ...selectedCue, uid: nextUid(), startMs: splitAt + 1, sourceText: sourceRight, translatedText: translationRight };
    replaceCues((current) => reindex(current.flatMap((cue) => cue.uid === selectedCue.uid ? [{ ...cue, endMs: splitAt, sourceText: sourceLeft, translatedText: translationLeft }, right] : [cue])));
    setSelectedUid(right.uid);
  };

  const mergeCue = () => {
    if (!selectedCue) return;
    const index = cues.findIndex((cue) => cue.uid === selectedCue.uid);
    const next = cues[index + 1];
    if (!next) return;
    replaceCues((current) => reindex(current.filter((_, cueIndex) => cueIndex !== index + 1).map((cue, cueIndex) => cueIndex === index ? { ...cue, endMs: next.endMs, sourceText: [cue.sourceText, next.sourceText].filter(Boolean).join("\n"), translatedText: [cue.translatedText, next.translatedText].filter(Boolean).join("\n"), status: cue.status === "approved" && next.status === "approved" ? "approved" : "edited" } : cue)));
  };

  const shiftCue = (delta: number) => {
    if (!selectedCue) return;
    replaceCues((current) => current.map((cue) => cue.uid === selectedCue.uid ? { ...cue, startMs: Math.max(0, cue.startMs + delta), endMs: Math.max(1, cue.endMs + delta) } : cue));
  };

  const toggleApproved = () => {
    if (!selectedCue) return;
    replaceCues((current) => current.map((cue) => cue.uid === selectedCue.uid ? { ...cue, status: cue.status === "approved" ? "edited" : "approved" } : cue));
  };

  const exportSubtitle = async () => {
    if (!cues.length) return;
    const fileName = translatedFileName(project.subtitleFileName);
    const contents = `\uFEFF${generateSrt(cues)}`;
    if (runningInTauri()) {
      const path = await saveNativeSubtitlePath(fileName);
      if (!path) return;
      try {
        await writeNativeText(path, contents);
        setNotice(`Đã xuất ${cues.length} cue sang ${baseName(path)}.`);
      } catch {
        setNotice("Không thể ghi file SRT vào đường dẫn đã chọn.");
      }
    } else {
      downloadText(contents, fileName, "application/x-subrip");
      setNotice(`Đã xuất ${cues.length} cue.`);
    }
  };

  const handleVideoInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
    setMediaAssessment(assessMediaFile(file));
    setMediaError("");
    setProject((current) => ({ ...current, mediaName: file.name, mediaPath: undefined, mediaProxyPath: undefined }));
    setNotice(`Đã nạp video ${file.name}.`);
    event.target.value = "";
  };

  const handleAudioInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setExternalAudioUrl(URL.createObjectURL(file));
    setProject((current) => ({ ...current, externalAudioName: file.name, externalAudioPath: undefined }));
    setNotice(`Đã nạp audio rời ${file.name}; track âm thanh trong video sẽ được tắt.`);
    event.target.value = "";
  };

  const loadProjectContent = (content: string, fileName: string) => {
    try {
      const loaded = parseProject(content);
      setProject(loaded);
      setProjectPath(null);
      setSelectedUid(loaded.cues[0]?.uid ?? null);
      setVideoUrl(null);
      setExternalAudioUrl(null);
      resetHistory();
      setNotice(`Đã mở project ${fileName}. Chọn lại video nếu cần.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể mở project.");
    }
  };

  const saveFfmpegPath = async () => {
    const value = ffmpegPath.trim();
    if (value) localStorage.setItem(FFMPEG_PATH_KEY, value);
    else localStorage.removeItem(FFMPEG_PATH_KEY);
    await checkFfmpeg(value);
  };

  const buildEditingProxy = async () => {
    if (!runningInTauri()) {
      setNotice("Tạo editing proxy chỉ chạy trong desktop app, không chạy ở web preview.");
      return;
    }
    if (!project.mediaPath) {
      setNotice("Hãy mở lại video bằng desktop app để SubTrans có đường dẫn file local.");
      return;
    }
    if (!ffmpegStatus?.available) {
      setSettingsOpen(true);
      setNotice("Không tìm thấy FFmpeg. Hãy cài FFmpeg hoặc nhập đường dẫn ffmpeg.exe trong Settings.");
      return;
    }

    setProxyRunState("running");
    setProxyProgress({ phase: "starting", processedMs: 0, percent: 0 });
    setNotice("Đang chuẩn bị editing proxy H.264/AAC…");
    try {
      const result = await createMediaProxy(project.mediaPath, durationMs, ffmpegPath);
      setVideoUrl(nativeMediaUrl(result.path));
      setMediaAssessment({ compatibility: "direct", message: "Đang dùng editing proxy H.264/AAC do SubTrans tạo." });
      setMediaError("");
      setProject((current) => ({ ...current, mediaProxyPath: result.path, updatedAt: new Date().toISOString() }));
      setProxyRunState("complete");
      setNotice(result.cached ? "Đã dùng lại editing proxy có sẵn." : `Đã tạo editing proxy (${(result.sizeBytes / 1_048_576).toFixed(1)} MB).`);
    } catch (error) {
      setProxyRunState("error");
      setNotice(typeof error === "string" ? error : error instanceof Error ? error.message : "Không thể tạo editing proxy.");
    }
  };

  const stopEditingProxy = async () => {
    try {
      await cancelMediaProxy();
      setNotice("Đang hủy FFmpeg và dọn file proxy chưa hoàn tất…");
    } catch {
      setNotice("Không thể dừng tiến trình FFmpeg.");
    }
  };

  const updateTranslationSettings = (patch: Partial<typeof translationSettings>) => {
    setProject((current) => ({
      ...current,
      translation: {
        ...current.translation,
        settings: createTranslationSettings({ ...current.translation.settings, ...patch }),
      },
    }));
  };

  const storeApiKey = async () => {
    const value = apiKeyDraft.trim();
    if (!value) return setNotice("Hãy paste Gemini API key trước khi lưu.");
    setApiKeyBusy(true);
    try {
      await saveGeminiApiKey(value);
      setApiKey(value);
      setApiKeyDraft("");
      setNotice(runningInTauri() ? "Đã lưu API key trong kho bảo mật của hệ điều hành." : "Preview web chỉ giữ API key trong session của tab này.");
    } catch {
      setNotice("Không thể lưu API key vào kho bảo mật.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const clearApiKey = async () => {
    setApiKeyBusy(true);
    try {
      await deleteGeminiApiKey();
      setApiKey("");
      setApiKeyDraft("");
      setNotice("Đã xóa Gemini API key.");
    } catch {
      setNotice("Không thể xóa API key khỏi kho bảo mật.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const stopTranslation = () => {
    translationAbortRef.current?.abort();
    setNotice("Đang dừng sau phần dữ liệu đã nhận; Gemini có thể vẫn tính request hiện tại.");
  };

  const runTranslation = async () => {
    if (isTranslating) return stopTranslation();
    if (!apiKey.trim()) {
      setSettingsOpen(true);
      setNotice("Cần lưu Gemini API key trước khi dịch.");
      return;
    }

    const initialBatches = planTranslationBatches(project.cues, translationSettings.batchSize);
    if (!initialBatches.length) {
      setNotice("Không còn cue trống để dịch. Cue imported, đã sửa tay và approved luôn được bảo vệ.");
      return;
    }

    const normalizedSession = resetDailyUsageIfNeeded(project.translation.session);
    const usableBudget = Math.max(0, translationSettings.dailyRequestBudget - translationSettings.reserveRequests);
    if (normalizedSession.requestsUsed >= usableBudget) {
      setProject((current) => ({
        ...current,
        translation: { ...current.translation, session: { ...normalizedSession, status: "quota", lastError: "Đã chạm ngân sách request do bạn đặt, bao gồm phần dự phòng.", updatedAt: new Date().toISOString() } },
      }));
      setNotice("Đã chạm ngân sách request hôm nay. Bạn có thể tăng budget trong Settings hoặc chờ ngày quota mới.");
      return;
    }

    const gemini = await import("./services/gemini");

    checkpoint();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    let requestsUsed = normalizedSession.requestsUsed;
    let memory = normalizedSession.rollingMemory;
    let translatedThisRun = 0;
    type QueueItem = { batch: TranslationBatch; retry: number };
    const queue: QueueItem[] = initialBatches.map((batch) => ({ batch, retry: 0 }));
    let completed = true;

    setProject((current) => ({
      ...current,
      translation: { ...current.translation, session: { ...normalizedSession, status: "running", lastError: "", updatedAt: new Date().toISOString() } },
    }));
    setNotice(`Bắt đầu dịch ${translatableCount} cue trong khoảng ${initialBatches.length} request.`);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      if (controller.signal.aborted) { completed = false; break; }
      if (requestsUsed >= usableBudget) {
        completed = false;
        setProject((current) => ({
          ...current,
          translation: { ...current.translation, session: { ...current.translation.session, status: "quota", lastError: "Đã chạm ngân sách request do bạn đặt, bao gồm phần dự phòng.", updatedAt: new Date().toISOString() } },
        }));
        setNotice("Đã tạm dừng trước khi dùng phần request dự phòng. Project đã autosave và có thể resume.");
        break;
      }

      const item = queue[cursor];
      const expected = new Map(item.batch.cues.map((cue) => [cue.uid, sourceFingerprint(cue.sourceText)]));
      const received = new Map<string, string>();
      const applyTranslations = (items: Array<{ id: string; text: string }>) => {
        for (const item of items) {
          if (expected.has(item.id) && item.text.trim()) received.set(item.id, item.text.trim());
        }
        if (!received.size) return;
        const translatedAt = new Date().toISOString();
        setProject((current) => ({
          ...current,
          cues: current.cues.map((cue) => {
            const text = received.get(cue.uid);
            const fingerprint = expected.get(cue.uid);
            if (!text || !fingerprint || sourceFingerprint(cue.sourceText) !== fingerprint || !isCueEligibleForTranslation(cue)) return cue;
            return { ...cue, translatedText: text, status: "machine", translationMeta: { provider: "gemini", model: translationSettings.model, sourceHash: fingerprint, translatedAt } };
          }),
          updatedAt: translatedAt,
        }));
      };

      requestsUsed += 1;
      setProject((current) => ({
        ...current,
        translation: { ...current.translation, session: { ...current.translation.session, status: "running", requestsUsed, lastError: "", updatedAt: new Date().toISOString() } },
      }));
      setNotice(`Gemini đang dịch batch ${cursor + 1}/${queue.length} · ${item.batch.cues.length} cue · request ${requestsUsed}/${translationSettings.dailyRequestBudget}.`);

      try {
        const result = await gemini.translateGeminiBatch({
          apiKey,
          model: translationSettings.model,
          prompt: buildGeminiPrompt(project.cues, item.batch, translationSettings, memory),
          signal: controller.signal,
          onPartial: applyTranslations,
        });
        applyTranslations(result.translations);
        memory = result.memory || memory;
        translatedThisRun += received.size;

        setProject((current) => ({
          ...current,
          translation: {
            ...current.translation,
            session: {
              ...current.translation.session,
              status: "running",
              requestsUsed,
              inputTokens: current.translation.session.inputTokens + result.usage.inputTokens,
              outputTokens: current.translation.session.outputTokens + result.usage.outputTokens,
              translatedCues: current.translation.session.translatedCues + received.size,
              rollingMemory: memory,
              updatedAt: new Date().toISOString(),
            },
          },
        }));

        const missing = item.batch.cues.filter((cue) => !received.has(cue.uid));
        if (missing.length && item.retry < 1) {
          queue.splice(cursor + 1, 0, {
            batch: { id: `${item.batch.id}-missing`, cues: missing, sourceCharacters: missing.reduce((total, cue) => total + cue.sourceText.length, 0) },
            retry: item.retry + 1,
          });
        } else if (missing.length) {
          completed = false;
          setNotice(`${missing.length} cue vẫn thiếu sau một lần retry. App đã giữ toàn bộ phần dịch hợp lệ.`);
        }
      } catch (error) {
        completed = false;
        const failure = error instanceof gemini.GeminiTranslationError ? error : new gemini.GeminiTranslationError("network", "Không thể tiếp tục dịch.");
        const status = failure.kind === "quota" ? "quota" : failure.kind === "aborted" ? "paused" : "error";
        setProject((current) => ({
          ...current,
          translation: { ...current.translation, session: { ...current.translation.session, status, requestsUsed, rollingMemory: memory, lastError: failure.message, updatedAt: new Date().toISOString() } },
        }));
        setNotice(failure.message);
        break;
      }
    }

    translationAbortRef.current = null;
    if (completed && !controller.signal.aborted) {
      setProject((current) => ({
        ...current,
        translation: { ...current.translation, session: { ...current.translation.session, status: "complete", rollingMemory: memory, lastError: "", updatedAt: new Date().toISOString() } },
      }));
      setNotice(`Đã hoàn tất lượt dịch: nhận ${translatedThisRun} cue, dùng ${requestsUsed - normalizedSession.requestsUsed} request.`);
    } else if (controller.signal.aborted) {
      setProject((current) => ({
        ...current,
        translation: { ...current.translation, session: { ...current.translation.session, status: "paused", requestsUsed, rollingMemory: memory, lastError: "Đã tạm dừng theo yêu cầu.", updatedAt: new Date().toISOString() } },
      }));
    }
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, cue: SubtitleCue) => {
    if (event.key === "Enter") jumpToCue(cue);
  };

  void historyVersion;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Icon name="captions" size={20} /></div>
          <div><div className="brand-name">SubTrans</div><div className="brand-edition">Windows-first · Phase 4</div></div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Project mới" onClick={newProject}><Icon name="new" /></button>
          <button className="button button-ghost" onClick={() => void openProject()}><Icon name="folder" />Mở project</button>
          <button className="button button-ghost" disabled={!cues.length} onClick={() => void saveProject()}><Icon name="save" />Lưu project</button>
          <span className="toolbar-separator" />
          <button className="button button-ghost" onClick={() => void chooseVideo()}><Icon name="film" />Mở video</button>
          <button className="button button-primary" onClick={() => void chooseSubtitle()}><Icon name="subtitles" />Mở SRT</button>
          <button className={`button ai-action ${isTranslating ? "is-running" : ""}`} disabled={!cues.length || (!translatableCount && !isTranslating)} onClick={() => void runTranslation()}><Icon name={isTranslating ? "pause" : "ai"} />{isTranslating ? "Dừng dịch" : "Dịch bằng Gemini"}</button>
          <button className="button button-ghost" disabled={!cues.length} onClick={() => void exportSubtitle()}><Icon name="download" />Xuất SRT</button>
          <button className="icon-button" title="Cài đặt Gemini" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="sidebar-section project-card">
            <div className="section-eyebrow">Project</div>
            <input className="project-name-input" aria-label="Tên project" value={project.name} onChange={(event) => setProject((current) => ({ ...current, name: event.target.value }))} />
            <p>{project.mediaName || "Chưa mở video"}</p>
            <div className="progress-track" aria-label={`Tiến độ dịch ${progress}%`}><div className="progress-value" style={{ width: `${progress}%` }} /></div>
            <div className="progress-meta"><span>{translatedCount}/{cues.length} cue đã dịch</span><strong>{progress}%</strong></div>
            <div className={`save-indicator ${saveState}`}><span />{saveState === "saving" ? "Đang autosave…" : saveState === "error" ? "Autosave thất bại" : lastSavedAt ? `Đã lưu ${lastSavedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : "Chưa có thay đổi"}</div>
          </section>

          <section className="sidebar-section">
            <div className="section-eyebrow">Nguồn</div>
            <button className="source-row" onClick={() => void chooseVideo()}><span className={`source-icon ${project.mediaName ? "is-ready" : ""}`}><Icon name="film" /></span><span><strong>Video</strong><small>{project.mediaName ? `${project.mediaName}${project.mediaProxyPath ? " · proxy" : ""}` : "Chọn file local"}</small></span><Icon name="chevron" size={16} /></button>
            <button className="source-row" onClick={() => void chooseExternalAudio()}><span className={`source-icon ${externalAudioUrl ? "is-ready" : ""}`}><Icon name="audio" /></span><span><strong>Audio rời</strong><small>{project.externalAudioName ? `${project.externalAudioName}${externalAudioUrl ? "" : " · chọn lại file"}` : "Tùy chọn · MP3, WAV, M4A…"}</small></span><Icon name="chevron" size={16} /></button>
            {externalAudioUrl && <button className="source-remove" onClick={removeExternalAudio}>Gỡ audio rời · dùng track trong video</button>}
            <button className="source-row" onClick={() => void chooseSubtitle()}><span className={`source-icon ${cues.length ? "is-ready" : ""}`}><Icon name="subtitles" /></span><span><strong>Subtitle gốc</strong><small>{project.subtitleFileName || "Chọn file .srt"}</small></span><Icon name="chevron" size={16} /></button>
            <button className="source-row" disabled={!cues.length} onClick={() => void chooseTranslation()}><span className="source-icon"><Icon name="upload" /></span><span><strong>Import bản dịch</strong><small>Ghép theo index và timing</small></span><Icon name="chevron" size={16} /></button>
          </section>

          <section className="sidebar-section summary-card">
            <div className="section-eyebrow">Kiểm tra</div>
            <div><span>Cue có vấn đề</span><strong className={validation.size ? "has-warning" : ""}>{validation.size}</strong></div>
            <div><span>Đã approved</span><strong>{approvedCount}</strong></div>
            <button onClick={() => setCueFilter("issues")} disabled={!validation.size}>Xem các cue cần sửa</button>
          </section>

          <section className="sidebar-section ai-card">
            <div className="ai-card-heading"><span><Icon name="ai" size={14} />Gemini</span><button title="Cài đặt Gemini" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={14} /></button></div>
            <div className="ai-model">{translationSettings.model}</div>
            <div className="ai-plan"><span>{translatableCount} cue còn trống</span><strong>~{plannedRequests} request</strong></div>
            <div className="ai-plan"><span>Budget khả dụng</span><strong>{dailyRequestsLeft}/{translationSettings.dailyRequestBudget}</strong></div>
            {translationSession.status !== "idle" && <div className={`ai-run-status is-${translationSession.status}`}><span />{translationSession.status === "running" ? "Đang dịch" : translationSession.status === "complete" ? "Đã hoàn tất" : translationSession.status === "quota" ? "Chạm budget/quota" : translationSession.status === "paused" ? "Đã tạm dừng" : "Cần kiểm tra"}</div>}
            <button className="ai-start" disabled={!cues.length || (!translatableCount && !isTranslating)} onClick={() => void runTranslation()}><Icon name={isTranslating ? "pause" : "ai"} size={14} />{isTranslating ? "Dừng an toàn" : translationSession.status === "paused" || translationSession.status === "quota" || translationSession.status === "error" ? "Resume cue còn thiếu" : "Dịch cue còn trống"}</button>
            {(translationSession.inputTokens > 0 || translationSession.outputTokens > 0) && <small>{translationSession.requestsUsed} req · {translationSession.inputTokens.toLocaleString("vi-VN")} in · {translationSession.outputTokens.toLocaleString("vi-VN")} out</small>}
          </section>

          <section className="sidebar-section shortcut-card">
            <div className="section-eyebrow">Phím tắt</div>
            <div><span>Undo / redo</span><kbd>Ctrl Z / Y</kbd></div>
            <div><span>Lưu project</span><kbd>Ctrl S</kbd></div>
            <div><span>Phát cue</span><kbd>Shift Space</kbd></div>
            <div><span>Cue trước / sau</span><kbd>Ctrl ↑↓</kbd></div>
          </section>

          <div className="sidebar-status"><span className="status-dot" /><span>{notice}</span></div>
        </aside>

        <main className="main-panel">
          <section className="player-panel">
            <div className="player-stage">
              {videoUrl ? <><video ref={videoRef} key={videoUrl} src={videoUrl} controls muted={Boolean(externalAudioUrl)} onVolumeChange={(event) => { if (externalAudioUrl && !event.currentTarget.muted) event.currentTarget.muted = true; }} onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1_000)} onLoadedMetadata={(event) => { setDurationMs(event.currentTarget.duration * 1_000); setMediaError(""); }} onError={() => { setMediaError("WebView không giải mã được video này. File có thể cần editing proxy."); setNotice("Không phát được video trực tiếp; media layer đã đánh dấu cần proxy."); }} />{activeCue && <div className="subtitle-overlay"><SubtitleOverlayText text={activeCue.translatedText || activeCue.sourceText} /></div>}</> : <button className="player-empty" onClick={() => void chooseVideo()}><span className="empty-icon"><Icon name="play" size={28} /></span><strong>Mở video để bắt đầu</strong><small>MP4, WebM, MOV · MKV sẽ được kiểm tra codec</small></button>}
              {externalAudioUrl && <audio ref={externalAudioRef} key={externalAudioUrl} src={externalAudioUrl} preload="auto" hidden onError={() => setNotice("Không đọc được audio rời. Hãy thử MP3, WAV, M4A hoặc AAC.")} />}
            </div>
            <div className="player-footer">
              <div className="time-readout"><span>{formatPlaybackTime(currentMs)}</span><span className="time-divider">/</span><span>{formatPlaybackTime(durationMs)}</span></div>
              {mediaAssessment && <div className={`media-badge ${mediaAssessment.compatibility}`} title={mediaAssessment.message}><Icon name={mediaAssessment.compatibility === "direct" ? "check" : "warning"} size={15} />{project.mediaProxyPath ? "Editing proxy" : mediaAssessment.compatibility === "direct" ? "Direct playback" : "Đang kiểm tra codec"}</div>}
              {externalAudioUrl && <label className="external-audio-volume"><Icon name="audio" size={14} /><span>Âm lượng</span><input aria-label="Âm lượng audio rời" type="range" min="0" max="1" step="0.01" value={externalAudioVolume} onChange={(event) => setExternalAudioVolume(Number(event.target.value))} /><output>{Math.round(externalAudioVolume * 100)}%</output></label>}
              {externalAudioUrl && <div className="media-badge external-audio" title={project.externalAudioName}><Icon name="audio" size={14} />Audio rời · sync</div>}
              {activeCue && <div className="active-readout">Cue #{activeCue.index} · {msToTimestamp(activeCue.startMs)}</div>}
            </div>
            {(mediaError || (mediaAssessment?.compatibility === "uncertain" && !mediaError)) && <div className={`media-notice ${mediaError ? "is-error" : ""}`}><Icon name={mediaError ? "warning" : "info"} /><span>{mediaError || mediaAssessment?.message}</span><button onClick={() => void (proxyRunState === "running" ? stopEditingProxy() : buildEditingProxy())}>{proxyRunState === "running" ? "Hủy proxy" : "Tạo editing proxy"}</button></div>}
            {proxyRunState === "running" && <div className="proxy-progress"><div><span style={{ width: `${Math.max(2, proxyProgress.percent)}%` }} /></div><small>FFmpeg · {proxyProgress.percent > 0 ? `${Math.round(proxyProgress.percent)}%` : "đang chuẩn bị"} · {formatPlaybackTime(proxyProgress.processedMs)}</small></div>}
          </section>

          <section className="editor-panel">
            <div className="editor-header phase-two-header">
              <div><div className="section-eyebrow">Subtitle editor</div><h2>{cues.length ? `${visibleCues.length}/${cues.length} cue` : "Chưa có subtitle"}</h2></div>
              <div className="history-actions"><button className="icon-button" title="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button><button className="icon-button" title="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button></div>
            </div>

            {cues.length > 0 && <>
              <div className="editor-toolbar">
                <div className="search-box"><Icon name="search" size={15} /><input aria-label="Tìm subtitle" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Tìm nội dung hoặc số cue…" /></div>
                <div className="filter-box"><Icon name="filter" size={15} /><select aria-label="Lọc cue" value={cueFilter} onChange={(event) => setCueFilter(event.target.value as CueFilter)}><option value="all">Tất cả</option><option value="empty">Chưa dịch</option><option value="translated">Đã dịch</option><option value="edited">Đã chỉnh tay</option><option value="approved">Approved</option><option value="issues">Có vấn đề</option></select></div>
                <span className="toolbar-separator" />
                <button className="tool-button" onClick={addCue}><Icon name="plus" size={15} />Thêm</button>
                <button className="tool-button" disabled={!selectedCue} onClick={splitCue}><Icon name="split" size={15} />Tách</button>
                <button className="tool-button" disabled={!selectedCue || selectedCue.index === cues.length} onClick={mergeCue}><Icon name="merge" size={15} />Gộp</button>
                <button className="tool-button danger" disabled={!selectedCue} onClick={deleteCue}><Icon name="trash" size={15} />Xóa</button>
              </div>

              {selectedCue && <div className="selection-toolbar">
                <span>Cue #{selectedCue.index}</span>
                <button onClick={() => shiftCue(-500)}><Icon name="clock" size={13} />−500 ms</button>
                <button onClick={() => shiftCue(500)}><Icon name="clock" size={13} />+500 ms</button>
                <button className={selectedCue.status === "approved" ? "is-approved" : ""} onClick={toggleApproved}><Icon name="approve" size={14} />{selectedCue.status === "approved" ? "Đã approved" : "Approve"}</button>
              </div>}
            </>}

            {cues.length === 0 ? <div className="editor-empty"><span className="empty-file"><Icon name="folder" size={30} /></span><h3>Mở một file SRT</h3><p>SubTrans sẽ đặt bản gốc và bản dịch cạnh nhau, autosave project và kiểm tra chất lượng.</p><button className="button button-primary" onClick={() => void chooseSubtitle()}><Icon name="subtitles" />Chọn subtitle</button></div> : visibleCues.length === 0 ? <div className="no-results"><Icon name="search" size={26} /><strong>Không có cue phù hợp</strong><button onClick={() => { setSearchQuery(""); setCueFilter("all"); }}>Xóa bộ lọc</button></div> : <div className="cue-list">
              {visibleCues.map((cue) => {
                const issues = validation.get(cue.uid) ?? [];
                const isActive = activeCue?.uid === cue.uid;
                const isSelected = selectedUid === cue.uid;
                return <div key={cue.uid} ref={(element) => { if (element) rowRefs.current.set(cue.uid, element); else rowRefs.current.delete(cue.uid); }} className={`cue-row ${isActive ? "is-active" : ""} ${isSelected ? "is-selected" : ""} ${cue.status === "approved" ? "is-approved" : ""}`} tabIndex={0} onClick={() => setSelectedUid(cue.uid)} onDoubleClick={() => jumpToCue(cue)} onKeyDown={(event) => handleRowKeyDown(event, cue)}>
                  <button className="cue-index" title="Phát từ cue này" onClick={() => jumpToCue(cue)}><span>{String(cue.index).padStart(3, "0")}</span><Icon name="play" size={12} /></button>
                  <div className="cue-time-editor"><TimeInput label={`Bắt đầu cue ${cue.index}`} value={cue.startMs} onBegin={() => beginEdit(`${cue.uid}:start`)} onEnd={endEdit} onCommit={(value) => updateCueTime(cue.uid, "startMs", value)} /><TimeInput label={`Kết thúc cue ${cue.index}`} value={cue.endMs} onBegin={() => beginEdit(`${cue.uid}:end`)} onEnd={endEdit} onCommit={(value) => updateCueTime(cue.uid, "endMs", value)} /></div>
                  <div className="cue-column source-column"><label>Original</label><AutoTextarea label={`Nội dung gốc cue ${cue.index}`} value={cue.sourceText} onFocus={() => { setSelectedUid(cue.uid); beginEdit(`${cue.uid}:source`); }} onBlur={endEdit} onChange={(value) => updateCueText(cue.uid, "sourceText", value)} /></div>
                  <div className="cue-column translation-column"><div className="translation-label"><label>Vietnamese</label><span className={`cue-status status-${cue.status}`}>{cue.status === "approved" ? <><Icon name="approve" size={12} />Approved</> : cue.translatedText.trim() ? <><Icon name={cue.status === "machine" ? "ai" : "check"} size={12} />{cue.status === "draft" ? "Imported" : cue.status === "machine" ? "Gemini" : "Đã chỉnh"}</> : "Chưa dịch"}</span></div><AutoTextarea label={`Bản dịch cue ${cue.index}`} value={cue.translatedText} placeholder="Nhập bản dịch…" onFocus={() => { setSelectedUid(cue.uid); beginEdit(`${cue.uid}:translation`); }} onBlur={endEdit} onChange={(value) => updateCueText(cue.uid, "translatedText", value)} /></div>
                  {issues.length > 0 && <div className="cue-issues" title={issues.map((issue) => issue.message).join("\n")}><Icon name="warning" size={14} /><span>{issues.map((issue) => issue.code.toUpperCase()).join(" · ")}</span></div>}
                </div>;
              })}
            </div>}
          </section>
        </main>
      </div>

      <input ref={videoInputRef} className="visually-hidden" type="file" accept="video/*,.mkv,.avi,.wmv,.m2ts,.ts" onChange={handleVideoInput} />
      <input ref={audioInputRef} className="visually-hidden" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm" onChange={handleAudioInput} />
      <input ref={subtitleInputRef} className="visually-hidden" type="file" accept=".srt,application/x-subrip,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((content) => loadSrtContent(content, file.name)); event.target.value = ""; }} />
      <input ref={translatedInputRef} className="visually-hidden" type="file" accept=".srt,application/x-subrip,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((content) => importTranslationContent(content, file.name)); event.target.value = ""; }} />
      <input ref={projectInputRef} className="visually-hidden" type="file" accept=".json,.subtrans.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((content) => loadProjectContent(content, file.name)); event.target.value = ""; }} />

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="gemini-settings-title">
          <div className="settings-header"><div><div className="section-eyebrow">SubTrans desktop</div><h2 id="gemini-settings-title">Settings</h2></div><button className="icon-button" aria-label="Đóng cài đặt" onClick={() => setSettingsOpen(false)}>×</button></div>

          <div className="settings-section">
            <div className="settings-title"><Icon name="key" size={16} /><span>API key</span><span className={`secret-state ${apiKey ? "is-ready" : ""}`}>{!apiKeyLoaded ? "Đang đọc…" : apiKey ? "Đã lưu" : "Chưa có"}</span></div>
            <div className="key-row"><input type="password" autoComplete="off" aria-label="Gemini API key" value={apiKeyDraft} placeholder={apiKey ? "••••••••••••••••  (nhập để thay key)" : "Paste API key từ Google AI Studio"} onChange={(event) => setApiKeyDraft(event.target.value)} /><button className="button button-primary" disabled={apiKeyBusy || !apiKeyDraft.trim()} onClick={() => void storeApiKey()}>Lưu key</button>{apiKey && <button className="button button-ghost" disabled={apiKeyBusy} onClick={() => void clearApiKey()}>Xóa</button>}</div>
            <p>{runningInTauri() ? "Key được lưu trong Windows Credential Manager hoặc macOS Keychain, không nằm trong file project." : "Đang chạy web preview: key chỉ tồn tại trong session của tab và mất khi đóng tab."}</p>
          </div>

          <div className="settings-grid">
            <label><span>Model ổn định</span><select value={translationSettings.model} onChange={(event) => updateTranslationSettings({ model: event.target.value })}><option value="gemini-3.8-flash">Gemini 3.8 Flash</option><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option></select><small>Flash ưu tiên chất lượng; Flash-Lite ưu tiên chi phí.</small></label>
            <label><span>Cue / request</span><input type="number" min="150" max="300" step="10" value={translationSettings.batchSize} onChange={(event) => updateTranslationSettings({ batchSize: Number(event.target.value) })} /><small>App tự tách sớm nếu batch có quá nhiều ký tự.</small></label>
            <label><span>Budget request / ngày</span><input type="number" min="1" max="10000" value={translationSettings.dailyRequestBudget} onChange={(event) => updateTranslationSettings({ dailyRequestBudget: Number(event.target.value) })} /><small>Giới hạn mềm do bạn đặt; reset theo nửa đêm Pacific.</small></label>
            <label><span>Giữ lại dự phòng</span><input type="number" min="0" max={Math.max(0, translationSettings.dailyRequestBudget - 1)} value={translationSettings.reserveRequests} onChange={(event) => updateTranslationSettings({ reserveRequests: Number(event.target.value) })} /><small>App dừng trước khi dùng hết quota dự kiến.</small></label>
          </div>

          <div className="settings-section"><label className="settings-textarea"><span>Context phim</span><textarea rows={3} value={translationSettings.projectContext} placeholder="Thể loại, thời đại, bối cảnh, giọng văn mong muốn…" onChange={(event) => updateTranslationSettings({ projectContext: event.target.value })} /></label></div>
          <div className="settings-section"><label className="settings-textarea"><span>Character Bible & xưng hô</span><textarea rows={5} value={translationSettings.characterBible} placeholder="Ví dụ: Mai (nữ, 22) gọi An là anh, xưng em. An gọi Minh là cậu…" onChange={(event) => updateTranslationSettings({ characterBible: event.target.value })} /></label><p>Rolling memory sẽ được Gemini cập nhật ngay trong response dịch, nên không tốn thêm request phân tích context.</p></div>

          <div className="settings-section media-tools-settings">
            <div className="settings-title"><Icon name="film" size={16} /><span>Editing proxy</span><span className={`secret-state ${ffmpegStatus?.available ? "is-ready" : ""}`}>{ffmpegChecking ? "Đang kiểm tra…" : ffmpegStatus?.available ? "FFmpeg sẵn sàng" : runningInTauri() ? "Chưa tìm thấy FFmpeg" : "Chỉ có trên desktop"}</span></div>
            <div className="key-row"><input aria-label="Đường dẫn FFmpeg" value={ffmpegPath} placeholder={ffmpegStatus?.path || (runningInTauri() ? "Đường dẫn ffmpeg.exe (để trống để tự tìm)" : "Mở desktop app để cấu hình")} disabled={!runningInTauri()} onChange={(event) => setFfmpegPath(event.target.value)} /><button className="button button-ghost" disabled={!runningInTauri() || ffmpegChecking} onClick={() => void saveFfmpegPath()}>Kiểm tra</button></div>
            <p>{ffmpegStatus?.version || "SubTrans tạo MP4 H.264/AAC tối đa 1080p trong cache tạm, giữ nguyên video gốc và tái sử dụng proxy nếu file nguồn chưa đổi."}</p>
          </div>

          <div className="settings-summary"><div><span>Còn cần dịch</span><strong>{translatableCount} cue</strong></div><div><span>Ước tính</span><strong>{plannedRequests} request</strong></div><div><span>Còn dùng hôm nay</span><strong>{dailyRequestsLeft} request</strong></div></div>
          <div className="settings-footer"><span>Không có request test kết nối. Request đầu tiên chính là batch dịch đầu tiên.</span><button className="button button-primary" onClick={() => setSettingsOpen(false)}>Xong</button></div>
        </section>
      </div>}
    </div>
  );
}

export default App;
