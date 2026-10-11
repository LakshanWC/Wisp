// scripts/storage.ts
//
// Cross-browser wrapper around the WebExtension APIs used by this extension.
//
// Firefox: `browser.*` returns Promises natively — call it directly.
// Chrome:  `chrome.*` is callback-based (and `create`/`clear` on some APIs
//          are fire-and-forget with no callback at all) — wrap those with
//          `callChrome` / a bespoke Promise where required.
//
// `pick` chooses the right surface per call. Anything that is *not* a
// Promise-returning API in Firefox or a callback-style API in Chrome needs
// its own handling (see `alarms.create` below).

export interface BookmarkTreeNode {
  id: string;
  parentId?: string;
  index?: number;
  url?: string;
  title: string;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkTreeNode[];
  unmodifiable?: "managed";
}

// ─── ADDITION #1: Storage change event type ───────────────────────────────────
// Matches the shape of `chrome.storage.StorageChange` / Firefox's equivalent,
// without needing @types/chrome at the call site.
export interface StorageChange {
  oldValue?: any;
  newValue?: any;
}

export type StorageChanges = Record<string, StorageChange>;

const isFirefox =
  typeof browser !== 'undefined' &&
  typeof chrome === 'undefined';

// ---- Types ----

export interface BrowserWindow {
  id: number;
  incognito: boolean;
  focused?: boolean;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  type?: 'normal' | 'popup' | 'panel' | 'app' | 'devtools';
  state?: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'locked-fullscreen';
  alwaysOnTop?: boolean;
  sessionId?: string;
}

export interface BrowserTab {
  id?: number;
  index: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
  incognito: boolean;
  [key: string]: any;
}

export interface PermissionsRequest {
  permissions?: string[];
  origins?: string[];
}

export interface AlarmCreateInfo {
  /** Minutes from now until the alarm fires. Chrome clamps < 0.5 on unpacked
   *  extensions (and < 1 on packed ones) up to the floor; Firefox does not. */
  delayInMinutes?: number;
  /** If set, the alarm fires repeatedly at this interval. */
  periodInMinutes?: number;
  /** Absolute epoch ms at which to fire. Mutually exclusive with delayInMinutes. */
  when?: number;
}

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

// ---- Helper: wrap a Chrome callback-style call as a Promise ----
// Uses chrome.runtime.lastError checking so failures don't get swallowed.

function callChrome<T>(
  fn: (...args: any[]) => void,
  ...args: any[]
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn(...args, (result: T) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve(result);
      }
    });
  });
}

// ---- Helper: pick the right API surface per-call ----
// Firefox: call directly (it already returns a Promise).
// Chrome: wrap with callChrome.

function pick<T>(
  firefoxCall: () => Promise<T>,
  chromeCall: () => Promise<T>
): Promise<T> {
  return isFirefox ? firefoxCall() : chromeCall();
}

// ─── ADDITION #2: helper for synchronous event subscriptions ──────────────────
// Returns an unsubscribe function so callers don't have to hold a reference
// to the callback. Works identically on both browsers.
function subscribe<T extends (...args: any[]) => void>(
  getApi: () => { addListener: (cb: T) => void; removeListener: (cb: T) => void },
  cb: T
): () => void {
  const api = getApi();
  api.addListener(cb);
  return () => api.removeListener(cb);
}

// ---- API ----

