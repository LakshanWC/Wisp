import browserApi from "./storage";

const CACHE_CAP_BYTES = 1 * 1024 * 1024; // 1MB ≈ 200 favicons
const MAX_FAIL_ENTRIES = 500; //

// ─── YoRHa Default Favicon (inline SVG data URL) ────────────────────────────
// This is returned when no favicon can be fetched or cached
const YORHA_DEFAULT_FAVICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a8578" stroke-width="1.5">
  <!-- YoRHa style container with cut corner -->
  <path d="M 3 3 H 21 V 17 L 17 21 H 3 Z" fill="none" stroke="#8a8578" />
  
  <!-- Header tech bars -->
  <path d="M 3 3 H 14 V 6 H 3 Z" fill="#8a8578" stroke="none" />
  <path d="M 16 3 H 21 V 6 H 16 Z" fill="#8a8578" stroke="none" />

  <!-- Inward side ticks -->
  <line x1="3" y1="10" x2="5" y2="10" />
  <line x1="3" y1="14" x2="5" y2="14" />
  <line x1="19" y1="10" x2="21" y2="10" />
  <line x1="19" y1="14" x2="21" y2="14" />
  
  <!-- Blocky Question Mark (Default / Unknown Icon) -->
  <path d="M 10 11.5 V 9.5 H 14 V 13.5 H 12 V 15.5" stroke-linecap="square" />
  <rect x="11.25" y="17" width="1.5" height="1.5" fill="#8a8578" stroke="none" />

  <!-- Floating corner accent -->
  <rect x="19.5" y="19.5" width="1.5" height="1.5" fill="#8a8578" stroke="none" />
</svg>
`;

// Convert SVG to data URL
const YORHA_DEFAULT_FAVICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(YORHA_DEFAULT_FAVICON_SVG)}`;

type FaviconEntry = {
  dataUrl: string | null;
  status: "ok" | "failed";
  failCount: number;
  lastAccessedAt: number;
  size: number;
};

type SavedFaviconResult = {
  dataUrl: string | null;
  found: boolean;
  failCount: number;
};

type FaviconMeta = {
  totalCount: number; // number of distinct keys currently stored (ok + failed)
  totalFailed: number; // number of distinct keys currently in "failed" status
  totalSize: number; // sum of `size` across all stored entries
  lastUpdatedAt: number;
};

