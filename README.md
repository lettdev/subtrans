# SubTrans

SubTrans is a Windows-first desktop workspace for translating and editing movie subtitles while following a local video. The four planned implementation phases are now represented in the codebase; the current desktop release is **0.4.3**. The previous prototype remains untouched in [`ref/`](./ref/).

## Implemented features

- Open a local video and inspect whether Windows WebView2 is likely to play it directly.
- Attach an external audio track, mute the video's original track, and keep play/pause/seek/rate synchronized with low-jitter drift correction.
- Keep the video player and controls pinned while the active subtitle auto-scrolls, with a larger readability-focused UI scale.
- Parse SRT files with BOM, CRLF, multiline cues, and either comma or dot milliseconds.
- Follow and auto-scroll the active subtitle while the video plays.
- Edit source and Vietnamese text side by side.
- Preview translated text over the video.
- Export UTF-8 BOM SRT, falling back to source text for untranslated cues.
- Keyboard controls: `Space`, `Shift+Space`, and `Ctrl+Up/Down`.
- Domain tests for parsing, exporting, timestamps, and active-cue lookup.
- Versioned `.subtrans.json` projects with browser recovery and native autosave.
- Atomic native project writes with a `.subtrans.bak` backup.
- Undo/redo, editable timing, add/delete/split/merge, and per-cue timing shifts.
- Import an existing translated SRT by index and timestamp.
- Search, workflow filters, approved state, and subtitle quality validation.
- Native Tauri dialogs for opening media/subtitles/projects and saving projects/SRT files.
- Gemini streaming translation with stable Flash/Flash-Lite model selection.
- Adaptive 150–300 cue batches and a local request estimate before translation starts.
- Character Bible, project context, and rolling translation memory returned in the same response as each batch.
- Partial-stream recovery and one targeted retry containing only missing cue IDs.
- Autosave/resume after cancellation, network failure, or a Gemini 429 quota response.
- Protection for imported, manually edited, and approved cues; Gemini only fills eligible empty cues.
- Daily soft request budget with a user-controlled reserve, reset on the Gemini quota day (Pacific time).
- Usage metadata for request, input-token, and output-token tracking without separate `countTokens` calls.
- API key storage in Windows Credential Manager/macOS Keychain. The key is never written to project JSON.
- FFmpeg discovery from a custom path, environment override, app resources, common Windows package-manager locations, Homebrew, or `PATH`.
- Cancellable, progress-reporting editing-proxy generation to MP4 H.264/AAC with a 1080p ceiling.
- Content-addressed proxy caching that preserves the source video and reuses the proxy while the source is unchanged.
- Hardened production CSP allowing only local app assets and Gemini API traffic.
- Windows NSIS installer configuration with per-user install and WebView2 bootstrap handling.
- macOS DMG configuration and a GitHub Actions workflow that produces a Windows installer, Windows portable ZIP, and macOS DMG.

## Request-saving design

SubTrans does not issue a connection-test request or a separate context-analysis request. The first Gemini call is already a useful translation batch. Each response returns both translated cue IDs and a compact rolling memory, so context and forms of address carry forward without doubling the request count. The SDK's automatic continuation is disabled to avoid hidden follow-up requests; an incomplete response is recovered locally and only missing cue IDs are retried once.

The request budget is deliberately configurable because Google applies limits per project/model/tier. SubTrans treats it as a conservative local guard, not as a promise of the account's live quota.

## Development

Requirements:

- Node.js 20 or newer
- Rust stable
- Windows: Microsoft Edge WebView2 and the prerequisites listed by Tauri

```bash
npm install
npm run dev
npm test
npm run tauri dev
```

Create a production frontend build with:

```bash
npm run build
```

Create a Windows NSIS installer with `npm run bundle:windows` on Windows, or a macOS DMG with `npm run bundle:mac` on macOS. See [`docs/RELEASE.md`](./docs/RELEASE.md) for build locations and signing boundaries.

## Media compatibility spike

MP4/M4V/WebM/MOV are treated as direct-play candidates. MKV, AVI, WMV, TS, and M2TS are allowed but marked as uncertain because support depends on the codecs available to WebView2. When direct playback fails or a container is uncertain, the desktop app can create a cached editing proxy. FFmpeg remains an external runtime so SubTrans does not silently redistribute a build with unknown GPL/LGPL configuration.

## Current boundaries

Gemini calls require a user-supplied API key and are intentionally not exercised by automated tests. Public Windows and macOS distribution still requires the maintainer's own code-signing certificates; no private signing material belongs in this repository.
