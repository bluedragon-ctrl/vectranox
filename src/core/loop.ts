import { SIM } from '../config/game';

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  update(dt: number): void;
  /** Draw; `alpha` in [0,1) is how far we are between the last two ticks. */
  render(alpha: number, frameTime: number): void;
}

/** Fixed-timestep loop with interpolation (simulation is frame-rate independent). */
export function startLoop({ update, render }: LoopCallbacks): () => void {
  const dt = 1 / SIM.tickRate;
  let acc = 0;
  let last = performance.now();
  let handle = 0;

  const frame = (now: number) => {
    const frameTime = Math.min((now - last) / 1000, SIM.maxFrameTime);
    last = now;
    acc += frameTime;
    while (acc >= dt) {
      update(dt);
      acc -= dt;
    }
    render(acc / dt, frameTime);
    handle = requestAnimationFrame(frame);
  };

  handle = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(handle);
}