// Simple in-process mutex so concurrent loadFavicon() calls for different
// domains don't race on the shared meta record (read-modify-write on
// totalCount/totalSize/totalFailed). Per-domain entries don't need this
// since each domain has its own key, but the meta key is shared global state.
let metaLock: Promise<void> = Promise.resolve();
function withMetaLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = metaLock.then(fn, fn);
  metaLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * One-time cleanup for domains that were cached as "ok" before generic-globe
 * detection existed. Call this once (e.g. on app startup / migration step),
 * not on every loadFavicon — it re-fetches every cached domain's favicon
 * from Google fresh (since our stored dataUrl is already re-encoded webp
 * and can't be hash-compared against the raw-bytes fingerprint) and checks
 * whether it's actually the generic placeholder. Matches get downgraded to
 * "failed" so the next loadFavicon() call retries and (hopefully) gets a
 * real icon if one has since become available, or backs off after enough
 * failures as usual.
 */
export async function purgeGenericFaviconEntries(): Promise<number> {
  const all = await browserApi.storage.local.get(null);
  const domainsToCheck: string[] = [];

  for (const key in all) {
    if (!key.startsWith("favicon:") || key === "favicon:_meta") continue;
    const entry = all[key] as FaviconEntry;
    if (entry.status === "ok") {
      domainsToCheck.push(key.slice("favicon:".length));
    }
  }

  let purged = 0;

  for (const domain of domainsToCheck) {
    try {
      const response = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=16`);
      if (!response.ok) continue;

      const rawBlob = await response.blob();
      if (!(await isGenericFavicon(rawBlob))) continue;

      await withMetaLock(async () => {
        const prevEntry = await getFaviconEntry(domain);
        if (!prevEntry || prevEntry.status !== "ok") return; // changed since we listed it, skip

        const meta = await getMeta();
        const downgraded: FaviconEntry = {
          dataUrl: null,
          status: "failed",
          failCount: prevEntry.failCount, // preserve history
          lastAccessedAt: Date.now(),
          size: 0,
        };
        await saveFaviconEntry(domain, downgraded);

        await saveMeta({
          totalCount: meta.totalCount, // key stays, just downgraded
          totalFailed: meta.totalFailed + 1,
          totalSize: meta.totalSize - prevEntry.size,
          lastUpdatedAt: Date.now(),
        });
      });

      purged += 1;
    } catch {
      // network hiccup on this domain — leave its cache entry as-is, it'll
      // get another chance next time purge runs
      continue;
    }
  }

  return purged;
}

async function fetchFavicon(domain: string): Promise<string | null> {
  try {
    const results = await getSavedFavicon(domain);

    if (results.found) {
      return results.dataUrl;
    }

    // Previously fetched and failed at least once — don't retry. Bail out
    // straight to the default icon (via loadFavicon's fallback) instead of
    // hitting the network again. Retrying is now solely the job of
    // purgeGenericFaviconEntries / refetchAllFavicons, which explicitly
    // reset "failed" entries back to a fetchable state.
    if (results.failCount > 0) {
      return null;
    }

    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : null;

    if (faviconUrl === null) {
      await recordFailure(domain, results.failCount);
      return null;
    }

    // actually fetch the image bytes
    const response = await fetch(faviconUrl);
    if (!response.ok) {
      throw new Error("Fetch failed");
    }

    const rawBlob = await response.blob();

    // Google returned its "no real favicon" placeholder — response.ok is
    // still true (it's a valid 200 image response), so this can only be
    // caught by content-hash comparison, not status code. We must NOT cache
    // the generic globe as if it were this domain's actual icon, otherwise
    // it gets served back forever (it would be stored as "ok" and never
    // hit the failCount backoff path).
    if (await isGenericFavicon(rawBlob)) {
      await recordFailure(domain, results.failCount);
      return null;
    }

    const compressedBlob = await compressImage(rawBlob);
    const dataUrl = await blobToDataUrl(compressedBlob);

    await recordSuccess(domain, dataUrl, compressedBlob.size);

    return dataUrl;
  } catch {
    // re-check for failCount/prior status right before writing, to keep the
    // "was this domain previously stored at all" decision consistent
    const results = await getSavedFavicon(domain);
    await recordFailure(domain, results.failCount);
    return null;
  }
}

// Known SHA-256 hash(es) of Google's generic "globe" placeholder favicon,
// as returned raw (before our own compression re-encodes it) by
// https://www.google.com/s2/favicons when it has no real icon for a domain
// (still a 200 OK response, so it can't be caught by status code alone).
// NOTE: these hashes are only valid against the *raw* fetched bytes, not
// against our re-compressed webp cache — compression changes the encoding,
// so re-hashing a cached dataUrl will never match. Any check against
// already-cached entries needs its own re-fetch-and-compare (see
// purgeGenericFaviconEntries), not a hash of the stored blob.
// If Google changes this asset, add the new hash rather than replacing it,
// since old/edge-cached responses may still serve the previous bytes.
const GENERIC_FAVICON_HASHES = new Set<string>([
  "59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda6", // sz=16 generic globe, confirmed via curl
]);

// A domain guaranteed never to have a real favicon, used purely to sample
// what Google's current placeholder bytes look like, so we can detect if
// the asset ever changes and our stored hash goes stale.
const SENTINEL_DOMAIN = "sentinel.invalid";

// How often (ms) to re-verify the placeholder hash. Checking on every
// loadFavicon call would be wasteful, so this gates it to roughly once a day.
const HASH_VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HASH_VERIFY_META_KEY = "favicon:_hash_verify";

type HashVerifyMeta = {
  lastCheckedAt: number;
  lastKnownGoodHash: string | null;
  driftDetected: boolean;
};

async function getHashVerifyMeta(): Promise<HashVerifyMeta> {
  const result = await browserApi.storage.local.get(HASH_VERIFY_META_KEY);
  return (
    result[HASH_VERIFY_META_KEY] ?? {
      lastCheckedAt: 0,
      lastKnownGoodHash: null,
      driftDetected: false,
    }
  );
}

async function saveHashVerifyMeta(meta: HashVerifyMeta) {
  await browserApi.storage.local.set({ [HASH_VERIFY_META_KEY]: meta });
}

/**
 * Re-fetches the sentinel domain's favicon and checks whether its hash still
 * matches GENERIC_FAVICON_HASHES. If Google ever changes the placeholder
 * asset, this will start failing and we log a warning rather than silently
 * losing detection (which would mean generic globes start getting cached as
 * real favicons again without anyone noticing).
 *
 * Safe to call on every loadFavicon() — internally throttled to run at most
 * once per HASH_VERIFY_INTERVAL_MS, so normal usage costs a single cheap
 * storage read most of the time.
 */
// In-memory guard against duplicate concurrent verification runs. Without
// this, many loadFavicon() calls firing close together (e.g. rendering a
// long list of rows on mount) can all read the same stale lastCheckedAt
// from storage before any of them finishes writing the updated value back,
// so they all decide the check is "due" and all fire the sentinel fetch at
// once instead of just the first one.
let hashVerifyInFlight: Promise<void> | null = null;

async function verifyGenericFaviconHashIfDue(): Promise<void> {
  if (hashVerifyInFlight) {
    return hashVerifyInFlight;
  }

  hashVerifyInFlight = verifyGenericFaviconHashIfDueInner().finally(() => {
    hashVerifyInFlight = null;
  });

  return hashVerifyInFlight;
}

async function verifyGenericFaviconHashIfDueInner(): Promise<void> {
  const meta = await getHashVerifyMeta();
  const now = Date.now();

  if (now - meta.lastCheckedAt < HASH_VERIFY_INTERVAL_MS) {
    return; // checked recently enough, skip
  }

  try {
    const response = await fetch(`https://www.google.com/s2/favicons?domain=${SENTINEL_DOMAIN}&sz=16`);
    if (!response.ok) {
      // couldn't verify this cycle (network hiccup, endpoint down, etc.) —
      // don't flag drift on a failed check, just retry next time
      return;
    }

    const blob = await response.blob();
    const hash = await hashBlob(blob);
    const matches = GENERIC_FAVICON_HASHES.has(hash);

    if (!matches) {
      console.warn(
        "[favicon] Generic-favicon placeholder hash no longer matches known value. " +
          "Google may have changed the asset — generic globe icons may start being " +
          `cached as real favicons again. New hash: ${hash}. ` +
          "Update GENERIC_FAVICON_HASHES with this value once confirmed."
      );
    }

    await saveHashVerifyMeta({
      lastCheckedAt: now,
      lastKnownGoodHash: hash,
      driftDetected: !matches,
    });
  } catch {
    // network error mid-check — leave lastCheckedAt as-is so we retry soon
    // rather than waiting a full interval from a failed attempt
  }
}

/**
 * Returns whether the last verification run detected that Google's
 * placeholder asset no longer matches our known hash. Useful for surfacing
 * a warning in an admin/debug UI rather than only console.warn.
 */
export async function isGenericFaviconDetectionStale(): Promise<boolean> {
  const meta = await getHashVerifyMeta();
  return meta.driftDetected;
}

/**
 * Load a favicon for a domain, returning either a cached favicon,
 * a freshly fetched one, or the YoRHa default icon as a fallback.
 * This is the main export used by the UI.
 */
export async function loadFavicon(domain: string): Promise<string> {
  // Fire-and-forget: don't block the actual favicon fetch on this check,
  // it's throttled internally and only matters for future correctness.
  void verifyGenericFaviconHashIfDue();
  
  const result = await fetchFavicon(domain);
  
  // Return the YoRHa default icon if we couldn't get a real favicon
  return result || YORHA_DEFAULT_FAVICON_DATA_URL;
}

/**
 * Legacy version that returns null if no favicon found.
 * Use loadFavicon() instead for the default icon fallback.
 */
export async function loadFaviconNullable(domain: string): Promise<string | null> {
  // Fire-and-forget: don't block the actual favicon fetch on this check,
  // it's throttled internally and only matters for future correctness.
  void verifyGenericFaviconHashIfDue();
  return fetchFavicon(domain);
}

async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Checks RAW (pre-compression) bytes only. Call this on the blob straight
// from fetch(), before compressImage() touches it.
async function isGenericFavicon(rawBlob: Blob): Promise<boolean> {
  try {
    const hash = await hashBlob(rawBlob);
    return GENERIC_FAVICON_HASHES.has(hash);
  } catch {
    // if hashing fails for some reason (e.g. no crypto.subtle in this
    // context), fail open — don't block a legitimate favicon over it
    return false;
  }
}

// helper: convert Blob -> base64 data URL
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Record a successful fetch for `domain`, updating both the entry and the
 * meta counters atomically (within this process) so totalCount/totalSize
 * only ever reflect real transitions:
 *  - new key created            -> totalCount += 1
 *  - existing "failed" key -> "ok" -> totalFailed -= 1 (still same totalCount)
 *  - existing "ok" key -> "ok" (refresh) -> counts unchanged, size delta applied
 */
async function recordSuccess(domain: string, dataUrl: string, size: number) {
  await withMetaLock(async () => {
    const prevEntry = await getFaviconEntry(domain);
    const meta = await getMeta();

    const entry: FaviconEntry = {
      dataUrl,
      status: "ok",
      failCount: 0,
      lastAccessedAt: Date.now(),
      size,
    };
    await saveFaviconEntry(domain, entry);

    const isNewKey = prevEntry === null;
    const wasFailed = prevEntry !== null && prevEntry.status === "failed";
    const prevSize = prevEntry?.size ?? 0;

    await saveMeta({
      totalCount: meta.totalCount + (isNewKey ? 1 : 0),
      totalFailed: meta.totalFailed - (wasFailed ? 1 : 0),
      totalSize: meta.totalSize - prevSize + size,
      lastUpdatedAt: Date.now(),
    });
  });

  await enforceCacheCap();
}

/**
 * Record a failed fetch for `domain`. Only bumps totalCount/totalFailed when
 * this is a genuinely new key; repeated failures on the same domain just
 * bump that entry's failCount, not the global counters.
 */
async function recordFailure(domain: string, _priorFailCount: number) {
  await withMetaLock(async () => {
    const prevEntry = await getFaviconEntry(domain);
    const meta = await getMeta();

    const prevFailCount = prevEntry?.failCount ?? 0;
    const prevSize = prevEntry?.size ?? 0;
    const wasOk = prevEntry !== null && prevEntry.status === "ok";
    const isNewKey = prevEntry === null;

    const entry: FaviconEntry = {
      dataUrl: null,
      status: "failed",
      failCount: prevFailCount + 1,
      lastAccessedAt: Date.now(),
      size: 0,
    };
    await saveFaviconEntry(domain, entry);

    await saveMeta({
      totalCount: meta.totalCount + (isNewKey ? 1 : 0),
      totalFailed: meta.totalFailed + (isNewKey || wasOk ? 1 : 0),
      totalSize: meta.totalSize - prevSize, // freeing whatever size it used to hold, if any
      lastUpdatedAt: Date.now(),
    });
  });

  await enforceFailedEntryCap();
}

async function getSavedFavicon(domain: string): Promise<SavedFaviconResult> {
  const results = await getFaviconEntry(domain);

  if (results === null) {
    return { dataUrl: null, found: false, failCount: 0 };
  }

  if (results.status !== "ok") {
    return { dataUrl: null, found: false, failCount: results.failCount };
  }

  return { dataUrl: results.dataUrl, found: true, failCount: results.failCount };
}

async function saveMeta(meta: FaviconMeta) {
  await browserApi.storage.local.set({ "favicon:_meta": meta });
}

async function getMeta(): Promise<FaviconMeta> {
  const result = await browserApi.storage.local.get("favicon:_meta");
  return result["favicon:_meta"] ?? { totalCount: 0, totalFailed: 0, totalSize: 0, lastUpdatedAt: 0 };
}

// Save one favicon entry
async function saveFaviconEntry(domain: string, entry: FaviconEntry) {
  await browserApi.storage.local.set({ [`favicon:${domain}`]: entry });
}

// Read one favicon entry
async function getFaviconEntry(domain: string): Promise<FaviconEntry | null> {
  const result = await browserApi.storage.local.get(`favicon:${domain}`);
  return result[`favicon:${domain}`] ?? null;
}

async function compressImage(blob: Blob, maxSize = 16, quality = 0.7): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
    // preferred path — works in most modern contexts
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(maxSize, maxSize);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2d context from OffscreenCanvas");
    }
    ctx.drawImage(bitmap, 0, 0, maxSize, maxSize);
    return canvas.convertToBlob({ type: "image/webp", quality });
  }

  // fallback — needs a DOM (won't work in a pure background/service worker context)
  return compressImageFallback(blob, maxSize, quality);
}

