import { invoke } from "@tauri-apps/api/core";
import { runningInTauri } from "./files";

const BROWSER_SESSION_KEY = "subtrans.gemini-api-key.session";

export async function loadGeminiApiKey(): Promise<string | null> {
  if (runningInTauri()) return invoke<string | null>("get_gemini_api_key");
  return sessionStorage.getItem(BROWSER_SESSION_KEY);
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  if (runningInTauri()) {
    await invoke("set_gemini_api_key", { apiKey });
    return;
  }
  sessionStorage.setItem(BROWSER_SESSION_KEY, apiKey);
}

export async function deleteGeminiApiKey(): Promise<void> {
  if (runningInTauri()) {
    await invoke("delete_gemini_api_key");
    return;
  }
  sessionStorage.removeItem(BROWSER_SESSION_KEY);
}
