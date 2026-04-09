// Event Bus - V3 Crew Event System

export class EventBus {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event, data) {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(data); } catch (e) { console.error(`[EventBus] Error in handler for "${event}":`, e); }
    }
  }
}
