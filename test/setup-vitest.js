/* global console, window */
// In-memory localStorage/sessionStorage polyfill. Newer Node + jsdom do not
// expose Web Storage unless `--localstorage-file` is set, which breaks code
// (and tests) that touch window.localStorage. Install a minimal shim when the
// real one is missing so app bootstrap behaves as it does in a browser.
function installStoragePolyfill() {
  /** @type {Record<string, any> | undefined} */
  const target =
    typeof window !== 'undefined'
      ? /** @type {any} */ (window)
      : typeof globalThis !== 'undefined'
        ? /** @type {any} */ (globalThis)
        : undefined;
  if (!target) {
    return;
  }
  const makeStorage = () => {
    /** @type {Map<string, string>} */
    const store = new Map();
    return {
      get length() {
        return store.size;
      },
      /** @param {string} k */
      getItem(k) {
        return store.has(String(k)) ? store.get(String(k)) : null;
      },
      /**
       * @param {string} k
       * @param {string} v
       */
      setItem(k, v) {
        store.set(String(k), String(v));
      },
      /** @param {string} k */
      removeItem(k) {
        store.delete(String(k));
      },
      clear() {
        store.clear();
      },
      /** @param {number} i */
      key(i) {
        return Array.from(store.keys())[i] ?? null;
      }
    };
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    let ok = false;
    try {
      ok = Boolean(target[name]) && typeof target[name].setItem === 'function';
    } catch {
      ok = false;
    }
    if (!ok) {
      Object.defineProperty(target, name, {
        value: makeStorage(),
        configurable: true,
        writable: true
      });
    }
  }
}
installStoragePolyfill();

// Suppress Lit dev-mode warning in Vitest
// Provided snippet: overrides console.warn but forwards all other messages
const { warn } = console;
console.warn = /** @type {function(...*): void} */ (
  (...args) => {
    // Filter out the noisy Lit dev-mode banner in tests
    if (!args[0].startsWith('Lit is in dev mode.')) {
      warn.call(console, ...args);
    }
  }
);
