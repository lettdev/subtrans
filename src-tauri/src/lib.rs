use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{Emitter, Manager};

const KEYRING_SERVICE: &str = "app.subtrans.desktop";
const KEYRING_ACCOUNT: &str = "gemini-api-key";

#[derive(Default)]
struct ProxyStateInner {
    process: Mutex<Option<Arc<Mutex<Child>>>>,
    cancelled: AtomicBool,
}

#[derive(Clone, Default)]
struct ProxyState {
    inner: Arc<ProxyStateInner>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegStatus {
    available: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyProgress {
    phase: String,
    processed_ms: u64,
    percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyResult {
    path: String,
    size_bytes: u64,
    cached: bool,
}

fn verify_ffmpeg(path: &Path) -> Option<FfmpegStatus> {
    let output = Command::new(path).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("FFmpeg")
        .trim()
        .to_string();
    Some(FfmpegStatus {
        available: true,
        path: Some(path.to_string_lossy().to_string()),
        version: Some(first_line),
    })
}

fn find_ffmpeg(app: &tauri::AppHandle, custom_path: Option<String>) -> FfmpegStatus {
    let mut candidates = Vec::<PathBuf>::new();
    if let Some(path) = custom_path.filter(|value| !value.trim().is_empty()) {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(path) = std::env::var("SUBTRANS_FFMPEG_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("bin").join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        }));
    }
    if cfg!(windows) {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("ffmpeg")
                    .join("bin")
                    .join("ffmpeg.exe"),
            );
        }
        if let Ok(chocolatey) = std::env::var("ChocolateyInstall") {
            candidates.push(PathBuf::from(chocolatey).join("bin").join("ffmpeg.exe"));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            candidates.push(
                PathBuf::from(user_profile)
                    .join("scoop")
                    .join("shims")
                    .join("ffmpeg.exe"),
            );
        }
        candidates.push(PathBuf::from("ffmpeg.exe"));
    } else {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/ffmpeg"),
            PathBuf::from("/usr/local/bin/ffmpeg"),
            PathBuf::from("ffmpeg"),
        ]);
    }

    candidates
        .iter()
        .find_map(|candidate| verify_ffmpeg(candidate))
        .unwrap_or(FfmpegStatus {
            available: false,
            path: None,
            version: None,
        })
}

fn proxy_output_path(source: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .hash(&mut hasher);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let directory = std::env::temp_dir().join("SubTrans").join("proxies");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("{stem}-{:016x}.mp4", hasher.finish())))
}

fn emit_proxy_progress(app: &tauri::AppHandle, phase: &str, processed_ms: u64, duration_ms: u64) {
    let percent = if duration_ms == 0 {
        0.0
    } else {
        ((processed_ms as f64 / duration_ms as f64) * 100.0).clamp(0.0, 100.0)
    };
    let _ = app.emit(
        "proxy-progress",
        ProxyProgress {
            phase: phase.to_string(),
            processed_ms,
            percent,
        },
    );
}

#[tauri::command]
fn get_ffmpeg_status(app: tauri::AppHandle, custom_path: Option<String>) -> FfmpegStatus {
    find_ffmpeg(&app, custom_path)
}

