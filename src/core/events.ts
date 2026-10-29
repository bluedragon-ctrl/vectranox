type Handler<P> = (payload: P) => void;
type AnyHandler<E> = <K extends keyof E>(type: K, payload: E[K]) => void;

/** Minimal typed pub/sub. The simulation emits, everything else listens. */
export class EventBus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();
  private anyHandlers = new Set<AnyHandler<E>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  onAny(fn: AnyHandler<E>): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<E[K]>)(payload));
    this.anyHandlers.forEach((fn) => fn(type, payload));
  }
}
