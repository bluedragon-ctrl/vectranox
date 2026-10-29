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
| Audio | Generated SFX via WebAudio synth (oscillators and filtered noise, panned by x; brick hits climb a pentatonic scale until the paddle touches a ball). Music: user-provided `.ogg` / `.mp3` tracks dropped into `src/assets/music/`, picked up at build time, played as a shuffled playlist with crossfade. Master / music / SFX volume and mute (**M**) in the left panel; the music muffles while paused. Audio starts on the first click or key press (browser autoplay rules). |
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
  audio/             AudioEngine, synth voices, GameSounds (event → sound), MusicPlayer
  assets/music/      .ogg / .mp3 tracks (globbed at build time)
  ui/                left panel, overlays, event console
  scores/            ScoreService interface + implementations
worker/              (later) Cloudflare Worker + D1 schema
```

## Roguelike structure (proposal — to be refined)

- **Run** = 3 **sectors** × 4 **stages** (12 stages, `RUN` in `src/config/run.ts`). Phase 5c adds a guardian/boss as the last stage of each sector; until then the last stage prefers the sector's hardest templates.
- **Stages** are assembled when the run starts from 14 hand-made templates (`src/levels/stages.ts`, assembly in `src/levels/assemble.ts`) on their own seeded stream, so the same seed always gives the same stages however the run is played. Each template has a tier (the first sector it can appear in); BOOT SEQUENCE always opens; templates don't repeat within a run. Depth scaling: the ball starts 9 units/s faster each stage, and layouts may be mirrored. Brick scaling (more 2- and 3-hit bricks deeper in the run) is built but switched off (`RUN.depth`) while ball speed alone is playtested. Formation patterns come with phase 5b.
- **In-stage power-ups** (capsules dropped by broken bricks, lettered): **M** multi-ball, **L** laser, **E** expand, **S** slow, **C** catch (sticky), **P** pierce, **B** barrier (shield), **+** extra life; negative (red, striped): **N** narrow, **F** fast; charge powers: **X** detonator (see Alt action). Timed ones show in the left panel; all are lost with a life or at stage end. Drop chance, drop weights, durations and effect sizes live in `src/config/tuning.ts`.
- **Stage events**: rule-based triggers inside a stage that keep the end of a stage from dragging. Example: when 5 or fewer breakable bricks are left, drop a guaranteed capsule or split the balls; when no brick has been hit for a while, help the stuck ball. Each event has a chance and a per-stage cap, is announced in-game and logged to the event console, and rolls on the seeded RNG. Current set: **supply drop** (a brick drops a positive capsule, ≤ 8 bricks left), **overload** (balls split, ≤ 4 left), **pulse** (no brick hit for 10 s: the lowest 8 breakable bricks take a hit), **hunter** (≤ 3 left and no kill for 12 s: laser), **safety net** (serving on the last life late in a stage: barrier), **demolition** (≤ 6 left: free detonator charges). Triggers, chances and effects are tuned in `src/config/tuning.ts`, next to the power-ups. (Named "stage events" to keep them apart from the event bus.)
- **Alt action**: a second button for paddle actions, next to launch/fire: right click with the mouse (the playfield's context menu is off), **X** on the keyboard (the real Alt key is avoided because browsers use it for the menu bar, Shift because repeated presses open Windows Sticky Keys). It carries an edge-triggered `alt` press in `TickInput`, so replays stay deterministic. Alt spends **charges** from charge powers; with none held, and while serving, it does nothing. First user is the **X** detonator power-up: a capsule gives 3 charges, and picking another while holding charges adds 1, up to 5. Each alt press spends one charge and makes every ball explode (caught balls included; a tuning switch can limit it to the highest ball): every breakable brick within the blast radius (32 units, to the nearest point of the brick) of any ball takes one hit, once per press however many balls reach it, so tough bricks lose one hp, steel is unaffected, and the balls fly on. Charges are lost with a life or at stage end like other powers. While charges are held the balls are tinted orange; the left panel shows the charges as pips; each ball's blast is a single fading ring, with one light shake and flash per press. The **demolition** stage event grants 2 charges when 6 or fewer bricks are left. Charges, radius, damage and the event live in `src/config/tuning.ts`. Later powers and mods can add other charge kinds on the same button.
- **Pinball pieces**: stage layouts can place round pieces next to bricks. **Targets** (`o`) light when the ball bounces off them; lighting the whole bank pays a bonus and steps the score multiplier (×1 → ×2 → ×3 → ×5), which scales all brick points until a life is lost (shown as MULT in the left panel). **Portals** (a letter, used twice per pair) are small animated black holes: a ball reaching one comes out of the other with the same velocity. First used in the WORMHOLE stage; tuned in `PINBALL` in `src/config/tuning.ts`. Candidates for later: round bumpers, rollover lanes above the top row.
- **Between stages**: after every stage but the last, pick one of 3 **mod** cards that last the whole run, or a fourth card for **+2 lives** instead (up to the 9-life cap; the card is greyed out when full). Every stage is that one trade-off, power against safety. Mods stack up to a limit and come in three rarities (common / rare / epic, weights shift towards rare and epic in later sectors). Current set: common — **wide frame** (paddle +10%), **lucky drops** (capsule chance +3%), **magnet** (capsules drift to the paddle), **extender** (good powers +20% time), **dampener** (ball −5% speed), **long beam** (+3 s on every laser, max 3), **multi start** (each stage's first launch splits the ball), **extra ball** (every split makes one more ball per ball, max 2), **armory** (a detonator charge each stage, max 3), **failsafe** (7 s barrier each stage, max 3); rare — **critical** (15% chance a ball that breaks a brick carries on through it instead of bouncing), **blast radius** (detonator radius +30%, max 3), **chain link** (chain bonus +50%), **second wind** (once a stage per stack, max 2, losing the last ball serves a new one without costing a life; powers and multiplier kept), **piercing laser** (laser bolts fly on through a brick they break, one per stack, max 2), **amplifier** (+1 to the score multiplier once a target bank has lit it, max 3), **wormhole echo** (25% chance per stack, max 3, that a ball going through a portal comes out as two); epic — **heavy ball** (ball hits count double), **anchor** (a lost life drops the multiplier one step instead of resetting it), **splitter** (every serve splits the ball in three), **laser start** (10 s of laser at the start of each stage), **cluster charge** (every detonation adds a ball). The left panel lists the mods held. All in `src/config/mods.ts`: per mod its name, rarity, max stacks, effect per stack and card text (generated from the effect, so it always matches), plus the rarity weights and the lives card. The pick is a CSS screen over the playfield: click a card or press 1–4 (Space never chooses, so a mashed launch can't pick). Choices are `Game` method calls, so replays will need to record them with their tick next to the per-tick input. Mod offers roll on their own seeded stream.
- **No currency or shop** (decided in phase 5a): a first version had data shards dropped by bricks and a shop every 2 stages selling lives, mods and rerolls; it was replaced by the lives card in the pick, which keeps the same choice without a second economy.
- Death ends the run; the run score goes to the leaderboard.
- Meta-progression between runs: **none initially** (keeps the leaderboard fair). Revisit later.

## Phases

| # | Phase | Deliverable |
|---|---|---|
| 0 | Skeleton | Vite + TS, layout (left panel + right playfield), three.js renderer with letterboxing, fixed-step loop, event bus, event console, Pages deploy. |
| 1 | Playable core | Paddle (mouse + keyboard), ball, swept collision, bricks, lives, a few fixed stages, title/play/pause/game-over states. Flat placeholder visuals; goal is feel. |
| 2 | Visual identity | Synthwave grid background, SDF neon, stylized glass bricks with depth, bloom, particles, trails, shake. Reduce-flashing/shake setting. |
| 3 | Power-ups | Drops, multi-ball, laser + projectiles, the rest of the list. |
| 3b | Stage events | Small phase. A trigger system for in-stage events: an end-game assist when few bricks are left (guaranteed capsule drop or ball split), stall help when no brick has been hit for N seconds, a short in-game banner and console logging. Tuning shared with power-ups in `src/config/tuning.ts`. |
| 3c | Alt action | Small phase. Second action button (right click / X) wired through input and `TickInput`, the detonator power-up (charged ball explodes on alt press, area damage), its HUD readout of charges left, blast effect, and the demolition stage event. Further charge kinds on the alt button come later. |
| 4 | Audio | Synth SFX from events, playlist music player, volume settings, click-to-start audio unlock. |
| 5a | Run progression | Run → sectors → stages, seeded procedural assembly from templates scaled by depth, pick 1 of 3 mods or +2 lives between stages (rarity tiers). **Done:** 3 × 4 stages, 14 templates, 22 mods. Currency and shop dropped in favour of the lives card. |
| 5b | Room types | Stage variety: moving formations (sweep, invader march, rotate, sine) and the line where they cost a life, new brick types (explosive, regenerating; multi-hit and indestructible already exist), and distinct room kinds a sector mixes (e.g. standard, formation, elite). |
| 5c | Boss rooms | A guardian stage at the end of each sector: boss with its own HP bar and attack patterns (projectiles the paddle must avoid), phases as it takes damage, and a reward on kill. |
| 6 | Scores & settings | Local high-score table, 6-char name entry, settings, quality presets. |
| 7 | Polish | Parallax background, music-reactive visuals, attract mode. |
| 8 | Online | Worker + D1 leaderboard, rate limiting, optional Turnstile / replay validation; VPS move. |

## Open questions

- Roguelike details: boss designs; whether run length (3 × 4) and +2 lives per pick hold up in play.
- Number of music tracks and whether they have loop points.
- Daily-seed mode: yes/no.
