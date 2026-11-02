import { BALL, FIELD, PADDLE, RULES, SCORE, SIM } from '../config/game';
import { ANCHOR_DROP, DRAFT, MODS, PRICES, type GrantTrigger } from '../config/mods';
import { clearBonus, ELITE, ROOM_CREDITS, TIME_BONUS } from '../config/run';
import { BOSS, BRICK_TYPES, FOCUS, FORMATION, PINBALL, POWER, STAGE_EVENTS } from '../config/tuning';
import { EventBus } from '../core/events';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { assembleRun, buildStage, extraRoom } from '../levels/assemble';
import { TEMPLATES, type StageDef, type StageTemplate } from '../levels/stages';
import { aimPath, aimRebound, type Point } from './aim';
import { BossFight } from './boss';
import { BossRoom } from './bossRoom';
import { sweepBox, sweepCircle, type SweepHit } from './collision';
import type { GameEvents, WallSide } from './events';
import { buildFormations, type Formation } from './formation';
import { parseLayout } from './layout';
import { epicChance, laserPay, MOD_GRANTS, MOD_KINDS, rollMods } from './mods';
import { aim, ballDirection, bounceFlat, CATCH_EDGE, closer, MAX_BOUNCES, normalizeVelocity, pushOut, reflect, SKIN, sweepRect, sweepWalls } from './physics';
import { Pinball } from './pinball';
import { PowerUps } from './powerUps';
import { GOOD_POWERS, rollPower, TIMED_POWERS } from './powers';
import { StageEventTracker } from './stageEvents';
import type {
  Ball,
  Bolt,
  Brick,
  Capsule,
  ExplosionSource,
  GameState,
  HitSource,
  ModKind,
  Pad,
  Paddle,
  Portal,
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
  pads: Pad[] = [];
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

  /*
   * Shared with the game's systems below (bossRoom.ts, pinball.ts, powerUps.ts, aim.ts), as are the
   * methods further down without `private`: not for the UI.
   */
  readonly boss = new BossRoom(this);
  readonly pinball = new Pinball(this);
  readonly powers = new PowerUps(this);
  /** The stage's random stream. */
  readonly rng: Rng;
  /** Breakable bricks still standing (the core counts; steel and falling bricks don't). */
  breakableLeft = 0;

  /** Mod offers, so in-stage play doesn't shift them. */
  private offerRng: Rng;
  /** Rooms added by the rollback mod. */
  private roomRng: Rng;
  private nextId = 1;
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
        this.pinball.tickPads(world);
        this.movePaddle(dt, input);
        this.powers.tick(world);
        this.powers.handleButtons(world, input);
        this.updateFormations(world);
        this.boss.moveFallers(world);
        this.fight?.update(world, this.bricks, (kind, br) => this.boss.emitterActs(kind, br));
        this.updateBalls(world);
        this.boss.updateShadows(world);
        this.powers.updateBolts(world);
        this.boss.updateShots(world);
        this.powers.updateCapsules(world);
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

  /** A fresh id for anything the game creates. */
  newId(): number {
    return this.nextId++;
  }

  isActive(kind: TimedPower): boolean {
    return this.timers[kind] > 0;
  }

  /**
   * Applies a power as if its capsule was caught (see `PowerUps.apply`). Public so the dev console
   * can grant powers (`vnx.game.applyPower('laser')`).
   */
  applyPower(kind: PowerKind, amount?: number): void {
    this.powers.apply(kind, amount);
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
    if (power) this.powers.apply(power, duration);
    switch (kind) {
      case 'supplyDrop': {
        const bricks = this.bricks.filter(isBreakable);
        const br = bricks[Math.floor(this.rng.next() * bricks.length)];
        if (br) this.powers.dropCapsule(rollPower(this.rng, GOOD_POWERS), br.x + br.w / 2, br.y + br.h / 2);
        break;
      }
      case 'pulse': {
        const { maxBricks, damage } = STAGE_EVENTS.kinds.pulse;
        this.pulseBricks(Math.min(maxBricks, this.breakableLeft - (spareLast ? 1 : 0)), damage);
        break;
      }
    }
  }

  /** Aim lines are up: focus or the oracle power is running. */
  get aiming(): boolean {
    return this.state === 'play' && (this.focusLeft > 0 || this.isActive('oracle'));
  }

  /** See `aimPath`. */
  ballPath(b: Ball): Point[] | null {
    return aimPath(this, b);
  }

  /** See `aimRebound`. */
  reboundEnd(b: Ball, landing: Point): Point | null {
    return aimRebound(this, b, landing);
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
    ({ bricks: this.bricks, targets: this.targets, portals: this.portals, pads: this.pads } = parseLayout(stage.layout, () => this.newId(), stage.boss?.hp, stage.mirrored));
    this.pinball.reset();
    this.formations = buildFormations(stage.formations, this.bricks, stage.formationPace);
    const core = this.bricks.find((br) => br.kind === 'core');
    this.fight = stage.boss && core ? new BossFight(stage.boss, core) : null;
    this.boss.paceFormations();
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
  modValue(kind: ModKind): number {
    return MODS[kind].perStack * this.mods[kind];
  }

  /** Grants what the mods held give on `on`. */
  grantMods(on: GrantTrigger): void {
    for (const g of MOD_GRANTS) if (g.on === on && this.mods[g.kind] > 0) this.powers.apply(g.power, this.modValue(g.kind));
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
    if (!keepPowers) this.powers.clear();
    const x = this.paddle.x;
    const y = this.restY(BALL.radius);
    const speed = BALL.baseSpeed + (this.stage.number - 1) * BALL.stageSpeedStep + (this.stage.room === 'elite' ? ELITE.speedBonus : 0);
    const ball: Ball = {
      id: this.newId(),
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
      inPad: null,
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
  restY(r: number): number {
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

  /** Each serve starts clean: what a boss sent out goes, and the paddle can move. */
  private clearThreats(): void {
    this.shots = [];
    this.shadows = [];
    this.stun = 0;
    this.focusLeft = this.focusCooldown = 0;
    if (this.bricks.some((br) => br.falling)) this.bricks = this.bricks.filter((br) => !br.falling);
  }

  /**
   * Bricks move before the balls do, so one can land on a ball: the ball goes out the nearest side
   * and counts as hitting it. It leaves faster than a brick moves, or it would be caught again.
   */
  shoveBall(b: Ball, br: Brick): void {
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
      this.powers.addTwin(src, dirX, dirY, (i % 2 === 0 ? 1 : -1) * POWER.splitAngle, 0);
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
      const bonus = clearBonus(this.stage.room);
      const timeBonus = this.timeLeft > 0 ? TIME_BONUS.score : 0;
      this.score += bonus + timeBonus;
      if (this.flawless) this.raiseMultiplier();
      this.balls = [];
      this.clearThreats();
      this.powers.clear();
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
        const h = sweepRect(b, dx, dy, br);
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
        reflect(b, hit.nx, hit.ny);
        this.pinball.hitTarget(target, b);
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
      bounceFlat(b, hit.nx, hit.ny);

      if (target === 'paddle') {
        if (this.paddleContact(b, hit.ny > 0)) return;
      } else if (target === 'barrier') this.events.emit('barrierHit', { id: b.id, x: b.x });
      else if (typeof target === 'string') this.events.emit('wallHit', { id: b.id, side: target, x: b.x, y: b.y });
      normalizeVelocity(b, this.ballSpeed(b));
    }
    b.x = clamp(b.x, b.r, FIELD.width - b.r);
    b.y = Math.min(b.y, FIELD.height - b.r);
    this.pinball.checkPortals(b);
    this.pinball.checkPads(b);
  }

  raiseMultiplier(): void {
    this.multiplierStep = Math.min(this.multiplierStep + 1, PINBALL.multipliers.length - 1);
  }

  /** A lost life or a second wind: the room stops being flawless, and without anchor the whole multiplier goes. */
  private loseMultiplier(): void {
    this.flawless = false;
    this.multiplierStep = Math.max(0, this.multiplierStep - (ANCHOR_DROP[this.mods.anchor - 1] ?? Infinity));
  }

  /** The paddle grown by `r` on every side. Returns a shared object, valid until the next call. */
  paddleBox(r: number): Box {
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
  releaseCaught(): boolean {
    let any = false;
    for (const b of this.balls) {
      if (b.stuck === null) continue;
      this.release(b);
      any = true;
    }
    return any;
  }

  /** Top base speed for a ball; the dampener mod cuts it too, so hits and boosters don't win back what it takes. */
  get maxBallSpeed(): number {
    return BALL.maxSpeed * (1 - this.modValue('dampener'));
  }

  /** How close a ball has to come to a portal's centre to go through. */
  get portalCapture(): number {
    return this.fight ? BOSS.portalCapture : PINBALL.portal.capture;
  }

  ballSpeed(b: Ball): number {
    const slow = this.isActive('slow') ? POWER.slowScale : 1;
    const fast = this.isActive('fast') ? POWER.fastScale : 1;
    const pierce = this.isActive('pierce') ? POWER.pierceScale : 1;
    return b.speed * slow * Math.max(fast, pierce);
  }

  /** While piercing, a ball goes through a brick its hit will break; any other brick stops it as usual. */
  pierces(br: Brick): boolean {
    return this.isActive('pierce') && !isSolid(br) && br.hp <= 1 + this.modValue('heavy');
  }

  /** Brings moving balls to their current speed after a power changed their speed (see `PowerUps`). */
  rescaleBalls(): void {
    for (const b of this.balls) if (b.vx !== 0 || b.vy !== 0) normalizeVelocity(b, this.ballSpeed(b));
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
    if (!isSolid(br)) b.speed = Math.min(this.maxBallSpeed, b.speed + BALL.hitSpeedStep);
    const ix = clamp(b.x, br.x, br.x + br.w);
    const iy = clamp(b.y, br.y, br.y + br.h);
    this.hitBrick(br, 'ball', ix, iy, b);
    const extra = br.kind === 'steel' ? 0 : this.modValue('heavy');
    for (let i = 0; i < extra && br.alive; i++) this.hitBrick(br, 'ball', ix, iy, b);
    if (b.charges === 0) return;
    b.charges--;
    this.explode('charge', [b]);
  }

  /** What `points` pay when earned by `by`: the laser gets a share of them, more with the long beam mod. */
  paid(points: number, by: HitSource): number {
    return by === 'laser' ? Math.round(points * laserPay(this.mods)) : points;
  }

  /** Up to `hits` hits, stopping once the brick breaks. */
  private damageBrick(br: Brick, by: HitSource, ix: number, iy: number, hits: number): void {
    for (let i = 0; i < hits && br.alive; i++) this.hitBrick(br, by, ix, iy);
  }

  /**
   * (ix, iy) is the impact point on the brick; `ball` the ball that struck it, if any. Bricks a
   * ball destroys extend its chain and earn the chain bonus.
   */
  hitBrick(br: Brick, by: HitSource, ix: number, iy: number, ball: Ball | null = null): void {
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
      this.boss.hitCore(br, by, ix, iy);
      return;
    }
    br.hp--;
    if (br.hp > 0) {
      this.score += this.paid(SCORE.hit * this.multiplier, by);
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    br.alive = false;
    const vx = ball?.vx ?? 0;
    const vy = ball?.vy ?? 0;
    if (br.falling) {
      this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points: 0, chain: 0, bonus: 0, multiplier: this.multiplier, by, x, y, ix, iy, vx, vy });
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
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, chain, bonus, multiplier, by, x, y, ix, iy, vx, vy });
    if (br.kind === 'explosive') this.fuses.push({ x, y, tick: this.tick + Math.round(BRICK_TYPES.explosive.fuse * SIM.tickRate) });
    this.powers.maybeDrop(x, y);
  }

  /** Steel never counts towards clearing a stage, so breaking it pays like a normal brick and always drops a capsule. */
  private breakSteel(br: Brick, ix: number, iy: number): void {
    br.alive = false;
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    const multiplier = this.multiplier;
    const points = SCORE.perHp * multiplier;
    this.score += points;
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, chain: 0, bonus: 0, multiplier, by: 'explosion', x, y, ix, iy, vx: 0, vy: 0 });
    this.powers.maybeDrop(x, y, 1);
  }
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
