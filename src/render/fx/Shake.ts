/** Max camera offset (world units) and roll (radians) at full trauma. */
const MAX_OFFSET = 7;
const MAX_ROLL = 0.012;
/** Trauma lost per second. */
const DECAY = 1.8;

/**
 * Trauma-based screen shake: events add trauma, the offset scales with trauma² and follows
 * smooth layered sines so it reads as a shudder rather than jitter.
 */
export class Shake {
  /** 0 disables shake (reduce-shake setting). */
  scale = 1;
  x = 0;
  y = 0;
  roll = 0;

  private trauma = 0;
  private t = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
    const k = this.trauma * this.trauma * this.scale;
    const t = this.t;
    this.x = MAX_OFFSET * k * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 81.7 + 1.3) * 0.4);
    this.y = MAX_OFFSET * k * (Math.sin(t * 53.9 + 2.1) * 0.6 + Math.sin(t * 89.1 + 0.4) * 0.4);
    this.roll = MAX_ROLL * k * Math.sin(t * 37.1 + 4.2);
  }
}
