import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type NativeFileKind = "project" | "subtitle" | "translation" | "video";

const filters = {
  project: [{ name: "SubTrans project", extensions: ["json"] }],
  subtitle: [{ name: "SubRip subtitle", extensions: ["srt"] }],
  translation: [{ name: "Translated subtitle", extensions: ["srt"] }],
  video: [{ name: "Video", extensions: ["mp4", "m4v", "webm", "mov", "mkv", "avi", "wmv", "ts", "m2ts"] }],
};

export function runningInTauri(): boolean {
  return isTauri();
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export async function chooseNativePath(kind: NativeFileKind): Promise<string | null> {
  if (!runningInTauri()) return null;
  const selection = await open({ multiple: false, directory: false, filters: filters[kind] });
  return typeof selection === "string" ? selection : null;
}

export async function readNativeText(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export async function saveNativeProjectPath(defaultPath: string): Promise<string | null> {
  if (!runningInTauri()) return null;
  return save({
    defaultPath,
    filters: [{ name: "SubTrans project", extensions: ["json"] }],
  });
}

export async function saveNativeSubtitlePath(defaultPath: string): Promise<string | null> {
  if (!runningInTauri()) return null;
  return save({
    defaultPath,
    filters: [{ name: "SubRip subtitle", extensions: ["srt"] }],
  });
}

export async function writeNativeProject(path: string, contents: string): Promise<void> {
  await invoke("write_project_atomic", { path, contents });
}

export async function writeNativeText(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}

export function nativeMediaUrl(path: string): string {
  return convertFileSrc(path);
}
