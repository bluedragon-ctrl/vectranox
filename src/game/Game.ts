import { BALL, FIELD, PADDLE, RULES, SCORE, SIM } from '../config/game';
import { DRAFT, ELITE_WEIGHTS, MODS } from '../config/mods';
import { ELITE } from '../config/run';
import { BRICK_TYPES, FORMATION, PINBALL, POWER, POWER_LOOK, STAGE_EVENTS } from '../config/tuning';
import { EventBus } from '../core/events';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { assembleRun, buildStage } from '../levels/assemble';
import { TEMPLATES, type StageDef, type StageTemplate } from '../levels/stages';
import { sweepBox, sweepCircle, type SweepHit } from './collision';
import type { GameEvents, WallSide } from './events';
import { buildFormations, type Formation } from './formation';
import { parseLayout } from './layout';
import { MOD_KINDS, rollMods, sectorWeights } from './mods';
import { aim, closer, normalizeVelocity, pushOut, sweepWalls } from './physics';
import { CHARGE_POWERS, GOOD_POWERS, OPPOSITE, POWER_KINDS, rollPower, TIMED_POWERS } from './powers';
import { StageEventTracker } from './stageEvents';
import type {
  Ball,
  Bolt,
  Brick,
  Capsule,
  ChargePower,
  ExplosionSource,
  GameState,
  HitSource,
  ModKind,
  Paddle,
  Portal,
  PowerKind,
  StageEventKind,
  Target,
  TickInput,
  TimedPower,
} from './types';

/** Keeps the mod offers' random stream apart from the stage's. */
const OFFER_SALT = 0x9e3779b9;

