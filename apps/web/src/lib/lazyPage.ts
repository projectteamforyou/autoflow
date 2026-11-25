/**
 * Loader for the lazily loaded screens (app/App.tsx).
 *
 * A chunk can fail to load although the app itself is fine: the PWA was updated in another tab and
 * the old hashed file is gone (404), or the network dropped. The first failure reloads the page once
 * — that picks up the new index.html and chunk names. If the same screen fails again right after
 * that reload, the error is rethrown so the route error boundary shows "Couldn't load this screen"
 * instead of reloading in a loop.
 */
const FLAG = "af.chunkReload";

export interface LazyPageEnv {
  /** sessionStorage-like; every call may throw (blocked storage). */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
  reload: () => void;
}

const browserEnv = (): LazyPageEnv => {
  let storage: Storage | undefined;
  try {
    storage = sessionStorage;
  } catch {
    storage = undefined;
  }
  return { storage, reload: () => location.reload() };
};

export function loadPageChunk<T>(name: string, load: () => Promise<T>, env: LazyPageEnv = browserEnv()): Promise<T> {
  const read = (): string | null => {
    try {
      return env.storage?.getItem(FLAG) ?? null;
    } catch {
      return null;
    }
  };
  return load().then(
    (mod) => {
      // This screen loads again: the next failure may reload once more.
      try {
        if (read() === name) env.storage?.removeItem(FLAG);
      } catch {
        /* nothing to clear */
      }
      return mod;
    },
    (err: unknown) => {
      if (read() !== name) {
        let flagged = false;
        try {
          if (env.storage) {
            env.storage.setItem(FLAG, name);
            flagged = env.storage.getItem(FLAG) === name;
          }
        } catch {
          flagged = false;
        }
        // Without a working flag "once" cannot be guaranteed, so no automatic reload then.
        if (flagged) {
          env.reload();
          // Stay on the loading placeholder until the reload replaces the page.
          return new Promise<T>(() => undefined);
        }
      }
      throw err;
    },
  );
}
