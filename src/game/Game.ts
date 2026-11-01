import { BALL, BRICK, FIELD, PADDLE, RULES, SCORE, SIM } from '../config/game';
import { ANCHOR_DROP, DRAFT, MODS, PRICES, type GrantTrigger } from '../config/mods';
import { BOSS_ROOM, ELITE, ROOM_CREDITS, TIME_BONUS } from '../config/run';
import { BOSS, BRICK_TYPES, FOCUS, FORMATION, PINBALL, POWER, STAGE_EVENTS } from '../config/tuning';
import { EventBus } from '../core/events';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { assembleRun, buildStage, extraRoom } from '../levels/assemble';
import { TEMPLATES, type StageDef, type StageTemplate } from '../levels/stages';
import { BossFight } from './boss';
import { sweepBox, sweepCircle, type SweepHit } from './collision';
import type { GameEvents, WallSide } from './events';
import { buildFormations, type Formation } from './formation';
import { parseLayout } from './layout';
import { epicChance, MOD_GRANTS, MOD_KINDS, powerSeconds, rollMods, splitInto } from './mods';
import { aim, closer, normalizeVelocity, pushOut, sweepWalls } from './physics';
import { GOOD_POWERS, POWER_KINDS, rollPower, TIMED_POWERS } from './powers';
import { StageEventTracker } from './stageEvents';
import type {
  Ball,
  Bolt,
  Brick,
  Capsule,
  EmitterKind,
  ExplosionSource,
  GameState,
  HitSource,
  ModKind,
  Paddle,
  Portal,
  PowerDef,
  PowerKind,
  ShadowBall,
  Shot,
  StageEventDef,
  StageEventKind,
  Target,
  TickInput,
  TimedPower,
} from './types';

/** Keeps the mod offers' random stream apart from the stage's. */
const OFFER_SALT = 0x9e3779b9;
/** Keeps the rollback mod's rooms' random stream apart from the others. */
const ROOM_SALT = 0x2545f491;

/** Distance a ball is pushed off a surface after a bounce, so the next sweep starts outside it. */
const SKIN = 0.01;
/** How far along the paddle a caught ball can stick, as a share of its half width. */
const CATCH_EDGE = 0.9;
/** Bounces resolved per ball per tick; leftover motion is dropped (only matters in tight corners). */
const MAX_BOUNCES = 4;
/** Powers that change how fast balls fly. */
const SPEED_POWERS: readonly PowerKind[] = ['slow', 'fast', 'pierce'];

/** Each explosion's size before mods; everything else about them is the same (see `Game.explode`). */
const EXPLOSIONS: Record<ExplosionSource, { radius: number; damage: number }> = {
  charge: POWER.detonator,
  brick: BRICK_TYPES.explosive,
};

type HitTarget = Brick | Target | WallSide | 'paddle' | 'barrier';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A broken explosive brick waiting to go off. */
interface Fuse {
  x: number;
  y: number;
  /** Tick it goes off. */
  tick: number;
}