/** Distance a ball is pushed off a surface after a bounce, so the next sweep starts outside it. */
const SKIN = 0.01;
/** Bounces resolved per ball per tick; leftover motion is dropped (only matters in tight corners). */
const MAX_BOUNCES = 4;

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
  /** The moving groups of bricks in this stage; any other brick stands still. */
  formations: Formation[] = [];
  /** The run's stages, assembled from the seed. */
  readonly stages: StageDef[];
  /** Stacks held of each mod; mods last the whole run. */
  readonly mods = Object.fromEntries(MOD_KINDS.map((k) => [k, 0])) as Record<ModKind, number>;
  /** The pick's mod offers, while drafting. */
  offers: ModKind[] = [];
  /** Seconds left on each timed power; 0 is off. */
  readonly timers = Object.fromEntries(TIMED_POWERS.map((k) => [k, 0])) as Record<TimedPower, number>;
  /** Charges held for each charge power, spent by the alt button. */
  readonly charges = Object.fromEntries(CHARGE_POWERS.map((k) => [k, 0])) as Record<ChargePower, number>;
  state: GameState = 'serve';
  /** Seconds since `state` last changed. */
  stateTime = 0;
  stageIndex = 0;
  score = 0;
  lives: number = RULES.lives;
  tick = 0;
  /** Position in `PINBALL.multipliers`; completing the target bank moves it up, losing a life resets it. */
  multiplierStep = 0;
  /** The serve being waited on follows a formation reaching the line. */
  breached = false;

  private rng: Rng;
  /** Mod offers, so in-stage play doesn't shift them. */
  private offerRng: Rng;
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
  }

  get stage(): StageDef {
    const stage = this.stages[this.stageIndex];
    if (!stage) throw new Error(`No stage ${this.stageIndex}`);
    return stage;
  }

  /** Score multiplier for brick points. */
  get multiplier(): number {
    const steps = PINBALL.multipliers;
    const base = steps[Math.min(this.multiplierStep, steps.length - 1)] ?? 1;
    // The amplifier mod only adds once a target bank has lit the multiplier.
    return this.multiplierStep > 0 ? base + this.modValue('amplifier') : base;
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
    if (marching.length === 0) return null;
    const gap = Math.min(...marching.map((f) => f.lowest)) - FORMATION.line;
    return clamp(1 - gap / FORMATION.warning, 0, 1);
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
    for (const br of this.bricks) {
      br.px = br.x;
      br.py = br.y;
    }

    switch (this.state) {
      case 'serve':
        this.movePaddle(dt, input);
        this.holdBalls();
        for (const f of this.formations) f.settle(dt);
        if (input.launch) this.launch();
        break;
      case 'play':
        this.movePaddle(dt, input);
        this.tickPowers(dt);
        this.handleButtons(dt, input);
        this.updateFormations(dt);
        this.updateBalls(dt);
        this.updateBolts(dt);
        this.updateCapsules(dt);
        this.burnFuses(this.tick);
        this.healBricks();
        this.resolveStage();
        if (this.state === 'play') this.checkStageEvents(dt);
        break;
      case 'clear':
        if (this.stateTime >= RULES.stageClearDelay) this.afterStage();
        break;
      // Waiting for the player's choice (pickMod / pickLives).
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
   * Applies a power as if its capsule was caught. Public so the dev console can grant powers
   * (`vnx.game.applyPower('laser')`).
   */
  applyPower(kind: PowerKind, duration: number = POWER.kinds[kind].duration): void {
    switch (kind) {
      case 'multi':
        this.splitBalls();
        return;
      case 'life':
        this.lives = Math.min(POWER.maxLives, this.lives + 1);
        return;
      case 'detonator':
        this.addCharges('detonator', this.charges.detonator > 0 ? POWER.detonator.recharge : POWER.detonator.charges);
        return;
    }
    const opposite = OPPOSITE[kind];
    if (opposite && this.isActive(opposite)) this.endPower(opposite);
    if (kind === 'laser') duration += this.modValue('longbeam');
    this.timers[kind] = POWER_LOOK[kind].bad ? duration : duration * (1 + this.modValue('extender'));
    if (kind === 'slow' || kind === 'fast') this.rescaleBalls();
  }

  /**
   * Runs a stage event's effect right away, skipping its trigger and chance. Public so the dev
   * console can try them (`vnx.game.fireStageEvent('overload')`).
   */
  fireStageEvent(kind: StageEventKind): void {
    this.stageEvents.fired(kind);
    this.events.emit('stageEvent', { kind, bricks: this.breakableLeft });
    switch (kind) {
      case 'supplyDrop': {
        const bricks = this.bricks.filter(isBreakable);
        const br = bricks[Math.floor(this.rng.next() * bricks.length)];
        if (br) this.dropCapsule(rollPower(this.rng, GOOD_POWERS), br.x + br.w / 2, br.y + br.h / 2);
        break;
      }
      case 'overload':
        this.splitBalls();
        break;
      case 'pulse':
        this.pulseBricks(STAGE_EVENTS.kinds.pulse.maxBricks, STAGE_EVENTS.kinds.pulse.damage);
        break;
      case 'hunter':
        this.applyPower('laser', STAGE_EVENTS.kinds.hunter.duration);
        break;
      case 'safetyNet':
        this.applyPower('barrier', STAGE_EVENTS.kinds.safetyNet.duration);
        break;
      case 'demolition':
        this.addCharges('detonator', STAGE_EVENTS.kinds.demolition.charges);
        break;
    }
  }

  /** The balls an alt press would detonate: all of them, or only the highest (see `POWER.detonator`). */
  blastBalls(): Ball[] {
    if (POWER.detonator.target === 'all') return this.balls;
    let best: Ball | null = null;
    for (const b of this.balls) if (!best || b.y > best.y) best = b;
    return best ? [best] : [];
  }

  /**
   * Adds a stack of a mod. Public so the dev console can grant mods (`vnx.game.applyMod('heavy')`);
   * in play it comes from the pick between stages.
   */
  applyMod(kind: ModKind): void {
    this.mods[kind] = Math.min(MODS[kind].maxStacks, this.mods[kind] + 1);
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
    const { sector, number } = this.stage;
    this.stages[this.stageIndex] = buildStage(template, this.stageIndex, sector, number, false);
    this.loadStage(this.stageIndex);
  }

  /*
   * Between stages. The UI calls these with the player's choice; each returns whether it was
   * allowed. (Recorded with their tick, they replay like the per-tick input.)
   */

  /** Takes offer `index` of the mod pick. */
  pickMod(index: number): boolean {
    const kind = this.offers[index];
    if (this.state !== 'draft' || !kind) return false;
    this.applyMod(kind);
    this.events.emit('modPick', { kind, stacks: this.mods[kind] });
    this.afterDraft();
    return true;
  }

  /** Whether the lives option would add any (lives are capped). */
  get canPickLives(): boolean {
    return this.state === 'draft' && this.lives < POWER.maxLives;
  }

  /** Takes extra lives instead of a mod. */
  pickLives(): boolean {
    if (!this.canPickLives) return false;
    const before = this.lives;
    this.lives = Math.min(POWER.maxLives, this.lives + DRAFT.lives);
    this.events.emit('livesPick', { gained: this.lives - before, lives: this.lives });
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
    ({ bricks: this.bricks, targets: this.targets, portals: this.portals } = parseLayout(stage.layout, () => this.nextId++));
    this.formations = buildFormations(stage.formations, this.bricks, stage.formationPace);
    this.breakableLeft = this.bricks.filter(isBreakable).length;
    this.breached = false;
    this.paddle.x = this.paddle.px = FIELD.width / 2;
    this.paddle.w = this.paddleWidth();
    this.keyHeld = 0;
    this.stageEvents.reset();
    this.secondWinds = 0;
    this.events.emit('stageStart', {
      stage: index + 1,
      sector: stage.sector,
      number: stage.number,
      name: stage.name,
      room: stage.room,
      bricks: this.breakableLeft,
    });
    this.serve();
    this.openingServe = true;
    // Stage-start mods, after the serve has cleared the powers.
    if (this.mods.armory > 0) this.addCharges('detonator', this.modValue('armory'));
    if (this.mods.failsafe > 0) this.applyPower('barrier', this.modValue('failsafe'));
    if (this.mods.laserstart > 0) this.applyPower('laser', this.modValue('laserstart'));
  }

  /** Stage cleared: the run ends after the last one; otherwise the pick opens. */
  private afterStage(): void {
    if (this.stageIndex + 1 >= this.stages.length) {
      this.setState('complete');
      this.events.emit('runComplete', { score: this.score });
      return;
    }
    this.offers = this.rollOffers(DRAFT.offers);
    // Every mod maxed and lives full: nothing to choose.
    if (this.offers.length === 0 && this.lives >= POWER.maxLives) {
      this.afterDraft();
      return;
    }
    this.setState('draft');
    this.events.emit('draftOpen', { stage: this.stageIndex + 1, offers: this.offers.slice() });
  }

  private afterDraft(): void {
    this.offers = [];
    this.loadStage(this.stageIndex + 1);
  }

  /** Mods on offer for the next stage's sector; an elite room just cleared pays with better ones. */
  private rollOffers(count: number): ModKind[] {
    const next = this.stages[this.stageIndex + 1] ?? this.stage;
    const weights = this.stage.room === 'elite' ? ELITE_WEIGHTS : sectorWeights(next.sector);
    return rollMods(this.offerRng, this.mods, weights, count);
  }

  /** A mod's total effect at the stacks held: its `perStack` times the stacks. */
  private modValue(kind: ModKind): number {
    return MODS[kind].perStack * this.mods[kind];
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
    if (!keepPowers) this.clearPowers();
    const x = this.paddle.x;
    const y = this.restY(BALL.radius);
    const speed = BALL.baseSpeed + this.stageIndex * BALL.stageSpeedStep + (this.stage.room === 'elite' ? ELITE.speedBonus : 0);
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
    };
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x, y });
    this.sinceHit = this.sinceKill = 0;
    this.stageEvents.arm('safetyNet');
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
    if (this.mods.splitter > 0) this.splitBalls();
    if (this.openingServe && this.mods.multistart > 0) this.splitBalls();
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

  /** Runs every play tick, after the stage was resolved. Triggers for the ongoing events. */
  private checkStageEvents(dt: number): void {
    this.sinceHit += dt;
    this.sinceKill += dt;
    const { supplyDrop, overload, pulse, hunter, demolition } = STAGE_EVENTS.kinds;
    const left = this.breakableLeft;
    if (left <= supplyDrop.bricksLeft) this.tryStageEvent('supplyDrop');
    if (left <= demolition.bricksLeft) this.tryStageEvent('demolition');
    if (left <= overload.bricksLeft) this.tryStageEvent('overload');
    if (this.sinceHit >= pulse.idleTime) this.tryStageEvent('pulse');
    if (left <= hunter.bricksLeft && this.sinceKill >= hunter.idleTime) this.tryStageEvent('hunter');
  }

  /** Trigger met: roll the event's chance once, then wait for it to re-arm. */
  private tryStageEvent(kind: StageEventKind): void {
    if (this.stageEvents.roll(kind, this.rng)) this.fireStageEvent(kind);
  }

  private movePaddle(dt: number, input: TickInput): void {
    const p = this.paddle;
    const scale = this.isActive('expand') ? POWER.expandScale : this.isActive('narrow') ? POWER.narrowScale : 1;
    const target = this.paddleWidth() * scale;
    p.w += (target - p.w) * Math.min(1, POWER.widthRate * dt);
    if (Math.abs(target - p.w) < 0.01) p.w = target;
    p.x = clamp(p.x + input.dx + this.keyTravel(dt, input.axis), p.w / 2, FIELD.width - p.w / 2);
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

  /**
   * Bricks move before the balls do, so one can land on a ball: the ball goes out the nearest side
   * and counts as hitting it. It leaves faster than a brick moves, or it would be caught again.
   */
  private shoveBall(b: Ball, br: Brick): void {
    const out = pushOut(b, br);
    if (!out) return;
    if (br.kind !== 'steel' && this.isActive('pierce')) {
      this.ballHitsBrick(br, b, true);
      return;
    }
    b.x += out.nx * (out.depth + SKIN);
    b.y += out.ny * (out.depth + SKIN);
    if (out.nx !== 0) b.vx = out.nx * Math.max(Math.abs(b.vx), FORMATION.shove);
    if (out.ny !== 0) b.vy = out.ny * Math.max(Math.abs(b.vy), FORMATION.shove);
    this.ballHitsBrick(br, b, false);
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
    // Cluster charge mod: new balls split off the ball nearest the first centre.
    const src = centres[0] && this.nearestBall(centres[0].x, centres[0].y);
    for (let i = 0; src && i < this.modValue('cluster') && this.balls.length < POWER.maxBalls; i++) {
      const [dirX, dirY] = ballDirection(src);
      this.addTwin(src, dirX, dirY, (i % 2 === 0 ? 1 : -1) * POWER.splitAngle);
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
    if (this.breakableLeft === 0) {
      // Whatever is still burning has nothing left to break, but it should still be seen.
      this.burnFuses(Infinity);
      this.bricks = this.bricks.filter((br) => br.alive);
      const bonus = this.stage.room === 'elite' ? ELITE.clearBonus : 0;
      this.score += bonus;
      this.balls = [];
      this.clearPowers();
      this.setState('clear');
      this.events.emit('stageClear', { stage: this.stageIndex + 1, score: this.score, bonus });
      return;
    }
    if (this.bricks.some((br) => !br.alive)) this.bricks = this.bricks.filter((br) => br.alive);

    // Ahead of the lost balls: this life is gone either way, and the formation must still turn back.
    if (this.formations.some((f) => f.breached)) {
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
        this.events.emit('secondWind', { left: this.modValue('secondwind') - this.secondWinds });
        this.serve(true);
      } else this.loseLife();
    }
  }

  private loseLife(): void {
    this.lives--;
    this.multiplierStep = this.mods.anchor > 0 ? Math.max(0, this.multiplierStep - 1) : 0;
    this.events.emit('lifeLost', { lives: this.lives });
    if (this.lives > 0) {
      this.serve();
    } else {
      this.setState('over');
      this.events.emit('gameOver', { stage: this.stageIndex + 1, score: this.score });
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

      // Piercing balls go straight through anything breakable.
      if (typeof target === 'object' && target.kind !== 'steel' && this.isActive('pierce')) {
        b.x += dx * hit.t;
        b.y += dy * hit.t;
        remaining *= 1 - hit.t;
        this.ballHitsBrick(target, b, true);
        normalizeVelocity(b, this.ballSpeed(b));
        continue;
      }

      b.x += dx * hit.t + hit.nx * SKIN;
      b.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      // Before the bounce, so the brick's events carry the incoming velocity.
      if (typeof target === 'object') {
        this.ballHitsBrick(target, b, false);
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
    const capture = PINBALL.portal.capture ** 2;
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
    this.multiplierStep = Math.min(this.multiplierStep + 1, PINBALL.multipliers.length - 1);
    this.score += PINBALL.bankBonus;
    this.events.emit('targetBank', { multiplier: this.multiplier, bonus: PINBALL.bankBonus });
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
      b.stuck = clamp(offset, -0.9, 0.9);
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
    const scale = this.isActive('slow') ? POWER.slowScale : this.isActive('fast') ? POWER.fastScale : 1;
    return b.speed * scale;
  }

  /** Brings moving balls to their current speed after slow/fast changes. */
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
    if (kind === 'slow' || kind === 'fast') this.rescaleBalls();
  }

  /** Lost life or cleared stage: timers, charges, capsules and bolts all go. */
  private clearPowers(): void {
    for (const kind of TIMED_POWERS) this.timers[kind] = 0;
    for (const kind of CHARGE_POWERS) this.charges[kind] = 0;
    this.capsules = [];
    this.bolts = [];
    this.laserCooldown = 0;
  }

  /**
   * Launch press releases caught balls; otherwise holding fire shoots the laser.
   * Alt press spends a detonator charge (with none held it does nothing).
   */
  private handleButtons(dt: number, input: TickInput): void {
    this.laserCooldown = Math.max(0, this.laserCooldown - dt);
    if (input.alt && this.charges.detonator > 0) this.detonate();
    if (input.launch && this.releaseCaught()) {
      this.laserCooldown = POWER.laserCooldown;
      return;
    }
    if (input.fire && this.isActive('laser') && this.laserCooldown === 0) this.fireLaser();
  }

  private addCharges(kind: ChargePower, n: number): void {
    this.charges[kind] = Math.min(POWER[kind].maxCharges, this.charges[kind] + n);
  }

  /** The blast balls explode as one and fly on. */
  private detonate(): void {
    const balls = this.blastBalls();
    if (balls.length === 0) return;
    this.charges.detonator--;
    this.explode('charge', balls);
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
      this.pull(c, dt);
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

  /** The magnet mod draws falling capsules above the paddle sideways towards it. */
  private pull(pickup: { x: number; y: number }, dt: number): void {
    const speed = this.modValue('magnet');
    if (speed === 0 || pickup.y < this.paddle.y) return;
    const step = speed * dt;
    pickup.x += clamp(this.paddle.x - pickup.x, -step, step);
  }

  /**
   * Each source ball gets twins fanned out around its direction, `POWER.splitAngle` apart: two,
   * plus one per extra ball mod stack. Up to the ball limit.
   */
  private splitBalls(): void {
    // Split guard mod: applying a power restarts its timer, so skip it if that would cut the barrier short.
    const guard = this.modValue('splitguard');
    if (guard * (1 + this.modValue('extender')) > this.timers.barrier) this.applyPower('barrier', guard);
    const twins = 2 + this.modValue('extraball');
    for (const src of this.balls.slice()) {
      const [dirX, dirY] = ballDirection(src);
      for (let i = 0; i < twins; i++) {
        if (this.balls.length >= POWER.maxBalls) return;
        // +1, -1, +2, -2 steps out from the source's direction.
        this.addTwin(src, dirX, dirY, (i % 2 === 0 ? 1 : -1) * (Math.floor(i / 2) + 1) * POWER.splitAngle);
      }
    }
  }

  /** A copy of `src` at its position, moving along (dirX, dirY) turned by `angle`. */
  private addTwin(src: Ball, dirX: number, dirY: number, angle: number): void {
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
   * Ball struck a brick; it speeds up a little. `smash` breaks it outright (pierce). A brick that
   * survives takes the heavy ball's extra hit.
   */
  private ballHitsBrick(br: Brick, b: Ball, smash: boolean): void {
    // The dampener mod cuts the top speed too, so hits don't win back what it takes.
    const max = BALL.maxSpeed * (1 - this.modValue('dampener'));
    if (br.kind !== 'steel') b.speed = Math.min(max, b.speed + BALL.hitSpeedStep);
    const ix = clamp(b.x, br.x, br.x + br.w);
    const iy = clamp(b.y, br.y, br.y + br.h);
    this.hitBrick(br, 'ball', ix, iy, smash, b);
    if (!br.alive || br.kind === 'steel') return;
    const extra = this.modValue('heavy');
    for (let i = 0; i < extra && br.alive; i++) this.hitBrick(br, 'ball', ix, iy, false, b);
  }

  /** Up to `hits` hits, stopping once the brick breaks. */
  private damageBrick(br: Brick, by: HitSource, ix: number, iy: number, hits: number): void {
    for (let i = 0; i < hits && br.alive; i++) this.hitBrick(br, by, ix, iy);
  }

  /**
   * (ix, iy) is the impact point on the brick; `ball` the ball that struck it, if any. Bricks a
   * ball destroys extend its chain and earn the chain bonus.
   */
  private hitBrick(br: Brick, by: HitSource, ix: number, iy: number, smash = false, ball: Ball | null = null): void {
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
    br.hp = smash ? 0 : br.hp - 1;
    if (br.hp > 0) {
      this.score += SCORE.hit * this.multiplier;
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    br.alive = false;
    this.breakableLeft--;
    this.sinceKill = 0;
    this.stageEvents.arm('supplyDrop', 'overload', 'hunter', 'demolition');
    const chain = ball ? ++ball.chain : 0;
    const multiplier = this.multiplier;
    const bonus = this.chainBonus(chain) * multiplier;
    if (ball) ball.chainPoints += bonus;
    const points = brickPoints(br) * multiplier + bonus;
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

/** Points for breaking a brick, before the multiplier and chain bonus. */
function brickPoints(br: Brick): number {
  if (br.kind === 'explosive') return SCORE.explosive;
  return br.maxHp * SCORE.perHp;
}

/** Bonus for the `chain`-th brick of a chain; the first brick earns none. */
export function chainBonus(chain: number): number {
  return Math.min(SCORE.chainStep * Math.max(0, chain - 1), SCORE.chainMax);
}