export const browserApi = {
  storage: {
    local: {
      get: (keys: string | string[] | Record<string, any> | null = null): Promise<any> =>
        pick(
          () => browser.storage.local.get(keys),
          () => callChrome<any>(chrome.storage.local.get.bind(chrome.storage.local), keys)
        ),

      set: (items: Record<string, any>): Promise<void> =>
        pick(
          () => browser.storage.local.set(items),
          () => callChrome<void>(chrome.storage.local.set.bind(chrome.storage.local), items)
        ),

      remove: (keys: string | string[]): Promise<void> =>
        pick(
          () => browser.storage.local.remove(keys),
          () => callChrome<void>(chrome.storage.local.remove.bind(chrome.storage.local), keys)
        ),

      getBytesInUse: (keys: string | string[] | null = null): Promise<number> =>
        pick(
          () => browser.storage.local.getBytesInUse(keys),
          () => callChrome<number>(chrome.storage.local.getBytesInUse.bind(chrome.storage.local), keys)
        ),

      clear: (): Promise<void> =>
        pick(
          () => browser.storage.local.clear(),
          () => callChrome<void>(chrome.storage.local.clear.bind(chrome.storage.local))
        )
    },

    // ─── ADDITION #3: onChanged subscription ───────────────────────────────
    // Event-based, not callback-based — same shape on both browsers.
    // Returns an unsubscribe function so React effects can clean up.
    //
    // Usage:
    //   const unsubscribe = browserApi.storage.onChanged.addListener(changes => {
    //     if (changes.recall_theme) { ... }
    //   })
    //   return () => unsubscribe()
    onChanged: {
      addListener: (
        cb: (changes: StorageChanges, areaName: string) => void
      ): (() => void) => {
        const firefoxCb = cb;
        const chromeCb = cb as (changes: StorageChanges, areaName: string) => void;

        if (isFirefox) {
          const api = browser.storage.onChanged;
          api.addListener(firefoxCb);
          return () => api.removeListener(firefoxCb);
        } else {
          const api = chrome.storage.onChanged;
          api.addListener(chromeCb);
          return () => api.removeListener(chromeCb);
        }
      },
    },
  },

  tabs: {
    create: (options: { url: string; windowId?: number; active?: boolean }): Promise<BrowserTab> =>
      pick(
        () => browser.tabs.create(options),
        () => callChrome<BrowserTab>(chrome.tabs.create.bind(chrome.tabs), options)
      ),

    query: (options: { active?: boolean; currentWindow?: boolean }): Promise<BrowserTab[]> =>
      pick(
        () => browser.tabs.query(options),
        () => callChrome<BrowserTab[]>(chrome.tabs.query.bind(chrome.tabs), options)
      )
  },

  windows: {
    getCurrent: (options?: { populate?: boolean }): Promise<BrowserWindow> =>
      pick(
        () => browser.windows.getCurrent(options),
        () => callChrome<BrowserWindow>(chrome.windows.getCurrent.bind(chrome.windows), options)
      ),

    create: (options: { url: string; incognito?: boolean; type?: string }): Promise<BrowserWindow> =>
      pick(
        () => browser.windows.create(options),
        () => callChrome<BrowserWindow>(chrome.windows.create.bind(chrome.windows), options)
      )
  },

  extension: {
    isAllowedIncognitoAccess: (): Promise<boolean> =>
      pick(
        () => browser.extension.isAllowedIncognitoAccess(),
        () => callChrome<boolean>(chrome.extension.isAllowedIncognitoAccess.bind(chrome.extension))
      )
  },

  bookmarks: {
    getTree: (): Promise<BookmarkTreeNode[]> =>
      pick(
        () => browser.bookmarks.getTree() as Promise<BookmarkTreeNode[]>,
        () => callChrome<BookmarkTreeNode[]>(chrome.bookmarks.getTree.bind(chrome.bookmarks))
      ),

    create: (node: { title?: string; url?: string; parentId?: string }): Promise<BookmarkTreeNode> =>
      pick(
        () => browser.bookmarks.create(node) as Promise<BookmarkTreeNode>,
        () => callChrome<BookmarkTreeNode>(chrome.bookmarks.create.bind(chrome.bookmarks), node)
      ),

    update: (id: string, changes: { title?: string; url?: string }): Promise<BookmarkTreeNode> =>
      pick(
        () => browser.bookmarks.update(id, changes) as Promise<BookmarkTreeNode>,
        () => callChrome<BookmarkTreeNode>(chrome.bookmarks.update.bind(chrome.bookmarks), id, changes)
      ),

    remove: (id: string): Promise<void> =>
      pick(
        () => browser.bookmarks.remove(id),
        () => callChrome<void>(chrome.bookmarks.remove.bind(chrome.bookmarks), id)
      ),

    removeTree: (id: string): Promise<void> =>
      pick(
        () => browser.bookmarks.removeTree(id),
        () => callChrome<void>(chrome.bookmarks.removeTree.bind(chrome.bookmarks), id)
      ),
  },

  runtime: {
    // Synchronous in both — no callback/promise involved.
    getURL: (path: string): string => {
      const runtime = isFirefox ? browser.runtime : chrome.runtime;
      return runtime.getURL(path);
    },
    getVersion: (): string => {
      const runtime = isFirefox ? browser.runtime : chrome.runtime;
      const anyRuntime = runtime as any;
      try {
        if (typeof anyRuntime.getVersion === "function") {
          return anyRuntime.getVersion();
        }
      } catch {
        /* fall through */
      }
      return runtime.getManifest().version;
    },
  },

  // ---- Permissions: needed for the unlimitedStorage on/off toggle ----
  permissions: {
    contains: (request: PermissionsRequest): Promise<boolean> =>
      pick(
        () => browser.permissions.contains(request),
        () => callChrome<boolean>(chrome.permissions.contains.bind(chrome.permissions), request)
      ),

    request: (request: PermissionsRequest): Promise<boolean> =>
      pick(
        () => browser.permissions.request(request),
        () => callChrome<boolean>(chrome.permissions.request.bind(chrome.permissions), request)
      ),

    remove: (request: PermissionsRequest): Promise<boolean> =>
      pick(
        () => browser.permissions.remove(request),
        () => callChrome<boolean>(chrome.permissions.remove.bind(chrome.permissions), request)
      )
  },

  // ---- Alarms ----
  //
  // Used by the vault's auto-lock timer. `chrome.alarms.create` is
  // synchronous and takes NO callback — `callChrome` would hang forever
  // waiting for one that never fires. So `create` gets a bespoke wrapper.
  //
  // `clear` and `clearAll` DO accept callbacks in Chrome, so they use the
  // normal path.
  //
  // Minimum delay gotcha: Chrome clamps any delay below 30 seconds
  // (unpacked) or 60 seconds (packed, i.e. from the Web Store) up to that
  // floor. Firefox does not. A 5-minute vault auto-lock is fine on both;
  // a 5-second test value will silently become 30s on Chrome.
  alarms: {
    create: (name: string, info: AlarmCreateInfo): Promise<void> =>
      pick(
        () => browser.alarms.create(name, info),
        () =>
          new Promise<void>((resolve, reject) => {
            try {
              chrome.alarms.create(name, info);
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          })
      ),

    clear: (name: string): Promise<boolean> =>
      pick(
        () => browser.alarms.clear(name),
        () => callChrome<boolean>(chrome.alarms.clear.bind(chrome.alarms), name)
      ),

    clearAll: (): Promise<boolean> =>
      pick(
        () => browser.alarms.clearAll(),
        () => callChrome<boolean>(chrome.alarms.clearAll.bind(chrome.alarms))
      ),

    get: (name: string): Promise<Alarm | undefined> =>
      pick(
        () => browser.alarms.get(name) as Promise<Alarm | undefined>,
        () => callChrome<Alarm | undefined>(chrome.alarms.get.bind(chrome.alarms), name)
      ),

    getAll: (): Promise<Alarm[]> =>
      pick(
        () => browser.alarms.getAll() as Promise<Alarm[]>,
        () => callChrome<Alarm[]>(chrome.alarms.getAll.bind(chrome.alarms))
      ),

    /**
     * Subscribe to alarm firings. Returns an unsubscribe function so callers
     * can clean up in a React effect or service-worker teardown without
     * having to hold onto the exact callback reference.
     */
    onAlarm: {
      addListener: (
        cb: (alarm: Alarm) => void
      ): (() => void) => {
        const api = isFirefox ? browser.alarms : chrome.alarms;
        api.onAlarm.addListener(cb);
        return () => api.onAlarm.removeListener(cb);
      },
    },
  },
};

export default browserApi;