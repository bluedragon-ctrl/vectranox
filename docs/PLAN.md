# VectraNox — Plan & Architecture

Breakout-style roguelike with 80s synthwave vector graphics, running in desktop browsers.

## Decisions

| Topic | Decision |
|---|---|
| Name | **VectraNox** |
| Platform | Desktop browsers: Chrome, Edge, Firefox. No mobile, no gamepad. |
| Language / build | TypeScript (strict) + Vite. No test framework — `tsc --noEmit` and the in-game event console are the safety net. |
| Rendering | three.js (WebGL2). SDF shaders on instanced quads, fat lines for outlines, post-processing (bloom, chromatic aberration); bloom toggleable. No CRT filter (dropped in phase 2). |
| Look | Synthwave palette (magenta / cyan / purple over dark grid). 2.5D: gameplay is flat, bricks have light depth, camera near-flat. Glass is **stylized** (fresnel rim, inner highlight, slight background distortion), not physical transmission. |
| Physics | Custom arcade collision: swept circle vs. AABB, fixed 120 Hz step, paddle hit position sets bounce angle. |
| Controls | Mouse (pointer lock) and keyboard, selectable. |
| Layout | Canvas fills the window. Portrait (3:4) playfield on the **right**; left is a CSS "terminal" panel: menu, high scores, run info, live event console. Overlays (title, pause, upgrade pick, name entry) are CSS. |
| Game structure | Roguelike runs (see below). Formations reaching the paddle line cost a life. |
| Audio | Generated SFX via WebAudio synth. Music: user-provided `.ogg` tracks as a playlist with crossfade. |
| High scores | Name: 6 chars `[A-Z0-9 ]`. Phase 1: localStorage. Later: Cloudflare Worker + **D1** (not KV — KV is eventually consistent and can't sort). |
| Hosting | GitHub Pages via Actions now; same static build on a VPS later. Vite `base: './'` so paths work on both. |

## Architecture

```
 Input (mouse/pointer-lock, keyboard)
   │
   ▼
 Game simulation (fixed 120 Hz, deterministic, seeded RNG, no three.js imports)
   world: paddle · balls · bricks · formations · pickups · projectiles
   emits typed events on the event bus
   │                         │
   ▼ state snapshot          ▼ events
 Renderer (three.js)        Audio (WebAudio)       UI (CSS)            ScoreService
 interpolates between ticks synth SFX, music bus   HUD, menus,         Local → Remote
 SDF/glass, particles, post                        event console
```

Rule: `src/game/` never imports from `render/`, `audio/` or `ui/`. Everything else only reads state and listens to events. Determinism enables replays, attract mode, reproducible bugs and (later) server-side score validation by re-simulating recorded inputs.

### Folder layout

```
src/
  main.ts            boot, wiring, top-level state machine
  config/            tuning constants (field size, speeds, palette)
  core/              fixed-step loop, input, typed event bus, seeded rng
  game/              pure simulation: entities, systems, powerups, rules
  levels/            stage templates, formation patterns, procedural assembly
  render/            Renderer, materials (GLSL), fx, background
  audio/             AudioEngine, synth presets, MusicPlayer
  ui/                left panel, overlays, event console
  scores/            ScoreService interface + implementations
public/music/        .ogg tracks
worker/              (later) Cloudflare Worker + D1 schema
```

## Roguelike structure (proposal — to be refined)

- **Run** = 3–4 **sectors** × 4–5 **stages**; the last stage of a sector is a guardian/boss.
- **Stages** are assembled procedurally from hand-made templates + formation patterns, scaled by depth. Runs are seeded (enables a later "daily seed" leaderboard).
- **In-stage power-ups** (temporary drops): multi-ball, laser, expand/shrink, slow/fast, sticky, piercing, shield, extra life, a few negative ones.
- **Between stages**: pick 1 of 3 **mods** that last the whole run (e.g. laser cooldown, chain explosions, crit chance, magnet pickups), with rarity tiers.
- **Currency** ("data shards") dropped by bricks, spent in a shop every few stages (lives, rerolls, mods).
- Death ends the run; the run score goes to the leaderboard.
- Meta-progression between runs: **none initially** (keeps the leaderboard fair). Revisit later.

## Phases

| # | Phase | Deliverable |
|---|---|---|
| 0 | Skeleton | Vite + TS, layout (left panel + right playfield), three.js renderer with letterboxing, fixed-step loop, event bus, event console, Pages deploy. |
| 1 | Playable core | Paddle (mouse + keyboard), ball, swept collision, bricks, lives, a few fixed stages, title/play/pause/game-over states. Flat placeholder visuals; goal is feel. |
| 2 | Visual identity | Synthwave grid background, SDF neon, stylized glass bricks with depth, bloom, particles, trails, shake. Reduce-flashing/shake setting. |
| 3 | Power-ups | Drops, multi-ball, laser + projectiles, the rest of the list. |
| 4 | Audio | Synth SFX from events, playlist music player, volume settings, click-to-start audio unlock. |
| 5 | Roguelike layer | Sectors/stages, procedural assembly, mods, shards, shop, moving formations (sweep, invader march, rotate, sine), brick types (multi-hit, indestructible, explosive, regenerating), bosses. |
| 6 | Scores & settings | Local high-score table, 6-char name entry, settings, quality presets. |
| 7 | Polish | Parallax background, music-reactive visuals, attract mode. |
| 8 | Online | Worker + D1 leaderboard, rate limiting, optional Turnstile / replay validation; VPS move. |

## Open questions

- Roguelike details: run length, shop frequency, mod list, boss designs.
- Number of music tracks and whether they have loop points.
- Daily-seed mode: yes/no.
