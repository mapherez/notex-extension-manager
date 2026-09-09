# NoX Extension Manager

NoX Extension Manager is a Tauri 2 desktop app that synchronizes and manages
unpacked Google Chrome extensions from this repository. The first release
targets Windows 11 x64 and Chrome Stable's `Default` profile. The native
automation boundary is ready for later macOS AXUIElement and Linux AT-SPI
adapters.

## Current MVP

- Discovers immediate folders under `extensions/` that contain a Manifest V3
  `manifest.json`; there is no separate catalogue.
- Reads only `mapherez/nox-extension-manager`, currently from `master`, and
  pins downloads to the exact commit SHA returned by GitHub.
- Uses ETag/commit caching, verifies Git object hashes and records SHA-256
  snapshots of local files.
- Downloads new extensions immediately. Updates for registered Chrome
  extensions remain staged until the user clicks **Update**.
- Blocks changed content unless `manifest.json` contains a strictly newer
  version, and blocks updates when active local files were modified.
- Automates Install, Reload/Update, Remove, Verify and Repair with Windows UI
  Automation selectors in English and pt-PT. No coordinate clicks are used.
- Includes the app updater UI, signed updater artifacts and persistent footer
  status after dismissing the update banner.

No Chrome window is opened during startup synchronization. Chrome automation
only starts after an explicit Install, Update, Remove or Repair action.

## Storage

Runtime files are outside the application installation:

```text
Documents/_NoxChromeExtensions/
├── <extension-id>/
└── .nox/
    ├── backups/
    ├── logs/
    ├── staging/
    ├── updates/
    ├── chrome-state.json
    └── repository-state.json
```

Removing an extension removes it from Chrome but retains its downloaded files.
The application updater only clears the app's local WebView cache; it never
removes this Documents directory.

## Development

Requirements:

- Node.js 24+
- Rust stable with the Windows MSVC toolchain
- Tauri's Windows prerequisites and WebView2
- Google Chrome Stable for end-to-end automation testing

```powershell
npm install
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:dev
```

The interface can also run in browser preview mode with `npm run dev`; it uses
demo card data and does not write to Documents.

## Publishing signed updates

The updater endpoint is fixed to:

```text
https://github.com/mapherez/nox-extension-manager/releases/latest/download/latest.json
```

Before the first release, generate a dedicated Tauri updater key pair:

```powershell
npx tauri signer generate -w .keys/nox-updater.key
```

Then:

1. Replace `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` in
   `src-tauri/tauri.conf.json` with the generated public key.
2. Store the private key contents in the repository secret
   `TAURI_SIGNING_PRIVATE_KEY`.
3. Store its password, if used, in
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Run the **Release Tauri app** workflow from GitHub Actions.

The private key directory is ignored by Git. The workflow builds signed Tauri
updater artifacts, creates `latest.json`, and uploads the installer, signatures
and update manifest to the GitHub Release. Authenticode signing is intentionally
outside the pilot MVP.

## Verification scope

Automated tests cover repository path/version/hash rules, atomic state storage,
Chrome-ID parsing, card states/actions, synchronization copy and persistent app
update status. Final UI Automation verification still requires a real unlocked
Windows 11 desktop with Chrome Stable in English and pt-PT.