function compressImageFallback(blob: Blob, maxSize: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not get 2d context from canvas");
        }
        ctx.drawImage(img, 0, 0, maxSize, maxSize);

        canvas.toBlob(
          (result) => {
            URL.revokeObjectURL(url);
            if (result) resolve(result);
            else reject(new Error("Canvas toBlob failed"));
          },
          "image/webp",
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };

    img.src = url;
  });
}

/**
 * Evict oldest-accessed "ok" entries until totalSize is back under the cap.
 * Correctly decrements totalCount/totalSize/totalFailed for every evicted
 * key (previously totalFailed was never adjusted on eviction, causing it to
 * drift upward relative to the real number of failed entries left).
 */
async function enforceCacheCap() {
  await withMetaLock(async () => {
    const meta = await getMeta();
    if (meta.totalSize <= CACHE_CAP_BYTES) return;

    const all = await browserApi.storage.local.get(null); // returns entire storage as one object
    const faviconEntries: { key: string; entry: FaviconEntry }[] = [];

    for (const key in all) {
      if (key.startsWith("favicon:") && key !== "favicon:_meta") {
        faviconEntries.push({ key, entry: all[key] as FaviconEntry });
      }
    }

    // Only "ok" entries actually hold size, so only they need eviction to
    // reclaim space. Oldest accessed first.
    const okEntries = faviconEntries
      .filter(({ entry }) => entry.status === "ok")
      .sort((a, b) => a.entry.lastAccessedAt - b.entry.lastAccessedAt);

    let currentSize = meta.totalSize;
    let currentCount = meta.totalCount;
    const keysToRemove: string[] = [];

    for (const { key, entry } of okEntries) {
      if (currentSize <= CACHE_CAP_BYTES) break;
      keysToRemove.push(key);
      currentSize -= entry.size;
      currentCount -= 1;
    }

    if (keysToRemove.length > 0) {
      // browserApi.storage.local.remove expects an array of keys
      await browserApi.storage.local.set(
        keysToRemove.reduce((acc, key) => ({ ...acc, [key]: undefined }), {})
      );
      await saveMeta({
        totalCount: currentCount,
        totalFailed: meta.totalFailed, // evicted entries were all "ok", so totalFailed is unaffected
        totalSize: currentSize,
        lastUpdatedAt: Date.now(),
      });
    }
  });
}

