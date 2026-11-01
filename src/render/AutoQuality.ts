import { QUALITY } from '../config/game';

/**
 * Steps render quality down while frames stay slow. It never steps back up: that would flip
 * between two steps on a machine near the limit. Wall-clock only, so it can't touch the simulation.
 */
export class AutoQuality {
  private level = 0;
  /** Frame rate before the last step, until the next sample judges that step. */
  private before: number | null = null;
  private stopped = false;
  private settle: number = QUALITY.settleTime;
  private time = 0;
  private frames = 0;

  constructor() {
    // A hidden tab gets no frames, and the gap isn't the GPU's fault.
    document.addEventListener('visibilitychange', () => this.restartSample());
  }

  get step(): (typeof QUALITY.autoSteps)[number] {
    return QUALITY.autoSteps[this.level]!;
  }

  reset(): void {
    this.level = 0;
    this.before = null;
    this.stopped = false;
    this.restartSample();
  }

  /** Counts one frame; true when the step changed. */
  update(frameTime: number): boolean {
    if (this.stopped) return false;
    if (this.settle > 0) {
      this.settle -= frameTime;
      return false;
    }
    this.time += frameTime;
    this.frames++;
    if (this.time < QUALITY.sampleTime) return false;

    const fps = this.frames / this.time;
    const before = this.before;
    this.before = null;
    this.restartSample();
    if (before !== null && fps < before * QUALITY.minGain) {
      this.level--;
      this.stopped = true;
      return true;
    }
    if (fps >= QUALITY.minFps || this.level === QUALITY.autoSteps.length - 1) return false;
    this.before = fps;
    this.level++;
    return true;
  }

  private restartSample(): void {
    this.settle = QUALITY.settleTime;
    this.time = 0;
    this.frames = 0;
  }
}
