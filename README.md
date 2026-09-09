# NoX Extension Manager

NoX Extension Manager is a Tauri desktop application for synchronizing and
managing local Google Chrome extensions from a trusted GitHub repository.

The project is currently initialized with Tauri 2, Rust, React, TypeScript, and
Vite. Feature implementation will be added incrementally on top of this base.

## Requirements

- Node.js 24+
- npm
- Rust stable
- The platform prerequisites listed in the Tauri documentation

## Development

Install dependencies:

```sh
npm install
```

Run the frontend:

```sh
npm run dev
```

Run the desktop app:

```sh
npm run tauri dev
```

Build the frontend:

```sh
npm run build
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
