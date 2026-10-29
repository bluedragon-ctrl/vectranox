# VectraNox

Breakout-style roguelike with 80s synthwave vector graphics. TypeScript + three.js + Vite.

See [docs/PLAN.md](docs/PLAN.md) for the plan and architecture.

## Develop

```bash
npm install
npm run dev
```

`npm run build` type-checks and writes a static build to `dist/`.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
