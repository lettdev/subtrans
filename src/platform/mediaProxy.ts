import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface FfmpegStatus {
  available: boolean;
  path?: string;
  version?: string;
}

export interface ProxyProgress {
  phase: "starting" | "transcoding" | "complete" | "cancelled" | "error";
  processedMs: number;
  percent: number;
}

export interface ProxyResult {
  path: string;
  sizeBytes: number;
  cached: boolean;
}

export async function getFfmpegStatus(customPath?: string): Promise<FfmpegStatus> {
  return invoke<FfmpegStatus>("get_ffmpeg_status", { customPath: customPath?.trim() || null });
}

export async function createMediaProxy(
  sourcePath: string,
  durationMs: number,
  customPath?: string,
): Promise<ProxyResult> {
  return invoke<ProxyResult>("create_media_proxy", {
    sourcePath,
    durationMs: Math.max(0, Math.round(durationMs)),
    customPath: customPath?.trim() || null,
  });
}

export async function cancelMediaProxy(): Promise<boolean> {
  return invoke<boolean>("cancel_media_proxy");
}

export function onProxyProgress(callback: (progress: ProxyProgress) => void): Promise<UnlistenFn> {
  return listen<ProxyProgress>("proxy-progress", (event) => callback(event.payload));
}
