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
| Layout | Canvas fills the window. Portrait (3:4) playfield on the **right**; left is a CSS "terminal" panel: run info, powers, mods, live event console. Overlays (title, pause, upgrade pick, name entry) are CSS; the title, pause and end screens carry the high scores and options. |
| Game structure | Roguelike runs (see below). Marching formations reaching the line above the paddle cost a life. |
| Audio | Generated SFX via WebAudio synth (oscillators and filtered noise, panned by x; brick hits climb a pentatonic scale until the paddle touches a ball). Music: user-provided `.ogg` / `.mp3` tracks dropped into `src/assets/music/`, picked up at build time, played as a shuffled playlist with crossfade. Master / music / SFX volume and mute (**M**) on the title, pause and end screens; the music muffles while paused. Audio starts on the first click or key press (browser autoplay rules). |
| High scores | Name: 6 chars `[A-Z0-9 ]`. Now: top 10 in localStorage (`src/core/scores.ts`), each with where the run ended or WIN; a run that makes the table asks for a name, prefilled with the last one. Rooms played from the editor don't count. Later: Cloudflare Worker + **D1** (not KV — KV is eventually consistent and can't sort). |
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

- **Run** = 3 **sectors** × 4 **stages** (12 stages, `RUN` in `src/config/run.ts`). Each sector ends in an elite room and then a boss.
- **Stages** are assembled when the run starts from 33 hand-made templates (one JSON file each in `src/levels/rooms/`, edited with `npm run editor`; assembly in `src/levels/assemble.ts`) on their own seeded stream, so the same seed always gives the same stages however the run is played. Each template has a room kind and a tier (the first sector it can appear in); BOOT SEQUENCE always opens; templates don't repeat within a run. Depth scaling: the ball starts 9 units/s faster each stage, formations move 3% faster, and layouts may be mirrored. Brick scaling (more 2- and 3-hit bricks deeper in the run) is built but switched off (`RUN.depth`) while ball speed alone is playtested.
- **Bosses** are ordinary rooms made of bricks (`"room": "boss"`, drawn in the room editor, with a `boss` block in the file): movement is a formation, armour is bricks and steel, and collision, mods and capsules work as anywhere. Four brick types are boss-only. The **core** (`c`, a filled rectangle of cells that makes one big brick, gold reactor casing, the one brick that animates) is the win condition: destroy it and the room shatters. It has its own HP (top of the field, with a notch per phase), and pulses faster and turns redder as the fight goes on. **Turrets** (`t`) fire shots that pass through bricks; a shot reaching the paddle freezes it for 0.7 s, so the danger is missing the ball. **Spawners** (`s`) send 1-hit bricks down to the line, costing a life if they reach it; they pay nothing and don't count towards anything. **Phantoms** (`g`) release shadow balls: purple decoys that bounce but break nothing, cost nothing when lost and fade after 6 s, kept out of `Game.balls` so no ball rule touches them. Emitters flash before they act, take turns within their kind, and stop when broken, so shooting them out first is a tactic. The `boss` block sets the core's HP and phases: each starts at a share of that HP and sets the fire pattern (straight, aimed, fan), how often each emitter acts, and the formations' pace. Damage stops at each phase's threshold and a 1.5 s break follows, with the core shielded and nothing firing. Steel can seal a core: a sealed `vault` needs portals to get in (only for a boss that stays still, since portals don't move), every phase change throws the balls back out, and portals catch from further in boss rooms. The validator refuses a room whose core no ball can reach. Against the core a laser bolt does 0.15 hits, pierce doesn't go through, and hits don't speed the ball up; explosions reach it through steel. Killing a boss pays +2500 and opens a **boss cache** (mostly epic mods, `BOSS_WEIGHTS` in `mods.ts`). Three so far, one per sector: **SENTINEL** (sweeps, teaches dodging), **WARDEN** (vault behind portals, rotating ring), **NOX** (marches at the line with every emitter type). Shared numbers are in `BOSS` in `src/config/tuning.ts`, the fight in `src/game/boss.ts`. Fight numbers have only been tried by a simple bot so far.
- **Rooms**: each sector mixes these kinds of room, set slot by slot in `RUN.rooms`. **Standard** rooms are still layouts. **Formation** rooms have groups of bricks that move. **Elite** rooms are the hardest layouts of their tier: the ball starts 18 units/s faster, clearing the room pays +1000, and the pick after it is an **elite cache** that offers only rare and epic mods (`ELITE` in `run.ts`, `ELITE_WEIGHTS` in `mods.ts`). The serve screen and the pick name the room.
- **Formations**: a template lists groups of bricks by rows and columns, each with a motion; the rest stand still. **Sweep** runs side to side, **march** hops in beats like space invaders and drops a row at each wall, **rotate** orbits the group's middle (bricks stay level, so collision stays axis-aligned), **sine** bobs the columns in a wave. Formations only move during play. Sweep and march turn at the bricks still alive, so clearing the outer columns widens their path, and a march's beat speeds up as it loses bricks. A breakable brick of a march reaching the line (dashed, brightening as they near it) costs a life, and the formation goes back to its starting height; steel doesn't count. Bricks move before the balls do, so a brick that lands on a ball shoves it out and counts as a hit. Tuned in `FORMATION` in `src/config/tuning.ts`.
- **Special bricks** (`BRICK_TYPES` in `src/config/tuning.ts`): **explosive** (`*`, hazard stripes): one hit, and a moment after it breaks it goes off as an explosion: every breakable brick within 22 units takes a hit, setting off other explosives in turn; a single fading ring shows the reach. Explosions work the same whether a brick or a charge set them off (one shared rule and code, see Alt action), so the blast radius, steel breaker and cluster charge mods apply to both. **Regenerating** (`r`, mint plate): 2 hits, and it wins one back after 4 s without a hit, so it needs two hits in quick succession.
- **In-stage power-ups** (capsules dropped by broken bricks, lettered): **M** multi-ball, **L** laser, **E** expand, **S** slow, **C** catch (sticky), **P** pierce, **B** barrier (shield), **+** extra life; negative (red, striped): **N** narrow, **F** fast; charge powers: **X** detonator (see Alt action). Colours go by family: cyan for the ball (M, S, P, B), magenta for the paddle (L, E, C, X), yellow for the life, red for negative ones. Timed ones show in the left panel; all are lost with a life or at stage end. Drop chance, drop weights, durations and effect sizes live in `src/config/tuning.ts`.
- **Stage events**: rule-based triggers inside a stage that keep the end of a stage from dragging. Example: when 5 or fewer breakable bricks are left, drop a guaranteed capsule or split the balls; when no brick has been hit for a while, help the stuck ball. Each event has a chance and a per-stage cap, is announced in-game and logged to the event console, and rolls on the seeded RNG. Current set: **supply drop** (a brick drops a positive capsule, ≤ 8 bricks left), **overload** (balls split, ≤ 4 left), **pulse** (no brick hit for 10 s: the lowest 8 breakable bricks take a hit), **hunter** (≤ 3 left and no kill for 12 s: laser), **safety net** (serving on the last life late in a stage: barrier), **demolition** (≤ 6 left: free detonator charges). Triggers, chances and effects are tuned in `src/config/tuning.ts`, next to the power-ups. (Named "stage events" to keep them apart from the event bus.)
- **Alt action**: a second button for paddle actions, next to launch/fire: right click with the mouse (the playfield's context menu is off), **X** on the keyboard (the real Alt key is avoided because browsers use it for the menu bar, Shift because repeated presses open Windows Sticky Keys). It carries an edge-triggered `alt` press in `TickInput`, so replays stay deterministic. Alt spends **charges** from charge powers; with none held, and while serving, it does nothing. First user is the **X** detonator power-up: a capsule gives 3 charges, and picking another while holding charges adds 1, up to 5. Each alt press spends one charge and makes every ball go off as one explosion (caught balls included; a tuning switch can limit it to the highest ball): every breakable brick within the blast radius (32 units, to the nearest point of the brick) of any ball takes one hit, once per explosion however many balls reach it, so tough bricks lose one hp, steel is unaffected (unless the steel breaker mod is held), and the balls fly on. Charges are lost with a life or at stage end like other powers. While charges are held the balls are tinted orange; the left panel shows the charges as pips; each ball's blast is a single fading ring, with one light shake and flash per press. The **demolition** stage event grants 2 charges when 6 or fewer bricks are left. Charges, radius, damage and the event live in `src/config/tuning.ts`. Later powers and mods can add other charge kinds on the same button.
- **Pinball pieces**: stage layouts can place round pieces next to bricks. **Targets** (`o`) light when the ball bounces off them; lighting the whole bank pays a bonus and steps the score multiplier (×1 → ×2 → ×3 → ×5), which scales all brick points until a life is lost (shown as MULT in the left panel). **Portals** (a letter, used twice per pair) are small animated black holes: a ball reaching one comes out of the other with the same velocity. First used in the WORMHOLE stage; tuned in `PINBALL` in `src/config/tuning.ts`. Candidates for later: round bumpers, rollover lanes above the top row.
- **Between stages**: after every stage but the last, pick one of 3 **mod** cards that last the whole run, or a fourth card for **+2 lives** instead (up to the 9-life cap; the card is greyed out when full). Every stage is that one trade-off, power against safety. Mods stack up to a limit and come in three rarities (common / rare / epic, weights shift towards rare and epic in later sectors). Current set: common — **wide frame** (paddle +10%), **lucky drops** (capsule chance +5%), **magnet** (capsules drift to the paddle), **extender** (good powers +20% time), **dampener** (ball −5% speed), **long beam** (+3 s on every laser, max 3), **multi start** (each stage's first launch splits the ball), **extra ball** (every split makes one more ball per ball, max 2), **armory** (a detonator charge each stage, max 3), **failsafe** (7 s barrier each stage, max 3); rare — **critical** (15% chance a ball that breaks a brick carries on through it instead of bouncing), **blast radius** (explosion radius +30%, max 3), **chain link** (chain bonus +50%), **second wind** (once a stage per stack, max 2, losing the last ball serves a new one without costing a life; powers and multiplier kept), **piercing laser** (laser bolts fly on through a brick they break, one per stack, max 2), **amplifier** (+1 to the score multiplier once a target bank has lit it, max 3), **wormhole echo** (25% chance per stack, max 3, that a ball going through a portal comes out as two), **steel breaker** (25% chance per stack, max 2, that an explosion breaks each steel brick in reach); epic — **heavy ball** (ball hits count double), **anchor** (a lost life drops the multiplier one step instead of resetting it), **splitter** (every serve splits the ball in three), **laser start** (10 s of laser at the start of each stage), **cluster charge** (every explosion adds a ball), **split guard** (every split raises 5 s of barrier per stack, max 2). The left panel lists the mods held. All in `src/config/mods.ts`: per mod its name, rarity, max stacks, effect per stack and card text (generated from the effect, so it always matches), plus the rarity weights and the lives card. The pick is a CSS screen over the playfield: click a card or press 1–4 (Space never chooses, so a mashed launch can't pick). Choices are `Game` method calls, so replays will need to record them with their tick next to the per-tick input. Mod offers roll on their own seeded stream.
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
| 5a | Run progression | Run → sectors → stages, seeded procedural assembly from templates scaled by depth, pick 1 of 3 mods or +2 lives between stages (rarity tiers). **Done:** 3 × 4 stages, 14 templates, 24 mods. Currency and shop dropped in favour of the lives card. |
| 5b | Room types | Stage variety: moving formations (sweep, invader march, rotate, sine) and the line where they cost a life, new brick types (explosive, regenerating; multi-hit and indestructible already exist), and distinct room kinds a sector mixes (standard, formation, elite). **Done:** 16 standard, 8 formation and 6 elite templates. |
| 5c | Boss rooms | A boss at the end of each sector: built from bricks and formations, with a core and HP bar, turrets, spawners and phantoms, phases as it takes damage, and a boss cache on kill. **Done:** 3 bosses, 4 boss bricks, room editor and validator support. |
| 6 | Scores & settings | Local high-score table, 6-char name entry, settings, quality presets. **Done so far:** score table, name entry, settings. Quality presets remain. |
| 7 | Polish | Parallax background, music-reactive visuals, attract mode. |
| 8 | Online | Worker + D1 leaderboard, rate limiting, optional Turnstile / replay validation; VPS move. |

## Open questions

- Roguelike details: whether run length (3 × 4) and +2 lives per pick hold up in play; boss HP and timing once played by hand.
- Number of music tracks and whether they have loop points.
- Daily-seed mode: yes/no.
