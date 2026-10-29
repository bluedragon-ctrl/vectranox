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
- **In-stage power-ups** (capsules dropped by broken bricks, lettered): **M** multi-ball, **L** laser, **E** expand, **S** slow, **C** catch (sticky), **P** pierce, **B** barrier (shield), **+** extra life; negative (red, striped): **N** narrow, **F** fast. Timed ones show in the left panel; all are lost with a life or at stage end. Drop chance, drop weights, durations and effect sizes live in `src/config/powers.ts`.
- **Stage events**: rule-based triggers inside a stage that keep the end of a stage from dragging. Example: when 5 or fewer breakable bricks are left, drop a guaranteed capsule or split the balls; when no brick has been hit for a while, help the stuck ball. Each event fires at most once per stage, is announced in-game and logged to the event console, and rolls on the seeded RNG. Thresholds and outcomes are tunable in a config file. (Named "stage events" to keep them apart from the event bus.)
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
| 3b | Stage events | Small phase. A trigger system for in-stage events: an end-game assist when few bricks are left (guaranteed capsule drop or ball split), stall help when no brick has been hit for N seconds, a short in-game banner and console logging. Tuning in `src/config/events.ts`. |
| 4 | Audio | Synth SFX from events, playlist music player, volume settings, click-to-start audio unlock. |
| 5a | Run progression & shop | Run → sectors → stages, seeded procedural assembly from templates scaled by depth, pick-1-of-3 mods between stages (rarity tiers), data shards, shop every few stages (lives, rerolls, mods). |
| 5b | Room types | Stage variety: moving formations (sweep, invader march, rotate, sine) and the line where they cost a life, new brick types (explosive, regenerating; multi-hit and indestructible already exist), and distinct room kinds a sector mixes (e.g. standard, formation, elite). |
| 5c | Boss rooms | A guardian stage at the end of each sector: boss with its own HP bar and attack patterns (projectiles the paddle must avoid), phases as it takes damage, and a reward on kill. |
| 6 | Scores & settings | Local high-score table, 6-char name entry, settings, quality presets. |
| 7 | Polish | Parallax background, music-reactive visuals, attract mode. |
| 8 | Online | Worker + D1 leaderboard, rate limiting, optional Turnstile / replay validation; VPS move. |

## Open questions

- Roguelike details: run length, shop frequency, mod list, boss designs.
- Number of music tracks and whether they have loop points.
- Daily-seed mode: yes/no.