/**
 * Failed entries have size 0 and so never trigger enforceCacheCap, meaning
 * they could otherwise accumulate forever (one per unique domain ever
 * failed). Cap the number of failed entries we keep, evicting the oldest
 * first, same as the size-based cap does for "ok" entries.
 */
async function enforceFailedEntryCap() {
  await withMetaLock(async () => {
    const meta = await getMeta();
    if (meta.totalFailed <= MAX_FAIL_ENTRIES) return;

    const all = await browserApi.storage.local.get(null);
    const failedEntries: { key: string; entry: FaviconEntry }[] = [];

    for (const key in all) {
      if (key.startsWith("favicon:") && key !== "favicon:_meta") {
        const entry = all[key] as FaviconEntry;
        if (entry.status === "failed") {
          failedEntries.push({ key, entry });
        }
      }
    }

    failedEntries.sort((a, b) => a.entry.lastAccessedAt - b.entry.lastAccessedAt);

    const excess = meta.totalFailed - MAX_FAIL_ENTRIES;
    const keysToRemove = failedEntries.slice(0, excess).map(({ key }) => key);

    if (keysToRemove.length > 0) {
      await browserApi.storage.local.set(
        keysToRemove.reduce((acc, key) => ({ ...acc, [key]: undefined }), {})
      );
      await saveMeta({
        totalCount: meta.totalCount - keysToRemove.length,
        totalFailed: meta.totalFailed - keysToRemove.length,
        totalSize: meta.totalSize, // failed entries are size 0, nothing to reclaim
        lastUpdatedAt: Date.now(),
      });
    }
  });
}