#[tauri::command]
async fn create_media_proxy(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProxyState>,
    source_path: String,
    duration_ms: u64,
    custom_path: Option<String>,
) -> Result<ProxyResult, String> {
    let ffmpeg = find_ffmpeg(&app, custom_path);
    let ffmpeg_path = ffmpeg.path.ok_or_else(|| {
        "Không tìm thấy FFmpeg. Hãy cài FFmpeg hoặc chọn đúng đường dẫn trong Settings.".to_string()
    })?;
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Video nguồn không còn tồn tại ở đường dẫn đã lưu.".to_string());
    }
    let output = proxy_output_path(&source)?;
    if output
        .metadata()
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
    {
        emit_proxy_progress(&app, "complete", duration_ms, duration_ms);
        return Ok(ProxyResult {
            path: output.to_string_lossy().to_string(),
            size_bytes: output.metadata().map(|value| value.len()).unwrap_or(0),
            cached: true,
        });
    }

    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        inner.cancelled.store(false, Ordering::SeqCst);
        emit_proxy_progress(&app, "starting", 0, duration_ms);
        let mut child = Command::new(ffmpeg_path)
            .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
            .arg(&source)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-dn",
                "-vf",
                "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
            ])
            .arg(&output)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Không thể chạy FFmpeg: {error}"))?;

        let progress_stream = child
            .stdout
            .take()
            .ok_or_else(|| "Không đọc được tiến độ FFmpeg.".to_string())?;
        let error_stream = child
            .stderr
            .take()
            .ok_or_else(|| "Không đọc được lỗi FFmpeg.".to_string())?;
        let process = Arc::new(Mutex::new(child));
        *inner
            .process
            .lock()
            .map_err(|_| "Proxy state is unavailable.".to_string())? = Some(process.clone());

        let error_thread = std::thread::spawn(move || {
            BufReader::new(error_stream)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        });

        let mut processed_ms = 0;
        for line in BufReader::new(progress_stream)
            .lines()
            .map_while(Result::ok)
        {
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .or_else(|| line.strip_prefix("out_time_ms="))
            {
                processed_ms = value.parse::<u64>().unwrap_or(0) / 1_000;
                emit_proxy_progress(&app, "transcoding", processed_ms, duration_ms);
            }
        }

        let status = process
            .lock()
            .map_err(|_| "Không thể đọc trạng thái FFmpeg.".to_string())?
            .wait()
            .map_err(|error| error.to_string())?;
        *inner
            .process
            .lock()
            .map_err(|_| "Proxy state is unavailable.".to_string())? = None;
        let errors = error_thread.join().unwrap_or_default();

        if inner.cancelled.load(Ordering::SeqCst) {
            let _ = fs::remove_file(&output);
            emit_proxy_progress(&app, "cancelled", processed_ms, duration_ms);
            return Err("Đã hủy tạo editing proxy.".to_string());
        }
        if !status.success() {
            let _ = fs::remove_file(&output);
            let detail = errors
                .lines()
                .last()
                .unwrap_or("FFmpeg không thể tạo proxy.");
            emit_proxy_progress(&app, "error", processed_ms, duration_ms);
            return Err(format!("FFmpeg thất bại: {detail}"));
        }

        emit_proxy_progress(&app, "complete", duration_ms, duration_ms);
        Ok(ProxyResult {
            path: output.to_string_lossy().to_string(),
            size_bytes: output.metadata().map(|value| value.len()).unwrap_or(0),
            cached: false,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn cancel_media_proxy(state: tauri::State<'_, ProxyState>) -> Result<bool, String> {
    state.inner.cancelled.store(true, Ordering::SeqCst);
    let process = state
        .inner
        .process
        .lock()
        .map_err(|_| "Proxy state is unavailable.".to_string())?
        .clone();
    if let Some(process) = process {
        process
            .lock()
            .map_err(|_| "Không thể dừng FFmpeg.".to_string())?
            .kill()
            .map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn gemini_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_gemini_api_key(api_key: String) -> Result<(), String> {
    let value = api_key.trim();
    if value.is_empty() {
        return Err("API key cannot be empty.".to_string());
    }
    gemini_keyring_entry()?
        .set_password(value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_gemini_api_key() -> Result<Option<String>, String> {
    match gemini_keyring_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_gemini_api_key() -> Result<(), String> {
    match gemini_keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_project_atomic(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    let parent = target
        .parent()
        .ok_or_else(|| "Project path has no parent folder.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temp = target.with_extension("subtrans.tmp");
    let backup = target.with_extension("subtrans.bak");
    fs::write(&temp, contents).map_err(|error| error.to_string())?;

    if target.exists() {
        fs::copy(&target, &backup).map_err(|error| error.to_string())?;
        fs::remove_file(&target).map_err(|error| error.to_string())?;
    }

    fs::rename(&temp, &target).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProxyState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_ffmpeg_status,
            create_media_proxy,
            cancel_media_proxy,
            set_gemini_api_key,
            get_gemini_api_key,
            delete_gemini_api_key,
            read_text_file,
            write_text_file,
            write_project_atomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running SubTrans");
}
