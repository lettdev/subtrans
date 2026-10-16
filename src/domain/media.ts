export type MediaCompatibility = "direct" | "uncertain";

export interface MediaAssessment {
  compatibility: MediaCompatibility;
  message: string;
}

const DIRECT_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);
const PROXY_CANDIDATE_EXTENSIONS = new Set(["mkv", "avi", "wmv", "flv", "ts", "m2ts"]);

// Separate HTML media decoders do not advance on the exact same clock. A generous
// tolerance avoids audible MP3 glitches caused by repeatedly assigning currentTime.
export const EXTERNAL_AUDIO_DRIFT_TOLERANCE_SECONDS = 0.75;

export function externalAudioNeedsSync(
  videoSeconds: number,
  audioSeconds: number,
  toleranceSeconds = EXTERNAL_AUDIO_DRIFT_TOLERANCE_SECONDS,
): boolean {
  return Math.abs(videoSeconds - audioSeconds) > toleranceSeconds;
}

export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function assessMediaFile(file: Pick<File, "name" | "type">): MediaAssessment {
  const extension = getFileExtension(file.name);
  if (DIRECT_EXTENSIONS.has(extension)) {
    return {
      compatibility: "direct",
      message: "Định dạng có khả năng phát trực tiếp trên Windows WebView2.",
    };
  }

  if (PROXY_CANDIDATE_EXTENSIONS.has(extension)) {
    return {
      compatibility: "uncertain",
      message: "Container hoặc codec này có thể cần tạo editing proxy trên Windows.",
    };
  }

  return {
    compatibility: file.type.startsWith("video/") ? "direct" : "uncertain",
    message: file.type.startsWith("video/")
      ? "SubTrans sẽ thử phát trực tiếp bằng WebView2."
      : "Không nhận diện được định dạng; SubTrans sẽ thử phát trực tiếp.",
  };
}
