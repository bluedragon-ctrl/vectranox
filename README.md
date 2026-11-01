# VectraNox

Breakout-style roguelike with 80s synthwave vector graphics. TypeScript + three.js + Vite.

See [docs/PLAN.md](docs/PLAN.md) for the plan and architecture.

## Develop

```bash
npm install
npm run dev
```

`npm run build` type-checks and writes a static build to `dist/`.

## Controls

| | Mouse | Keyboard |
|---|---|---|
| Start / resume | click the playfield (locks the pointer) | Enter |
| Move | mouse | ← → or A D |
| Launch / release caught ball | click | Space |
| Fire laser | hold button | hold Space |
| Slow the game (hold) | right click | X |
| Pause | Esc | P or Esc |
| Music on / off | click MUSIC in the menu | M |
| Sound effects on / off | click SFX in the menu | F |
| Between stages: buy mods and lives with credits | click a card | 1–5 |
| Between stages: move on | click CONTINUE | Enter |

In dev builds the running game is available in the browser console as `vnx.game`;
`vnx.game.applyPower('laser')` grants a power-up (any kind from `POWER.kinds`) and
`vnx.game.fireStageEvent('overload')` runs a stage event (any kind from `STAGE_EVENTS.kinds`).
Both live in `src/config/tuning.ts`, together with drop chances, weights, durations and the event triggers.
`vnx.game.applyMod('heavy')` adds a mod stack (any kind from `MODS`). Mods, their rarity and the
lives card live in `src/config/mods.ts`; run length, room mix, depth scaling and the time bonus in `src/config/run.ts`.
`vnx.game.tryStage('PINWHEEL')` swaps the current stage for any room from `src/levels/rooms/`.

## Room editor

```bash
npm run editor
```

Or double-click `room-editor.bat` on Windows. Opens at <http://localhost:5174/editor/>. Rooms are one JSON file each in `src/levels/rooms/`; the editor reads them from GitHub (the open room PR if there is one, otherwise `main`), so `git` and a logged-in `gh` are needed.

- Pick a tool and drag on the grid; the right button erases. Keys: `1 2 3 # * r o` bricks and targets, `p` portal, `e` erase, `m` symmetry, Ctrl+Z / Ctrl+Y undo and redo.
- Formations are outlined in their colour, a rotation with its orbit. **Drag area** sets a formation's rows and columns from the grid.
- **Time** is the room's time limit for the time bonus, in seconds. Left empty, the room takes the limit of its kind, shown greyed out.
- **Play this room** opens the game on the room as it stands, unsaved edits included. Every new game there starts on it.
- **Save** puts all changed rooms in one pull request and keeps adding to it until it is merged or closed. Your checkout is left alone. Unsaved edits are kept in the browser.
- Checks run as you edit. Errors hold back Save and Play; `npm run build` runs the same checks on the room files.

## Music

Drop `.ogg` (or `.mp3`) files into `src/assets/music/`; they are picked up at build time and play as a
shuffled playlist with crossfades. Click the track name in the AUDIO panel to skip. Sound effects are
synthesized and need no files.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
