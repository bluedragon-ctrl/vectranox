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
| Alt action (detonate a charge) | right click | X |
| Pause | Esc | P or Esc |
| Mute audio | | M |

In dev builds the running game is available in the browser console as `vnx.game`;
`vnx.game.applyPower('laser')` grants a power-up (any kind from `POWER.kinds`, e.g. `'detonator'` for charges) and
`vnx.game.fireStageEvent('overload')` runs a stage event (any kind from `STAGE_EVENTS.kinds`).
Both live in `src/config/tuning.ts`, together with drop chances, weights, durations and the event triggers.

## Music

Drop `.ogg` (or `.mp3`) files into `src/assets/music/`; they are picked up at build time and play as a
shuffled playlist with crossfades. Click the track name in the AUDIO panel to skip. Sound effects are
synthesized and need no files.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
