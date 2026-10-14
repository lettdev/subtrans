# SubTrans release guide

## Windows-first release

Build the production installer on a Windows x64 machine with Node.js 22+, Rust stable, and the Tauri Windows prerequisites:

```powershell
npm ci
npm run check:release
npm run bundle:windows
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`. It installs per user without requiring administrator privileges and downloads the small WebView2 bootstrapper only when Windows does not already provide a sufficiently recent runtime.

The generated installer is unsigned until a Windows code-signing certificate is configured. Do not publish an unsigned installer as a trusted stable release. Keep certificate material outside the repository and configure it on the Windows build host or CI secret store.

## macOS release

Build the DMG on the target macOS architecture:

```bash
npm ci
npm run check:release
npm run bundle:mac
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`. Public distribution requires Developer ID signing and Apple notarization; those credentials are intentionally not stored in this repository.

## CI artifacts

`.github/workflows/release-build.yml` builds Windows NSIS and macOS DMG artifacts on a manual run or a `v*` tag. It uploads workflow artifacts but does not publish a public release, so unsigned builds cannot accidentally be presented as stable downloads.

## FFmpeg

SubTrans does not redistribute FFmpeg. At runtime it checks, in order:

1. A custom path saved in Settings.
2. `SUBTRANS_FFMPEG_PATH`.
3. A future bundled `resources/bin/ffmpeg` binary.
4. Common Windows package-manager, Homebrew, and `PATH` locations.

On Windows, users can install an FFmpeg build through their preferred package manager and then restart SubTrans or paste the full `ffmpeg.exe` path in Settings. Keeping FFmpeg external avoids silently shipping an unknown GPL/LGPL build and lets the user update codecs independently.