/**
 * Pure simulation. Must not touch three.js, the DOM or Math.random.
 * Advanced by `update` at a fixed rate; everything observable goes out through `events`.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly paddle: Paddle = {
    x: FIELD.width / 2,
    px: FIELD.width / 2,
    y: PADDLE.y,
    w: PADDLE.width,
    h: PADDLE.height,
  };
  balls: Ball[] = [];
  bricks: Brick[] = [];
  targets: Target[] = [];
  portals: Portal[] = [];
  capsules: Capsule[] = [];
  bolts: Bolt[] = [];
  shots: Shot[] = [];
  shadows: ShadowBall[] = [];
  /** The moving groups of bricks in this stage; any other brick stands still. */
  formations: Formation[] = [];
  /** Set in boss rooms. */
  fight: BossFight | null = null;
  /** Seconds the paddle can't move for yet. */
  stun = 0;
  /** Real seconds of focus left; 0 is off. */
  focusLeft = 0;
  /** Real seconds until focus can be used again. */
  focusCooldown = 0;
  /** The run's stages, assembled from the seed; the rollback mod adds to them. */
  readonly stages: StageDef[];
  /** Stacks held of each mod; mods last the whole run. */
  readonly mods = Object.fromEntries(MOD_KINDS.map((k) => [k, 0])) as Record<ModKind, number>;
  /** The pick's mod offers, while drafting. */
  offers: ModKind[] = [];
  /** The offers already bought; their cards stay in place. */
  readonly bought = new Set<ModKind>();
  /** What the pick has to spend; rooms pay them and what isn't spent carries over. */
  credits = 0;
  /** Seconds left on each timed power; 0 is off. */
  readonly timers = Object.fromEntries(TIMED_POWERS.map((k) => [k, 0])) as Record<TimedPower, number>;
  state: GameState = 'serve';
  /** Seconds since `state` last changed. */
  stateTime = 0;
  stageIndex = 0;
  score = 0;
  lives: number = RULES.lives;
  tick = 0;
  /** Position in `PINBALL.multipliers`; a target bank or a flawless room moves it up, `loseMultiplier` down. */
  multiplierStep = 0;
  /** No life lost and no second wind used in this room yet; clearing it so moves the multiplier up. */
  flawless = true;
  /** The serve being waited on follows a formation reaching the line. */
  breached = false;
  /** Seconds of play left on this room's time limit; the time bonus needs some left at the clear. */
  timeLeft = 0;

  private rng: Rng;
  /** Mod offers, so in-stage play doesn't shift them. */
  private offerRng: Rng;
  /** Rooms added by the rollback mod. */
  private roomRng: Rng;
  private nextId = 1;
  private breakableLeft = 0;
  private laserCooldown = 0;
  /** Seconds of play since a breakable brick was last hit / destroyed. */
  private sinceHit = 0;
  private sinceKill = 0;
  private readonly stageEvents = new StageEventTracker();
  /** The next launch is the stage's first (for the multi start mod). */
  private openingServe = false;
  /** Second wind mod uses spent this stage. */
  private secondWinds = 0;
  private fuses: Fuse[] = [];
  /** Keyboard direction last tick, and seconds it has been held. */
  private keyAxis = 0;
  private keyHeld = 0;
  /** Reused by `paddleBox`. */
  private readonly box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(readonly seed: number) {
    this.stages = assembleRun(seed);
    if (this.stages.length === 0) throw new Error('Game needs at least one stage');
    this.rng = new Rng(seed);
    this.offerRng = new Rng(seed ^ OFFER_SALT);
    this.roomRng = new Rng(seed ^ ROOM_SALT);
  }

  get stage(): StageDef {
    const stage = this.stages[this.stageIndex];
    if (!stage) throw new Error(`No stage ${this.stageIndex}`);
    return stage;
  }

  /** Rooms of the run still to clear, this one included, so it drops as the pick opens. The sun sets by this. */
  get roomsLeft(): number {
    const cleared = this.state === 'draft' || this.state === 'complete' ? 1 : 0;
    return this.stages.length - this.stageIndex - cleared;
  }

  /** Score multiplier for brick points. */
  get multiplier(): number {
    const steps = PINBALL.multipliers;
    const base = steps[Math.min(this.multiplierStep, steps.length - 1)] ?? 1;
    // The amplifier mod only adds once the multiplier is lit.
    return this.multiplierStep > 0 ? base + this.modValue('amplifier') : base;
  }

  /** Real seconds a full focus lasts, with the time dilation mod. */
  get focusDuration(): number {
    return FOCUS.duration + this.modValue('dilation');
  }

  /** Real seconds before focus can be used again, with the quick recovery mod. */
  get focusRest(): number {
    return FOCUS.cooldown - this.modValue('recovery');
  }

  /** Seconds of simulated time since the run started. */
  get time(): number {
    return this.tick / SIM.tickRate;
  }

  /** Bonus for the `chain`-th brick of a chain (before the multiplier), with the chain link mod. */
  chainBonus(chain: number): number {
    return Math.round(chainBonus(chain) * (1 + this.modValue('chainlink')));
  }

  /** How close marching formations are to the line, 0..1; null when this stage has no line. */
  get linePressure(): number | null {
    const marching = this.formations.filter((f) => f.descends);
    const sending = this.bricks.some((br) => br.falling || br.kind === 'spawner');
    if (marching.length === 0 && !sending) return null;
    let lowest = Infinity;
    for (const f of marching) lowest = Math.min(lowest, f.lowest);
    for (const br of this.bricks) if (br.falling) lowest = Math.min(lowest, br.y);
    return clamp(1 - (lowest - FORMATION.line) / FORMATION.warning, 0, 1);
  }

  start(): void {
    this.events.emit('runStart', { seed: this.seed });
    this.loadStage(0);
  }

  update(dt: number, input: TickInput): void {
    this.tick++;
    this.stateTime += dt;
    this.paddle.px = this.paddle.x;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
    }
    for (const c of this.capsules) c.py = c.y;
    for (const bolt of this.bolts) bolt.py = bolt.y;
    for (const moving of [...this.bricks, ...this.shots, ...this.shadows]) {
      moving.px = moving.x;
      moving.py = moving.y;
    }

    switch (this.state) {
      case 'serve':
        this.movePaddle(dt, input);
        this.holdBalls();
        for (const f of this.formations) f.settle(dt);
        if (input.launch) this.launch();
        break;
      case 'play': {
        this.tickFocus(dt, input);
        // Everything but the paddle runs on world time, so focus slows it all alike; the paddle has its own pace.
        const world = this.focusLeft > 0 ? dt * FOCUS.scale : dt;
        this.tickRoomTime(world);
        this.movePaddle(dt, input);
        this.tickPowers(world);
        this.handleButtons(world, input);
        this.updateFormations(world);
        this.moveFallers(world);
        this.fight?.update(world, this.bricks, (kind, br) => this.emitterActs(kind, br));
        this.updateBalls(world);
        this.updateShadows(world);
        this.updateBolts(world);
        this.updateShots(world);
        this.updateCapsules(world);
        this.burnFuses(this.tick);
        this.healBricks();
        this.resolveStage();
        if (this.state === 'play') this.checkStageEvents(world);
        break;
      }
      case 'clear':
        if (this.stateTime >= RULES.stageClearDelay) this.afterStage();
        break;
      // Waiting for the player's choices (buyMod / buyLives / endDraft).
      case 'draft':
      case 'over':
      case 'complete':
        break;
    }
  }

  isActive(kind: TimedPower): boolean {
    return this.timers[kind] > 0;
  }

  /**
   * Applies a power as if its capsule was caught. `amount` is what mods and stage events grant
   * instead of the capsule's: seconds, or charges for the detonator. Public so the dev console can
   * grant powers (`vnx.game.applyPower('laser')`).
   */
  applyPower(kind: PowerKind, amount?: number): void {
    switch (kind) {
      case 'multi':
        this.splitBalls();
        return;
      case 'life':
        this.lives = Math.min(POWER.maxLives, this.lives + 1);
        return;
      case 'detonator':
        this.chargeBalls(amount ?? POWER.kinds.detonator.charges);
        return;
    }
    const { duration, opposite }: PowerDef = POWER.kinds[kind];
    if (opposite && this.isActive(opposite)) this.endPower(opposite);
    this.timers[kind] = Math.max(this.timers[kind], powerSeconds(kind, amount ?? duration, this.mods));
    if (SPEED_POWERS.includes(kind)) this.rescaleBalls();
  }

  /**
   * Runs a stage event's effect right away, skipping its trigger and chance. Public so the dev
   * console can try them (`vnx.game.fireStageEvent('overload')`).
   */
  fireStageEvent(kind: StageEventKind): void {
    const spareLast = !this.fight && !this.pulseFinishes;
    this.stageEvents.fired(kind);
    this.events.emit('stageEvent', { kind, bricks: this.breakableLeft });
    const { power, duration }: StageEventDef = STAGE_EVENTS.kinds[kind];
    if (power) this.applyPower(power, duration);
    switch (kind) {
      case 'supplyDrop': {
        const bricks = this.bricks.filter(isBreakable);
        const br = bricks[Math.floor(this.rng.next() * bricks.length)];
        if (br) this.dropCapsule(rollPower(this.rng, GOOD_POWERS), br.x + br.w / 2, br.y + br.h / 2);
        break;
      }
      case 'pulse': {
        const { maxBricks, damage } = STAGE_EVENTS.kinds.pulse;
        this.pulseBricks(Math.min(maxBricks, this.breakableLeft - (spareLast ? 1 : 0)), damage);
        break;
      }
    }
  }

  /**
   * Where a falling ball goes from here: the points it turns at, ending where it reaches the
   * paddle's height. Empty for a caught ball, which is there already. Null if it won't get
   * there (see `FOCUS`). Bounces as `moveBall` does.
   */
  ballPath(b: Ball): { x: number; y: number }[] | null {
    if (b.stuck !== null) return [];
    if (b.vy >= 0) return null;
    const floor = this.restY(b.r);
    const speed = Math.hypot(b.vx, b.vy);
    const probe = { x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy };
    const path: { x: number; y: number }[] = [];
    for (let i = 0; i < FOCUS.aimBounces; i++) {
      if (probe.y <= floor) return null;
      // Each leg runs down to the paddle's height unless something gets in the way.
      const reach = (floor - probe.y) / probe.vy;
      const dx = probe.vx * reach;
      const dy = probe.vy * reach;

      const { hit, round, portal } = this.firstContact(probe, dx, dy, b.inPortal);
      if (portal) return null;
      if (!hit) {
        path.push({ x: probe.x + dx, y: floor });
        return path;
      }
      probe.x += dx * hit.t + hit.nx * SKIN;
      probe.y += dy * hit.t + hit.ny * SKIN;
      path.push({ x: probe.x, y: probe.y });
      if (round) {
        const dot = probe.vx * hit.nx + probe.vy * hit.ny;
        probe.vx -= 2 * dot * hit.nx;
        probe.vy -= 2 * dot * hit.ny;
      } else {
        if (hit.nx !== 0) probe.vx = Math.abs(probe.vx) * hit.nx;
        if (hit.ny !== 0) probe.vy = Math.abs(probe.vy) * hit.ny;
      }
      normalizeVelocity(probe, speed);
      if (probe.vy >= 0) return null;
    }
    return null;
  }

  /**
   * Where a ball arriving at `landing` (the end of its `ballPath`) first hits something after
   * leaving the paddle as it stands now, bounced or, with catch, released from where it sticks.
   * Null if the paddle would miss it.
   */
  reboundEnd(b: Ball, landing: { x: number; y: number }): { x: number; y: number } | null {
    const p = this.paddle;
    if (b.stuck === null && Math.abs(landing.x - p.x) >= p.w / 2 + b.r) return null;
    const edge = this.isActive('catch') ? CATCH_EDGE : 1;
    const offset = b.stuck ?? clamp((landing.x - p.x) / (p.w / 2), -edge, edge);
    const probe = { x: landing.x, y: landing.y, r: b.r, vx: 0, vy: 0 };
    aim(probe, offset * BALL.maxBounceAngle, Math.hypot(FIELD.width, FIELD.height));
    const { hit } = this.firstContact(probe, probe.vx, probe.vy, null);
    return hit && { x: probe.x + probe.vx * hit.t, y: probe.y + probe.vy * hit.t };
  }

  /** What a ball moving by (dx, dy) reaches first, as `moveBall` sees it, for the aim line. `portal`: that's a portal. */
  private firstContact(ball: Pick<Ball, 'x' | 'y' | 'r'>, dx: number, dy: number, inPortal: number | null): { hit: SweepHit | null; round: boolean; portal: boolean } {
    const { x, y, r } = ball;
    let hit: SweepHit | null = sweepWalls(ball, dx, dy);
    let round = false;
    let portal = false;
    for (const br of this.bricks) {
      if (!br.alive || this.pierces(br)) continue;
      const h = sweepBox(x, y, dx, dy, br.x - r, br.y - r, br.x + br.w + r, br.y + br.h + r);
      if (closer(h, hit)) hit = h;
    }
    for (const tg of this.targets) {
      const h = sweepCircle(x, y, dx, dy, tg.x, tg.y, tg.r + r);
      if (closer(h, hit)) {
        hit = h;
        round = true;
      }
    }
    const capture = this.fight ? BOSS.portalCapture : PINBALL.portal.capture;
    for (const p of this.portals) {
      if (p.id === inPortal) continue;
      const h = sweepCircle(x, y, dx, dy, p.x, p.y, capture);
      if (closer(h, hit)) {
        hit = h;
        portal = true;
      }
    }
    return { hit, round, portal };
  }

  /**
   * Adds a stack of a mod. Public so the dev console can grant mods (`vnx.game.applyMod('heavy')`);
   * in play it comes from the pick between stages.
   */
  applyMod(kind: ModKind): void {
    if (this.mods[kind] >= MODS[kind].maxStacks) return;
    this.mods[kind]++;
    if (kind === 'rollback') this.rollBack();
  }

  /** The rollback mod: a new room next, under this room's number, so the rooms after it keep theirs. */
  private rollBack(): void {
    this.stages.splice(this.stageIndex + 1, 0, extraRoom(this.roomRng, this.stages, this.stage.number - 1));
  }

  /**
   * Swaps the current stage for the template of that name and restarts it. Public so the dev
   * console can try rooms (`vnx.game.tryStage('PINWHEEL')`).
   */
  tryStage(name: string): void {
    const template = TEMPLATES.find((t) => t.name === name);
    if (!template) throw new Error(`No stage template '${name}'`);
    this.tryTemplate(template);
  }

  /** As `tryStage`, for any template. The room editor's Play button comes through here. */
  tryTemplate(template: StageTemplate): void {
    this.stages[this.stageIndex] = buildStage(template, this.stage.number - 1, false);
    this.loadStage(this.stageIndex);
  }

  /*
   * Between stages. The UI calls these with the player's choice; each returns whether it was
   * allowed. (Recorded with their tick, they replay like the per-tick input.)
   */

  /** Whether offer `index` is still there and affordable. */
  canBuyMod(index: number): boolean {
    const kind = this.offers[index];
    return this.state === 'draft' && !!kind && !this.bought.has(kind) && this.credits >= PRICES[MODS[kind].rarity];
  }

  /** Buys offer `index` of the pick; the pick stays open. */
  buyMod(index: number): boolean {
    const kind = this.offers[index];
    if (!kind || !this.canBuyMod(index)) return false;
    this.credits -= PRICES[MODS[kind].rarity];
    this.bought.add(kind);
    this.applyMod(kind);
    this.events.emit('modBuy', { kind, stacks: this.mods[kind], credits: this.credits });
    return true;
  }

  /** Whether extra lives are affordable and would add any (lives are capped). */
  get canBuyLives(): boolean {
    return this.state === 'draft' && this.credits >= DRAFT.livesCost && this.lives < POWER.maxLives;
  }

  /** Buys extra lives; the pick stays open. */
  buyLives(): boolean {
    if (!this.canBuyLives) return false;
    const before = this.lives;
    this.credits -= DRAFT.livesCost;
    this.lives = Math.min(POWER.maxLives, this.lives + DRAFT.lives);
    this.events.emit('livesBuy', { gained: this.lives - before, lives: this.lives, credits: this.credits });
    return true;
  }

  /** Closes the pick and moves on to the next stage. */
  endDraft(): boolean {
    if (this.state !== 'draft') return false;
    this.afterDraft();
    return true;
  }

  private setState(state: GameState): void {
    this.state = state;
    this.stateTime = 0;
  }

  private loadStage(index: number): void {
    this.stageIndex = index;
    const stage = this.stage;
    ({ bricks: this.bricks, targets: this.targets, portals: this.portals } = parseLayout(stage.layout, () => this.nextId++, stage.boss?.hp));
    this.formations = buildFormations(stage.formations, this.bricks, stage.formationPace);
    const core = this.bricks.find((br) => br.kind === 'core');
    this.fight = stage.boss && core ? new BossFight(stage.boss, core) : null;
    this.paceFormations();
    this.breakableLeft = this.bricks.filter(isBreakable).length;
    this.breached = false;
    this.paddle.x = this.paddle.px = FIELD.width / 2;
    this.paddle.w = this.paddleWidth();
    this.keyHeld = 0;
    this.stageEvents.reset();
    this.secondWinds = 0;
    this.flawless = true;
    this.timeLeft = stage.timeLimit;
    this.events.emit('stageStart', {
      stage: stage.number,
      name: stage.name,
      room: stage.room,
      bricks: this.breakableLeft,
    });
    this.serve();
    this.openingServe = true;
    // After the serve has cleared the powers.
    this.grantMods('stageStart');
  }

  /** Credits clearing this room pays, time bonus included; none for the last, with no pick after it. */
  get roomCredits(): number {
    if (this.stageIndex + 1 >= this.stages.length) return 0;
    return ROOM_CREDITS[this.stage.room] + this.modValue('salvage') + (this.timeLeft > 0 ? TIME_BONUS.credits : 0);
  }

  /** Stage cleared: the run ends after the last one; otherwise it pays and the pick opens. */
  private afterStage(): void {
    if (this.stageIndex + 1 >= this.stages.length) {
      this.setState('complete');
      this.events.emit('runComplete', { score: this.score });
      return;
    }
    this.credits += this.roomCredits;
    this.offers = rollMods(this.offerRng, this.mods, epicChance(this.stage.room, this.stage.number));
    // Every mod maxed and lives full: nothing to choose.
    if (this.offers.length === 0 && this.lives >= POWER.maxLives) {
      this.afterDraft();
      return;
    }
    this.setState('draft');
    this.events.emit('draftOpen', { stage: this.stage.number, offers: this.offers.slice(), credits: this.credits });
  }

  private afterDraft(): void {
    this.offers = [];
    this.bought.clear();
    this.loadStage(this.stageIndex + 1);
  }

  /** A mod's total effect at the stacks held: its `perStack` times the stacks. */
  private modValue(kind: ModKind): number {
    return MODS[kind].perStack * this.mods[kind];
  }

  /** Grants what the mods held give on `on`. */
  private grantMods(on: GrantTrigger): void {
    for (const g of MOD_GRANTS) if (g.on === on && this.mods[g.kind] > 0) this.applyPower(g.power, this.modValue(g.kind));
  }

  private paddleWidth(): number {
    return PADDLE.width * (1 + this.modValue('wide'));
  }

  /**
   * New ball resting on the paddle, waiting for launch. Powers don't survive a lost life;
   * `keepPowers` (second wind) leaves them running.
   */
  private serve(keepPowers = false): void {
    this.balls = [];
    this.fuses = [];
    this.clearThreats();
    if (!keepPowers) this.clearPowers();
    const x = this.paddle.x;
    const y = this.restY(BALL.radius);
    const speed = BALL.baseSpeed + (this.stage.number - 1) * BALL.stageSpeedStep + (this.stage.room === 'elite' ? ELITE.speedBonus : 0);
    const ball: Ball = {
      id: this.nextId++,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      r: BALL.radius,
      speed: speed * (1 - this.modValue('dampener')),
      stuck: null,
      stuckTime: 0,
      chain: 0,
      chainPoints: 0,
      inPortal: null,
      charges: 0,
    };
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x, y });
    this.sinceHit = this.sinceKill = 0;
    this.stageEvents.arm('safetyNet');
    if (!this.fight) this.stageEvents.refund(STAGE_EVENTS.perBalls);
    this.setState('serve');
  }

  /** Height of a ball of radius `r` resting on the paddle. */
  private restY(r: number): number {
    return this.paddle.y + this.paddle.h / 2 + r + SKIN;
  }

  private holdBalls(): void {
    for (const b of this.balls) {
      b.x = this.paddle.x;
      b.y = this.restY(b.r);
    }
  }

  private launch(): void {
    for (const b of this.balls) this.launchBall(b, this.rng.range(-BALL.serveJitter, BALL.serveJitter));
    this.grantMods('launch');
    if (this.openingServe) this.grantMods('firstLaunch');
    this.openingServe = false;
    this.breached = false;
    this.setState('play');
    const net = STAGE_EVENTS.kinds.safetyNet;
    if (this.lives <= net.lives && this.breakableLeft <= net.bricksLeft) this.tryStageEvent('safetyNet');
  }

  private launchBall(b: Ball, angle: number): void {
    aim(b, angle, this.ballSpeed(b));
    this.events.emit('ballLaunch', { id: b.id, angle: (angle * 180) / Math.PI });
  }

  /** Runs the room's clock down; running out loses the time bonus and nothing else. */
  private tickRoomTime(dt: number): void {
    if (this.timeLeft === 0) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft === 0) this.events.emit('timeUp', { stage: this.stage.number });
  }

  /** Runs every play tick, after the stage was resolved. Triggers for the ongoing events. */
  private checkStageEvents(dt: number): void {
    this.sinceHit += dt;
    this.sinceKill += dt;
    this.stageEvents.tick(dt);
    const { supplyDrop, overload, pulse, hunter, demolition } = STAGE_EVENTS.kinds;
    const left = this.breakableLeft;
    const boss = this.fight !== null;
    if (left <= supplyDrop.bricksLeft) this.tryLateEvent('supplyDrop');
    if (left <= demolition.bricksLeft) this.tryLateEvent('demolition');
    if (left <= overload.bricksLeft) this.tryLateEvent('overload');
    if (left <= hunter.bricksLeft && (!boss || this.sinceKill >= STAGE_EVENTS.bossHunterIdle)) this.tryLateEvent('hunter');
    if (this.sinceHit >= pulse.idleTime && (boss || (left > 1 && this.stageEvents.rested))) this.tryStageEvent('pulse');
    if (this.pulseFinishes && left <= pulse.maxBricks && this.stageEvents.rested) this.fireStageEvent('pulse');
  }

  /** Trigger met: roll the event's chance once, then wait for it to re-arm. */
  private tryStageEvent(kind: StageEventKind): void {
    if (this.stageEvents.roll(kind, this.rng)) this.fireStageEvent(kind);
  }

  /** As `tryStageEvent`, for a brick-count event: it has to wait its turn, bar in a boss room. */
  private tryLateEvent(kind: StageEventKind): void {
    const ready = this.fight
      ? this.stageEvents.firings(kind) === 0
      : this.stageEvents.rested && this.stageEvents.stalled(kind, this.sinceKill);
    if (ready) this.tryStageEvent(kind);
  }

  /** The stage has stalled for so long that a pulse may take its last brick; never in a boss room. */
  private get pulseFinishes(): boolean {
    return !this.fight && this.stageEvents.quiet('pulse', this.sinceKill) >= STAGE_EVENTS.kinds.pulse.finishAfter;
  }

  private movePaddle(dt: number, input: TickInput): void {
    const p = this.paddle;
    const scale = this.isActive('expand') ? POWER.expandScale : this.isActive('narrow') ? POWER.narrowScale : 1;
    const target = this.paddleWidth() * scale;
    p.w += (target - p.w) * Math.min(1, POWER.widthRate * dt);
    if (Math.abs(target - p.w) < 0.01) p.w = target;
    this.stun = Math.max(0, this.stun - dt);
    // Stunned, only the width still changes (the clamp keeps a growing paddle inside the walls),
    // and a held key starts its ramp over, so the paddle doesn't shoot off when it wakes.
    if (this.stun > 0) this.keyHeld = 0;
    const travel = this.stun > 0 ? 0 : input.dx + this.keyTravel(dt, input.axis);
    const pace = this.focusLeft > 0 ? FOCUS.paddleScale : 1;
    p.x = clamp(p.x + travel * pace, p.w / 2, FIELD.width - p.w / 2);
  }

  /** Keyboard travel this tick. Any change of direction restarts the ramp; letting go stops dead. */
  private keyTravel(dt: number, axis: number): number {
    if (axis !== this.keyAxis) this.keyHeld = 0;
    this.keyAxis = axis;
    const speed = lerp(PADDLE.keyStartSpeed, PADDLE.keySpeed, Math.min(1, this.keyHeld / PADDLE.keyRamp));
    this.keyHeld += dt;
    return axis * speed * dt;
  }

  private updateBalls(dt: number): void {
    for (const b of this.balls) {
      if (b.stuck !== null) this.holdCaught(b, dt);
      else this.moveBall(b, dt);
    }
  }

  private updateFormations(dt: number): void {
    if (this.formations.length === 0) return;
    for (const f of this.formations) {
      if (!f.update(dt)) continue;
      this.events.emit('formationStep', { dropped: f.dropping });
    }
    for (const b of this.balls) {
      if (b.stuck !== null) continue;
      for (const f of this.formations) {
        for (const br of f.bricks) if (br.alive) this.shoveBall(b, br);
      }
    }
  }

  /** Falling bricks come down like formations do, ahead of the balls; `resolveStage` checks the line. */
  private moveFallers(dt: number): void {
    for (const br of this.bricks) {
      if (!br.falling || !br.alive) continue;
      br.y -= BOSS.faller.speed * dt;
      for (const b of this.balls) if (b.stuck === null) this.shoveBall(b, br);
    }
  }

  private emitterActs(kind: EmitterKind, br: Brick): void {
    if (kind === 'turret') this.fireTurret(br);
    else if (kind === 'spawner') this.spawnFaller(br);
    else this.releaseShadow(br);
  }

  private fireTurret(br: Brick): void {
    const pattern = this.fight?.phase.fire ?? 'straight';
    const x = br.x + br.w / 2;
    const y = br.y;
    const down = -Math.PI / 2;
    const headings = pattern === 'fan' ? [down - BOSS.shot.fan, down, down + BOSS.shot.fan] : [pattern === 'aimed' ? Math.atan2(this.paddle.y - y, this.paddle.x - x) : down];
    for (const angle of headings) {
      const vx = Math.cos(angle) * BOSS.shot.speed;
      const vy = Math.sin(angle) * BOSS.shot.speed;
      this.shots.push({ id: this.nextId++, x, y, px: x, py: y, vx, vy });
    }
    this.events.emit('shotFired', { x, y, pattern, count: headings.length });
  }

  private spawnFaller(from: Brick): void {
    if (this.bricks.filter((br) => br.falling).length >= BOSS.faller.max) return;
    const x = from.x;
    const y = from.y - BRICK.height;
    const brick: Brick = {
      ...from,
      id: this.nextId++,
      x,
      y,
      px: x,
      py: y,
      w: BRICK.width,
      h: BRICK.height,
      kind: 'normal',
      hp: 1,
      maxHp: 1,
      hitTick: -Infinity,
      falling: true,
      charge: 0,
    };
    this.bricks.push(brick);
    this.events.emit('brickSpawn', { id: brick.id, x: x + brick.w / 2, y: y + brick.h / 2 });
  }

  private releaseShadow(from: Brick): void {
    if (this.shadows.length >= BOSS.shadow.max) return;
    const x = from.x + from.w / 2;
    const y = from.y - BALL.radius;
    const shadow: ShadowBall = { id: this.nextId++, x, y, px: x, py: y, vx: 0, vy: 0, r: BALL.radius, life: BOSS.shadow.life };
    // At the speed of the real thing, so speed doesn't give it away.
    const speed = this.balls[0]?.speed ?? BALL.baseSpeed;
    aim(shadow, Math.PI + this.rng.range(-BOSS.shadow.spread, BOSS.shadow.spread), speed);
    this.shadows.push(shadow);
    this.events.emit('shadowSpawn', { id: shadow.id, x, y });
  }

  private updateShadows(dt: number): void {
    this.shadows = this.shadows.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      this.moveShadow(s, dt);
      return s.y >= RULES.lostBallY;
    });
  }

  /** As `moveBall` with every rule taken out: it bounces off walls, bricks and the paddle, and that's all. */
  private moveShadow(s: ShadowBall, dt: number): void {
    const speed = Math.hypot(s.vx, s.vy);
    let remaining = 1;
    for (let i = 0; i < MAX_BOUNCES && remaining > 0; i++) {
      const dx = s.vx * dt * remaining;
      const dy = s.vy * dt * remaining;
      let hit: SweepHit | null = sweepWalls(s, dx, dy);
      for (const br of this.bricks) {
        if (!br.alive) continue;
        const h = sweepBox(s.x, s.y, dx, dy, br.x - s.r, br.y - s.r, br.x + br.w + s.r, br.y + br.h + s.r);
        if (closer(h, hit)) hit = h;
      }
      let onPaddle = false;
      if (s.vy < 0) {
        const box = this.paddleBox(s.r);
        const h = sweepBox(s.x, s.y, dx, dy, box.minX, box.minY, box.maxX, box.maxY);
        if (closer(h, hit)) {
          hit = h;
          onPaddle = h.ny > 0;
        }
      }
      if (!hit) {
        s.x += dx;
        s.y += dy;
        return;
      }
      s.x += dx * hit.t + hit.nx * SKIN;
      s.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      if (hit.nx !== 0) s.vx = Math.abs(s.vx) * hit.nx;
      if (hit.ny !== 0) s.vy = Math.abs(s.vy) * hit.ny;
      if (onPaddle) aim(s, (clamp((s.x - this.paddle.x) / (this.paddle.w / 2), -1, 1)) * BALL.maxBounceAngle, speed);
      normalizeVelocity(s, speed);
    }
  }

  /** Shots fly through the bricks; the only thing they can hit is the paddle. */
  private updateShots(dt: number): void {
    const p = this.paddle;
    const { radius } = BOSS.shot;
    this.shots = this.shots.filter((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (Math.abs(s.x - p.x) < p.w / 2 + radius && Math.abs(s.y - p.y) < p.h / 2 + radius) {
        this.stun = BOSS.stun;
        this.events.emit('paddleStun', { x: p.x, seconds: BOSS.stun });
        return false;
      }
      return s.y >= -radius && s.x >= -radius && s.x <= FIELD.width + radius;
    });
  }

  /** Each serve starts clean: what a boss sent out goes, and the paddle can move. */
  private clearThreats(): void {
    this.shots = [];
    this.shadows = [];
    this.stun = 0;
    this.focusLeft = this.focusCooldown = 0;
    if (this.bricks.some((br) => br.falling)) this.bricks = this.bricks.filter((br) => !br.falling);
  }

  private paceFormations(): void {
    const pace = this.fight?.phase.pace ?? 1;
    for (const f of this.formations) f.boost = pace;
  }

  /** The core takes the hit, up to the phase's threshold; reaching that starts the next phase or ends the fight. */
  private hitCore(core: Brick, by: HitSource, ix: number, iy: number): void {
    const fight = this.fight;
    const x = core.x + core.w / 2;
    const y = core.y + core.h / 2;
    if (!fight || fight.shielded) {
      this.events.emit('brickHit', { id: core.id, kind: core.kind, hp: core.hp, by, x, y, ix, iy });
      return;
    }
    const floor = fight.floor;
    core.hp = Math.max(floor, core.hp - (by === 'laser' ? BOSS.laserDamage : 1));
    this.score += this.paid(SCORE.hit * this.multiplier, by);
    this.events.emit('brickHit', { id: core.id, kind: core.kind, hp: core.hp, by, x, y, ix, iy });
    if (core.hp > floor) return;
    if (core.hp > 0) this.nextPhase(fight);
    else this.killCore(core, x, y);
  }

  private nextPhase(fight: BossFight): void {
    fight.advance();
    this.paceFormations();
    this.ejectFromVault();
    this.events.emit('bossPhase', { phase: fight.phaseIndex + 1, phases: fight.def.phases.length, hp: fight.core.hp });
  }

  /** Balls in the vault go back out through the first portal outside it, heading down. */
  private ejectFromVault(): void {
    const vault = this.fight?.def.vault;
    if (!vault) return;
    const minX = vault.cols[0] * BRICK.width;
    const maxX = (vault.cols[1] + 1) * BRICK.width;
    const maxY = FIELD.height - BRICK.top - vault.rows[0] * BRICK.height;
    const minY = FIELD.height - BRICK.top - (vault.rows[1] + 1) * BRICK.height;
    const inside = (p: { x: number; y: number }): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const exit = this.portals.find((p) => !inside(p));
    if (!exit) return;
    for (const b of this.balls) {
      if (!inside(b)) continue;
      b.x = b.px = exit.x;
      b.y = b.py = exit.y;
      b.vy = -Math.abs(b.vy);
      b.inPortal = exit.id;
      this.events.emit('portalWarp', { id: b.id, from: exit.exit, to: exit.id, x: exit.x, y: exit.y });
    }
  }

  /** The core goes and the room goes with it; `resolveStage` picks up the win. */
  private killCore(core: Brick, x: number, y: number): void {
    core.alive = false;
    this.breakableLeft--;
    const multiplier = this.multiplier;
    this.events.emit('bossDown', { x, y });
    this.events.emit('brickDestroyed', { id: core.id, kind: core.kind, points: 0, chain: 0, bonus: 0, multiplier, by: 'explosion', x, y, ix: x, iy: y, vx: 0, vy: 0 });
    for (const br of this.bricks) {
      if (!br.alive) continue;
      br.alive = false;
      const cx = br.x + br.w / 2;
      const cy = br.y + br.h / 2;
      this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points: 0, chain: 0, bonus: 0, multiplier, by: 'explosion', x: cx, y: cy, ix: cx, iy: cy, vx: 0, vy: 0 });
    }
  }

  /**
   * Bricks move before the balls do, so one can land on a ball: the ball goes out the nearest side
   * and counts as hitting it. It leaves faster than a brick moves, or it would be caught again.
   */
  private shoveBall(b: Ball, br: Brick): void {
    const out = pushOut(b, br);
    if (!out) return;
    if (this.pierces(br)) {
      this.ballHitsBrick(br, b);
      return;
    }
    b.x += out.nx * (out.depth + SKIN);
    b.y += out.ny * (out.depth + SKIN);
    if (out.nx !== 0) b.vx = out.nx * Math.max(Math.abs(b.vx), FORMATION.shove);
    if (out.ny !== 0) b.vy = out.ny * Math.max(Math.abs(b.vy), FORMATION.shove);
    this.ballHitsBrick(br, b);
    normalizeVelocity(b, this.ballSpeed(b));
  }

  /** Sets off the fuses due by `tick`. */
  private burnFuses(tick: number): void {
    const due = this.fuses.filter((f) => f.tick <= tick);
    if (due.length === 0) return;
    this.fuses = this.fuses.filter((f) => f.tick > tick);
    for (const f of due) this.explode('brick', [f]);
  }

  /**
   * One explosion, going off at every centre at once: each breakable brick within reach of any of
   * them takes its damage once, struck from the nearest centre, and explosives among them light
   * their own fuses. Steel is unaffected, bar the steel breaker mod. Reach grows with the blast
   * radius mod; the cluster charge mod adds balls.
   */
  private explode(source: ExplosionSource, centres: readonly { x: number; y: number }[]): void {
    const { damage } = EXPLOSIONS[source];
    const radius = EXPLOSIONS[source].radius * (1 + this.modValue('blast'));
    const steelChance = this.modValue('steelbreak');
    const targets: { br: Brick; ix: number; iy: number }[] = [];
    for (const br of this.bricks) {
      if (!br.alive || (br.kind === 'steel' && steelChance === 0)) continue;
      let best: { br: Brick; ix: number; iy: number } | null = null;
      let bestD = radius * radius;
      for (const c of centres) {
        const ix = clamp(c.x, br.x, br.x + br.w);
        const iy = clamp(c.y, br.y, br.y + br.h);
        const d = (ix - c.x) ** 2 + (iy - c.y) ** 2;
        if (d <= bestD) {
          best = { br, ix, iy };
          bestD = d;
        }
      }
      // Steel breaker mod: steel in reach rolls once per explosion, however many centres reach it.
      if (best && (br.kind !== 'steel' || this.rng.next() < steelChance)) targets.push(best);
    }
    this.events.emit('explosion', { source, centres: centres.map(({ x, y }) => ({ x, y })), radius, bricks: targets.length });
    for (const { br, ix, iy } of targets) {
      if (br.kind === 'steel') this.breakSteel(br, ix, iy);
      else this.damageBrick(br, 'explosion', ix, iy, damage);
    }
    // Cluster charge mod: new balls split off the ball nearest the first centre, without its charges,
    // or explosions could keep making balls that explode.
    const src = centres[0] && this.nearestBall(centres[0].x, centres[0].y);
    for (let i = 0; src && i < this.modValue('cluster') && this.balls.length < POWER.maxBalls; i++) {
      const [dirX, dirY] = ballDirection(src);
      this.addTwin(src, dirX, dirY, (i % 2 === 0 ? 1 : -1) * POWER.splitAngle, 0);
    }
  }

  private nearestBall(x: number, y: number): Ball | null {
    let best: Ball | null = null;
    let bestD = Infinity;
    for (const b of this.balls) {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Regenerating bricks left alone long enough win back a hit. */
  private healBricks(): void {
    const delay = BRICK_TYPES.regen.delay * SIM.tickRate;
    for (const br of this.bricks) {
      if (br.kind !== 'regen' || !br.alive || br.hp >= br.maxHp) continue;
      if (this.tick - Math.max(br.hitTick, br.healTick) < delay) continue;
      br.hp++;
      br.healTick = this.tick;
      this.events.emit('brickHeal', { id: br.id, hp: br.hp });
    }
  }

  /** After everything moved: drop broken bricks, then check for a cleared stage or a lost life. */
  private resolveStage(): void {
    if (this.fight ? !this.fight.core.alive : this.breakableLeft === 0) {
      // Whatever is still burning has nothing left to break, but it should still be seen.
      this.burnFuses(Infinity);
      this.bricks = this.bricks.filter((br) => br.alive);
      const { room } = this.stage;
      const bonus = room === 'boss' ? BOSS_ROOM.clearBonus : room === 'elite' ? ELITE.clearBonus : 0;
      const timeBonus = this.timeLeft > 0 ? TIME_BONUS.score : 0;
      this.score += bonus + timeBonus;
      if (this.flawless) this.raiseMultiplier();
      this.balls = [];
      this.clearThreats();
      this.clearPowers();
      this.setState('clear');
      this.events.emit('stageClear', { stage: this.stage.number, score: this.score, bonus, timeBonus, flawless: this.flawless, multiplier: this.multiplier });
      return;
    }
    if (this.bricks.some((br) => !br.alive)) this.bricks = this.bricks.filter((br) => br.alive);

    // Ahead of the lost balls: this life is gone either way, and the formation must still turn back.
    if (this.formations.some((f) => f.breached) || this.bricks.some((br) => br.falling && br.y <= FORMATION.line)) {
      for (const f of this.formations) f.pushBack();
      this.events.emit('formationBreach', { lives: this.lives - 1 });
      this.breached = true;
      this.loseLife();
      return;
    }

    this.balls = this.balls.filter((b) => {
      if (b.y >= RULES.lostBallY) return true;
      this.events.emit('ballLost', { id: b.id });
      return false;
    });
    if (this.balls.length === 0) {
      if (this.secondWinds < this.modValue('secondwind')) {
        this.secondWinds++;
        this.loseMultiplier();
        this.events.emit('secondWind', { left: this.modValue('secondwind') - this.secondWinds });
        this.serve(true);
      } else this.loseLife();
    }
  }

  private loseLife(): void {
    this.lives--;
    this.loseMultiplier();
    this.events.emit('lifeLost', { lives: this.lives });
    if (this.lives > 0) {
      this.serve();
    } else {
      this.setState('over');
      this.events.emit('gameOver', { stage: this.stage.number, score: this.score });
    }
  }

  /** Moves a ball for one tick, resolving bounces in time order (swept, so nothing tunnels). */
  private moveBall(b: Ball, dt: number): void {
    this.rescueFromPaddle(b);
    if (b.stuck !== null) return;
    let remaining = 1;
    for (let i = 0; i < MAX_BOUNCES && remaining > 0; i++) {
      const dx = b.vx * dt * remaining;
      const dy = b.vy * dt * remaining;

      const wall = sweepWalls(b, dx, dy);
      let hit: SweepHit | null = wall;
      let target: HitTarget | null = wall ? wall.side : null;
      for (const br of this.bricks) {
        if (!br.alive) continue;
        const h = sweepBox(b.x, b.y, dx, dy, br.x - b.r, br.y - b.r, br.x + br.w + b.r, br.y + br.h + b.r);
        if (closer(h, hit)) {
          hit = h;
          target = br;
        }
      }
      for (const tg of this.targets) {
        const h = sweepCircle(b.x, b.y, dx, dy, tg.x, tg.y, tg.r + b.r);
        if (closer(h, hit)) {
          hit = h;
          target = tg;
        }
      }
      if (dy < 0 && this.isActive('barrier')) {
        const floor = POWER.barrierY + b.r;
        if (b.y >= floor) {
          const h = { t: (floor - b.y) / dy, nx: 0, ny: 1 };
          if (h.t <= 1 && closer(h, hit)) {
            hit = h;
            target = 'barrier';
          }
        }
      }
      if (b.vy < 0) {
        const box = this.paddleBox(b.r);
        const h = sweepBox(b.x, b.y, dx, dy, box.minX, box.minY, box.maxX, box.maxY);
        if (closer(h, hit)) {
          hit = h;
          target = 'paddle';
        }
      }

      if (!hit || !target) {
        b.x += dx;
        b.y += dy;
        break;
      }

      // Round targets reflect the ball about the contact normal.
      if (typeof target === 'object' && target.kind === 'target') {
        b.x += dx * hit.t + hit.nx * SKIN;
        b.y += dy * hit.t + hit.ny * SKIN;
        remaining *= 1 - hit.t;
        const dot = b.vx * hit.nx + b.vy * hit.ny;
        b.vx -= 2 * dot * hit.nx;
        b.vy -= 2 * dot * hit.ny;
        this.hitTarget(target, b);
        normalizeVelocity(b, this.ballSpeed(b));
        continue;
      }

      // Piercing balls go straight through what they break.
      if (typeof target === 'object' && this.pierces(target)) {
        b.x += dx * hit.t;
        b.y += dy * hit.t;
        remaining *= 1 - hit.t;
        this.ballHitsBrick(target, b);
        normalizeVelocity(b, this.ballSpeed(b));
        continue;
      }

      b.x += dx * hit.t + hit.nx * SKIN;
      b.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      // Before the bounce, so the brick's events carry the incoming velocity.
      if (typeof target === 'object') {
        this.ballHitsBrick(target, b);
        // Critical: a ball that broke the brick may carry on through where it stood.
        if (!target.alive && this.mods.crit > 0 && this.rng.next() < this.modValue('crit')) {
          this.events.emit('breakthrough', { id: b.id, brick: target.id });
          normalizeVelocity(b, this.ballSpeed(b));
          continue;
        }
      }
      if (hit.nx !== 0) b.vx = Math.abs(b.vx) * hit.nx;
      if (hit.ny !== 0) b.vy = Math.abs(b.vy) * hit.ny;

      if (target === 'paddle') {
        if (this.paddleContact(b, hit.ny > 0)) return;
      } else if (target === 'barrier') this.events.emit('barrierHit', { id: b.id, x: b.x });
      else if (typeof target === 'string') this.events.emit('wallHit', { id: b.id, side: target, x: b.x, y: b.y });
      normalizeVelocity(b, this.ballSpeed(b));
    }
    b.x = clamp(b.x, b.r, FIELD.width - b.r);
    b.y = Math.min(b.y, FIELD.height - b.r);
    this.checkPortals(b);
  }

  /** A ball that reaches a portal's centre comes out of the other end, moving the same way. */
  private checkPortals(b: Ball): void {
    if (b.inPortal !== null) {
      const from = this.portals.find((p) => p.id === b.inPortal);
      if (!from || (b.x - from.x) ** 2 + (b.y - from.y) ** 2 > from.r ** 2) b.inPortal = null;
      return;
    }
    const capture = (this.fight ? BOSS.portalCapture : PINBALL.portal.capture) ** 2;
    for (const p of this.portals) {
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 >= capture) continue;
      const exit = this.portals.find((q) => q.id === p.exit);
      if (!exit) return;
      // Jump, not travel: no interpolation across the field.
      b.x = b.px = exit.x;
      b.y = b.py = exit.y;
      b.inPortal = exit.id;
      p.warpTick = exit.warpTick = this.tick;
      this.events.emit('portalWarp', { id: b.id, from: p.id, to: exit.id, x: exit.x, y: exit.y });
      // Portal split mod: a second ball may come out alongside, angled off to one side.
      if (this.mods.portalsplit > 0 && this.balls.length < POWER.maxBalls && this.rng.next() < this.modValue('portalsplit')) {
        this.addTwin(b, b.vx, b.vy, POWER.splitAngle);
      }
      return;
    }
  }

  /** Lights the target; lighting the last one completes the bank. */
  private hitTarget(tg: Target, b: Ball): void {
    tg.hitTick = this.tick;
    const lit = !tg.lit;
    tg.lit = true;
    this.score += PINBALL.target.points;
    this.events.emit('targetHit', { id: tg.id, ball: b.id, lit, points: PINBALL.target.points, x: tg.x, y: tg.y });
    if (!lit || !this.targets.every((t) => t.lit)) return;
    for (const t of this.targets) {
      t.lit = false;
      t.hitTick = this.tick;
    }
    this.raiseMultiplier();
    this.score += PINBALL.bankBonus;
    this.events.emit('targetBank', { multiplier: this.multiplier, bonus: PINBALL.bankBonus });
  }

  private raiseMultiplier(): void {
    this.multiplierStep = Math.min(this.multiplierStep + 1, PINBALL.multipliers.length - 1);
  }

  /** A lost life or a second wind: the room stops being flawless, and without anchor the whole multiplier goes. */
  private loseMultiplier(): void {
    this.flawless = false;
    this.multiplierStep = Math.max(0, this.multiplierStep - (ANCHOR_DROP[this.mods.anchor - 1] ?? Infinity));
  }

  /** The paddle grown by `r` on every side. Returns a shared object, valid until the next call. */
  private paddleBox(r: number): Box {
    const p = this.paddle;
    const box = this.box;
    box.minX = p.x - p.w / 2 - r;
    box.minY = p.y - p.h / 2 - r;
    box.maxX = p.x + p.w / 2 + r;
    box.maxY = p.y + p.h / 2 + r;
    return box;
  }

  /** A fast paddle can move under a falling ball within one tick; bounce it instead of swallowing it. */
  private rescueFromPaddle(b: Ball): void {
    const box = this.paddleBox(b.r);
    if (b.vy < 0 && b.y > this.paddle.y && b.y < box.maxY && b.x > box.minX && b.x < box.maxX) {
      b.y = box.maxY + SKIN;
      this.paddleContact(b, true);
    }
  }

  /**
   * Top-face hits aim the ball by where it landed: centre goes straight up, edges go wide.
   * With catch active the ball sticks instead; returns true when it was caught.
   * Any touch ends the ball's chain.
   */
  private paddleContact(b: Ball, top: boolean): boolean {
    this.endChain(b);
    const p = this.paddle;
    const offset = clamp((b.x - p.x) / (p.w / 2), -1, 1);
    if (top && this.isActive('catch')) {
      b.stuck = clamp(offset, -CATCH_EDGE, CATCH_EDGE);
      b.stuckTime = 0;
      b.vx = b.vy = 0;
      this.holdCaught(b, 0);
      this.events.emit('ballCaught', { id: b.id, offset: b.stuck });
      return true;
    }
    if (top) aim(b, offset * BALL.maxBounceAngle, this.ballSpeed(b));
    this.events.emit('paddleHit', { id: b.id, offset });
    return false;
  }

  private endChain(b: Ball): void {
    if (b.chain >= 2) this.events.emit('chainEnd', { id: b.id, count: b.chain, total: b.chainPoints, multiplier: this.multiplier });
    b.chain = 0;
    b.chainPoints = 0;
  }

  /** Keeps a caught ball on the paddle; it lets go by itself after a while. */
  private holdCaught(b: Ball, dt: number): void {
    const p = this.paddle;
    b.stuckTime += dt;
    b.x = p.x + (b.stuck ?? 0) * (p.w / 2);
    b.y = this.restY(b.r);
    if (b.stuckTime >= POWER.catchHold) this.release(b);
  }

  private release(b: Ball): void {
    const angle = (b.stuck ?? 0) * BALL.maxBounceAngle;
    b.stuck = null;
    this.launchBall(b, angle);
  }

  /** Releases every caught ball; returns whether there were any. */
  private releaseCaught(): boolean {
    let any = false;
    for (const b of this.balls) {
      if (b.stuck === null) continue;
      this.release(b);
      any = true;
    }
    return any;
  }

  private ballSpeed(b: Ball): number {
    const slow = this.isActive('slow') ? POWER.slowScale : 1;
    const fast = this.isActive('fast') ? POWER.fastScale : 1;
    const pierce = this.isActive('pierce') ? POWER.pierceScale : 1;
    return b.speed * slow * Math.max(fast, pierce);
  }

  /** While piercing, a ball goes through a brick its hit will break; any other brick stops it as usual. */
  private pierces(br: Brick): boolean {
    return this.isActive('pierce') && !isSolid(br) && br.hp <= 1 + this.modValue('heavy');
  }

  /** Brings moving balls to their current speed after a change in `SPEED_POWERS`. */
  private rescaleBalls(): void {
    for (const b of this.balls) if (b.vx !== 0 || b.vy !== 0) normalizeVelocity(b, this.ballSpeed(b));
  }

  private tickPowers(dt: number): void {
    for (const kind of TIMED_POWERS) {
      if (this.timers[kind] <= 0) continue;
      this.timers[kind] -= dt;
      if (this.timers[kind] <= 0) this.endPower(kind);
    }
  }

  private endPower(kind: TimedPower): void {
    this.timers[kind] = 0;
    this.events.emit('powerEnd', { kind });
    if (kind === 'catch') this.releaseCaught();
    if (SPEED_POWERS.includes(kind)) this.rescaleBalls();
  }

  /** Lost life or cleared stage: timers, capsules and bolts all go. */
  private clearPowers(): void {
    for (const kind of TIMED_POWERS) this.timers[kind] = 0;
    this.capsules = [];
    this.bolts = [];
    this.laserCooldown = 0;
  }

  /** Runs on real time. */
  private tickFocus(dt: number, input: TickInput): void {
    if (this.focusLeft > 0) {
      this.focusLeft = input.altHeld ? Math.max(0, this.focusLeft - dt) : 0;
      if (this.focusLeft > 0) return;
      this.focusCooldown = this.focusRest;
      this.events.emit('focusEnd', {});
      return;
    }
    if (this.focusCooldown > 0) {
      this.focusCooldown = Math.max(0, this.focusCooldown - dt);
      if (this.focusCooldown === 0) this.events.emit('focusReady', {});
    }
    if (!input.alt || this.focusCooldown > 0) return;
    this.focusLeft = this.focusDuration;
    this.events.emit('focusStart', {});
  }

  /** Launch press releases caught balls; otherwise holding fire shoots the laser. */
  private handleButtons(dt: number, input: TickInput): void {
    this.laserCooldown = Math.max(0, this.laserCooldown - dt);
    if (input.launch && this.releaseCaught()) {
      this.laserCooldown = POWER.laserCooldown;
      return;
    }
    if (input.fire && this.isActive('laser') && this.laserCooldown === 0) this.fireLaser();
  }

  /** Every ball in play explodes on its next `hits` bricks; more charges than that are kept, not added to. */
  private chargeBalls(hits: number): void {
    for (const b of this.balls) b.charges = Math.max(b.charges, hits);
  }

  private fireLaser(): void {
    const p = this.paddle;
    const y = p.y + p.h / 2 + POWER.boltLength;
    for (const side of [-1, 1]) {
      const x = p.x + side * (p.w / 2 - POWER.boltInset);
      this.bolts.push({ id: this.nextId++, x, y, py: y, pierce: this.modValue('laserpierce') });
    }
    this.laserCooldown = POWER.laserCooldown;
    this.events.emit('laserFire', { x: p.x, y });
  }

  /**
   * Bolts fly straight up; each one damages the first brick it reaches. A piercing bolt that
   * breaks it flies on (from where it is, next tick).
   */
  private updateBolts(dt: number): void {
    const dy = POWER.boltSpeed * dt;
    this.bolts = this.bolts.filter((bolt) => {
      let hit: SweepHit | null = null;
      let target: Brick | null = null;
      for (const br of this.bricks) {
        if (!br.alive) continue;
        // A moving brick can land on a bolt, which no sweep would catch.
        const inside = bolt.x > br.x && bolt.x < br.x + br.w && bolt.y > br.y && bolt.y < br.y + br.h;
        const h = inside ? { t: 0, nx: 0, ny: -1 } : sweepBox(bolt.x, bolt.y, 0, dy, br.x, br.y, br.x + br.w, br.y + br.h);
        if (closer(h, hit)) {
          hit = h;
          target = br;
        }
      }
      if (target) {
        this.hitBrick(target, 'laser', bolt.x, target.y);
        if (target.alive || bolt.pierce === 0) return false;
        bolt.pierce--;
        return true;
      }
      bolt.y += dy;
      return bolt.y - POWER.boltLength < FIELD.height;
    });
  }

  private updateCapsules(dt: number): void {
    const p = this.paddle;
    const hw = POWER.capsuleWidth / 2;
    const hh = POWER.capsuleHeight / 2;
    this.capsules = this.capsules.filter((c) => {
      c.y -= POWER.fallSpeed * dt;
      if (Math.abs(c.x - p.x) < p.w / 2 + hw && Math.abs(c.y - p.y) < p.h / 2 + hh) {
        this.score += SCORE.capsule;
        this.events.emit('powerCollect', { id: c.id, kind: c.kind });
        this.applyPower(c.kind);
        return false;
      }
      if (c.y + hh >= 0) return true;
      this.events.emit('powerMissed', { id: c.id, kind: c.kind });
      return false;
    });
  }

  /**
   * Each source ball gets twins fanned out around its direction, `POWER.splitAngle` apart, on a
   * random side first: enough to make `POWER.splitInto` balls, plus one per extra ball mod stack.
   * Up to the ball limit.
   */
  private splitBalls(): void {
    this.grantMods('split');
    const twins = splitInto(this.mods) - 1;
    for (const src of this.balls.slice()) {
      const [dirX, dirY] = ballDirection(src);
      const side = this.rng.next() < 0.5 ? 1 : -1;
      for (let i = 0; i < twins; i++) {
        if (this.balls.length >= POWER.maxBalls) return;
        // +1, -1, +2, -2 steps out from the source's direction.
        this.addTwin(src, dirX, dirY, side * (i % 2 === 0 ? 1 : -1) * (Math.floor(i / 2) + 1) * POWER.splitAngle);
      }
    }
  }

  /** A copy of `src` at its position, moving along (dirX, dirY) turned by `angle`. */
  private addTwin(src: Ball, dirX: number, dirY: number, angle: number, charges = src.charges): void {
    const ball: Ball = {
      ...src,
      id: this.nextId++,
      vx: dirX * Math.cos(angle) - dirY * Math.sin(angle),
      vy: dirX * Math.sin(angle) + dirY * Math.cos(angle),
      stuck: null,
      stuckTime: 0,
      // Twins start their own chain, so a split can't multiply a long one.
      chain: 0,
      chainPoints: 0,
      inPortal: src.inPortal,
      charges,
    };
    normalizeVelocity(ball, this.ballSpeed(ball));
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x: ball.x, y: ball.y });
  }

  private maybeDrop(x: number, y: number): void {
    if (this.breakableLeft === 0 || this.capsules.length >= POWER.maxCapsules) return;
    if (this.rng.next() >= POWER.dropChance + this.modValue('lucky')) return;
    this.dropCapsule(rollPower(this.rng, POWER_KINDS), x, y);
  }

  private dropCapsule(kind: PowerKind, x: number, y: number): void {
    const hw = POWER.capsuleWidth / 2;
    const capsule: Capsule = { id: this.nextId++, kind, x: clamp(x, hw, FIELD.width - hw), y, py: y };
    this.capsules.push(capsule);
    this.events.emit('powerDrop', { id: capsule.id, kind, x: capsule.x, y });
  }

  /** The lowest `count` breakable bricks take `damage` hits each, struck from below. */
  private pulseBricks(count: number, damage: number): void {
    const targets = this.bricks
      .filter(isBreakable)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, count);
    for (const br of targets) this.damageBrick(br, 'pulse', br.x + br.w / 2, br.y, damage);
  }

  /**
   * Ball struck a brick; it speeds up a little. A brick that survives takes the heavy ball's extra
   * hit. A charged ball then explodes, whatever the brick was.
   */
  private ballHitsBrick(br: Brick, b: Ball): void {
    // The dampener mod cuts the top speed too, so hits don't win back what it takes.
    const max = BALL.maxSpeed * (1 - this.modValue('dampener'));
    if (!isSolid(br)) b.speed = Math.min(max, b.speed + BALL.hitSpeedStep);
    const ix = clamp(b.x, br.x, br.x + br.w);
    const iy = clamp(b.y, br.y, br.y + br.h);
    this.hitBrick(br, 'ball', ix, iy, b);
    const extra = br.kind === 'steel' ? 0 : this.modValue('heavy');
    for (let i = 0; i < extra && br.alive; i++) this.hitBrick(br, 'ball', ix, iy, b);
    if (b.charges === 0) return;
    b.charges--;
    this.explode('charge', [b]);
  }

  /** What `points` pay when earned by `by`: the laser gets a share of them, more with the bounty mod. */
  private paid(points: number, by: HitSource): number {
    return by === 'laser' ? Math.round(points * (POWER.laserScore + this.modValue('bounty'))) : points;
  }

  /** Up to `hits` hits, stopping once the brick breaks. */
  private damageBrick(br: Brick, by: HitSource, ix: number, iy: number, hits: number): void {
    for (let i = 0; i < hits && br.alive; i++) this.hitBrick(br, by, ix, iy);
  }

  /**
   * (ix, iy) is the impact point on the brick; `ball` the ball that struck it, if any. Bricks a
   * ball destroys extend its chain and earn the chain bonus.
   */
  private hitBrick(br: Brick, by: HitSource, ix: number, iy: number, ball: Ball | null = null): void {
    // Callers may queue hits on a brick that an earlier hit already broke.
    if (!br.alive) return;
    br.hitTick = this.tick;
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    if (br.kind === 'steel') {
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    this.sinceHit = 0;
    this.stageEvents.arm('pulse');
    if (br.kind === 'core') {
      this.hitCore(br, by, ix, iy);
      return;
    }
    br.hp--;
    if (br.hp > 0) {
      this.score += this.paid(SCORE.hit * this.multiplier, by);
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    br.alive = false;
    if (br.falling) {
      this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points: 0, chain: 0, bonus: 0, multiplier: this.multiplier, by, x, y, ix, iy, vx: ball?.vx ?? 0, vy: ball?.vy ?? 0 });
      return;
    }
    this.breakableLeft--;
    this.sinceKill = 0;
    this.stageEvents.arm('supplyDrop', 'overload', 'hunter', 'demolition');
    const chain = ball ? ++ball.chain : 0;
    const multiplier = this.multiplier;
    const bonus = this.chainBonus(chain) * multiplier;
    if (ball) ball.chainPoints += bonus;
    const points = this.paid(brickPoints(br) * multiplier + bonus, by);
    this.score += points;
    const vx = ball?.vx ?? 0;
    const vy = ball?.vy ?? 0;
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, chain, bonus, multiplier, by, x, y, ix, iy, vx, vy });
    if (br.kind === 'explosive') this.fuses.push({ x, y, tick: this.tick + Math.round(BRICK_TYPES.explosive.fuse * SIM.tickRate) });
    this.maybeDrop(x, y);
  }

  /** Steel never counts towards clearing a stage, so breaking it pays like a normal brick and nothing more. */
  private breakSteel(br: Brick, ix: number, iy: number): void {
    br.alive = false;
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    const multiplier = this.multiplier;
    const points = SCORE.perHp * multiplier;
    this.score += points;
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, chain: 0, bonus: 0, multiplier, by: 'explosion', x, y, ix, iy, vx: 0, vy: 0 });
    this.maybeDrop(x, y);
  }
}

/** Where a ball is headed; a caught ball by the angle it would launch at, a resting one straight up. */
function ballDirection(b: Ball): [number, number] {
  if (b.stuck !== null) {
    const a = b.stuck * BALL.maxBounceAngle;
    return [Math.sin(a), Math.cos(a)];
  }
  return b.vx === 0 && b.vy === 0 ? [0, 1] : [b.vx, b.vy];
}

function isBreakable(br: Brick): boolean {
  return br.alive && br.kind !== 'steel';
}

/** A ball can't pierce it, and hitting it doesn't speed the ball up. */
function isSolid(br: Brick): boolean {
  return br.kind === 'steel' || br.kind === 'core';
}

/** Points for breaking a brick, before the multiplier and chain bonus. */
function brickPoints(br: Brick): number {
  if (br.kind === 'explosive') return SCORE.explosive;
  return br.maxHp * SCORE.perHp;
}

/** Bonus for the `chain`-th brick of a chain; the first brick earns none. */
export function chainBonus(chain: number): number {
  return Math.min(SCORE.chainStep * Math.max(0, chain - 1), SCORE.chainMax);
}