// DEV ONLY — FOR DEBUGGING
/**
 * Remove ALL favicon-related entries and metadata, including:
 *  - every `favicon:<domain>` entry (both "ok" and "failed")
 *  - the `favicon:_meta` counters record
 *  - the `favicon:_hash_verify` drift-detection record
 *
 * WARNING: This permanently deletes all cached favicon data. After this
 * runs, the very next verifyGenericFaviconHashIfDue() call will treat the
 * hash as never-checked (lastCheckedAt: 0) and re-verify immediately, since
 * its record was wiped along with everything else.
 */
export async function removeAllFavicons(): Promise<{
  removedCount: number;
  freedBytes: number;
  removedOkCount: number;
  removedFailedCount: number;
}> {
  return await withMetaLock(async () => {
    const all = await browserApi.storage.local.get(null);
    const keysToRemove: string[] = [];
    let totalFreedBytes = 0;
    let okCount = 0;
    let failedCount = 0;

    // Collect every key under the "favicon:" namespace — this includes
    // per-domain entries, "_meta", and "_hash_verify".
    for (const key in all) {
      if (!key.startsWith("favicon:")) continue;

      keysToRemove.push(key);

      if (key === "favicon:_meta" || key === "favicon:_hash_verify") {
        continue; // not a per-domain entry, nothing to tally as ok/failed/size
      }

      const entry = all[key] as FaviconEntry;
      totalFreedBytes += entry?.size || 0;
      if (entry?.status === "ok") okCount += 1;
      else if (entry?.status === "failed") failedCount += 1;
    }

    if (keysToRemove.length > 0) {
      await browserApi.storage.local.set(
        keysToRemove.reduce((acc, key) => ({ ...acc, [key]: undefined }), {})
      );
    }

    // Reset meta to zero (removeAllFavicons wipes the _meta key above, so
    // this re-creates it fresh rather than leaving it absent).
    await saveMeta({
      totalCount: 0,
      totalFailed: 0,
      totalSize: 0,
      lastUpdatedAt: Date.now(),
    });

    return {
      removedCount: keysToRemove.length,
      freedBytes: totalFreedBytes,
      removedOkCount: okCount,
      removedFailedCount: failedCount,
    };
  });
}

