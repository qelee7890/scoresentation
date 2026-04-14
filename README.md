# Scoresentation

Church hymn presentation and score editor — a desktop app built with Electron.

## Features

- **Presentation mode**: Setlist-based slide presentation with hymn lyrics, music notation, images, text pages
- **Score editor**: Interactive SVG-based music notation editor with inline menus for note pitch, duration, accidentals, beams
- **559 hymns** with melody data (imported from NWC files)
- **Setlist management**: Create, save, load setlists with drag-and-drop ordering
- **Multiple page types**: Score (hymn/custom), blank, text (markdown + KaTeX), image (multi-image support)
- **Light/Dark theme** with background image support
- **Zoom control** for presentation view
- **Auto-update** via GitHub Releases

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- Windows 10/11

### Install & Run

```bash
git clone https://github.com/qelee7890/scoresentation.git
cd scoresentation
npm install
npx electron-rebuild
npm start
```

### Build Installer

```bash
npm run build
```

Output: `dist/Scoresentation Setup X.X.X.exe`

## Project Structure

```
scoresentation/
├── main.js              # Electron main process
├── preload.cjs          # Context bridge (IPC)
├── package.json
├── main/                # Backend (better-sqlite3)
│   ├── db.js
│   └── media.js
├── src/                 # Frontend
│   ├── index.html       # Presentation
│   ├── editor.html      # Score editor
│   ├── present.js/css
│   ├── editor.js/css
│   ├── notes.js/css     # SVG music notation engine
│   ├── storage.js
│   └── setlistStorage.js
├── fonts/               # Bravura, Freesentation
├── data/                # SQLite databases, media, images
└── tools/               # NWC conversion utilities
```

## Tech Stack

- **Electron** — Desktop shell
- **better-sqlite3** — Database access
- **Vanilla JS** — No frontend framework
- **SVG + Bravura (SMuFL)** — Music notation rendering
- **marked + DOMPurify + KaTeX** — Markdown and math rendering

## License

This project is private. All rights reserved.
