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
| Pause | Esc | P or Esc |

In dev builds the running game is available in the browser console as `vnx.game`;
`vnx.game.applyPower('laser')` grants a power-up (any kind from `POWER.kinds`) and
`vnx.game.fireStageEvent('overload')` runs a stage event (any kind from `STAGE_EVENTS.kinds`).
Both live in `src/config/tuning.ts`, together with drop chances, weights, durations and the event triggers.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