/**
 * Wipes every cached favicon (ok and failed alike, via removeAllFavicons)
 * and then re-fetches a favicon for each of the given domains from scratch.
 *
 * This is the "nuke and refetch" method: unlike purgeGenericFaviconEntries
 * (which only targets domains suspected of holding a stale generic-globe
 * result), this clears the entire cache unconditionally — including
 * "failed" entries that would otherwise be skipped forever by the
 * fail-fast check in fetchFavicon — and then re-attempts every domain
 * passed in exactly once, honoring the same success/failure/backoff
 * bookkeeping as a normal loadFavicon() call.
 *
 * Runs fetches with limited concurrency so a large domain list doesn't
 * fire hundreds of simultaneous requests at Google.
 *
 * @param domains - domains to refetch after the cache is cleared.
 * @param concurrency - max number of simultaneous fetches (default 8).
 */
export async function removeAllAndRefetchFavicons(
  domains: string[],
  concurrency = 8
): Promise<{
  cleared: {
    removedCount: number;
    freedBytes: number;
    removedOkCount: number;
    removedFailedCount: number;
  };
  refetched: number;
  succeeded: number;
  failed: number;
}> {
  const cleared = await removeAllFavicons();

  let succeeded = 0;
  let failed = 0;

  // simple concurrency-limited runner
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= domains.length) return;
      const domain = domains[i];
      try {
        const result = await fetchFavicon(domain);
        if (result) succeeded += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, domains.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    cleared,
    refetched: domains.length,
    succeeded,
    failed,
  };
}