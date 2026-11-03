const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) freeze(value[key]);
  return value;
};

export class KinetixEventBus {
  #listeners = new Map();
  #onError;

  constructor({ onError = (error) => console.error('[KINETIX BUS]', error) } = {}) {
    this.#onError = onError;
  }

  on(type, listener, { signal, once = false } = {}) {
    if (typeof type !== 'string' || !type) throw new TypeError('Event type is required.');
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function.');
    if (signal?.aborted) return () => {};

    const entry = { listener, once };
    const entries = this.#listeners.get(type) || new Set();
    entries.add(entry);
    this.#listeners.set(type, entries);

    const off = () => {
      entries.delete(entry);
      if (!entries.size) this.#listeners.delete(type);
      signal?.removeEventListener('abort', off);
    };

    signal?.addEventListener('abort', off, { once: true });
    return off;
  }

  once(type, listener, options = {}) {
    return this.on(type, listener, { ...options, once: true });
  }

  emit(type, payload = {}) {
    const snapshot = freeze({ ...payload });
    const entries = this.#listeners.get(type);
    if (!entries?.size) return 0;

    let delivered = 0;
    for (const entry of [...entries]) {
      if (!entries.has(entry)) continue;
      if (entry.once) entries.delete(entry);
      try {
        entry.listener(snapshot);
        delivered += 1;
      } catch (error) {
        this.#onError(error, type);
      }
    }

    if (!entries.size) this.#listeners.delete(type);
    return delivered;
  }

  clear(type) {
    if (type) this.#listeners.delete(type);
    else this.#listeners.clear();
  }

  listenerCount(type) {
    return this.#listeners.get(type)?.size || 0;
  }
}
