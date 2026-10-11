// bookmarkHealth.ts
// Checks whether bookmark URLs are reachable and persists results.
//
// Storage key: "bookmark_health"
// Shape: Record<url, HealthRecord>
import browserApi from "./storage"
export const HealthStatus = {
  Ok:           "ok",
  Live:         "ok",
  Dead:         "dead",
  Redirect:     "redirect",
  Pending:      "pending",
  Unchecked:    "unchecked",
  Unverifiable: "unverifiable",
} as const

export type HealthStatus = typeof HealthStatus[keyof typeof HealthStatus]


export interface HealthRecord {
  status: HealthStatus
  checkedAt: number   // ms timestamp
  statusCode?: number // if available
}

export type HealthStore = Record<string, HealthRecord>

const STORAGE_KEY = "bookmark_health"
const INSTALLED_KEY = "wisp.health.installedAt"
const TIMEOUT_MS = 8_000

//#region ─── Persistence ────────────

export async function loadHealth(): Promise<HealthStore> {
  const result = await browserApi.storage.local.get(STORAGE_KEY)
  return (result?.[STORAGE_KEY] as HealthStore) ?? {}
}

export async function saveHealth(store: HealthStore): Promise<void> {
  await browserApi.storage.local.set({ [STORAGE_KEY]: store })
}

export async function clearHealth(): Promise<void> {
  await browserApi.storage.local.remove(STORAGE_KEY)
}
//#endregion

// ─── Single URL check ────────────────────────────────────────────────────────
//
// Strategy:
//   1. Try GET with no-cors — an opaque response means the server responded → "ok"
//   2. A TypeError (network failure, DNS failure, etc.) → "dead"
//   3. An AbortError (timeout) → "unverifiable": the server didn't respond in
//      time, which is typical of Cloudflare/bot-protection challenges that hang
//      rather than fail. These sites may still be perfectly accessible in a
//      real browser.
//
// Note: HEAD is intentionally avoided — many servers (nginx defaults, Cloudflare)
// block HEAD requests while allowing GET.

//#region ─── checkUrl ───
export async function checkUrl(url: string): Promise<HealthRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    })
    clearTimeout(timer)
    return { status: "ok", checkedAt: Date.now() }
  } catch {
    clearTimeout(timer)
    return { status: "unverifiable", checkedAt: Date.now() }
  }
}
//#endregion

//#region ─── Batch checker  ───────

export async function checkAllUrls(
  bookmarks: { id: string; url: string }[],
  onProgress: (store: HealthStore, done: number, total: number) => void,
  concurrency = 6,
  onlyStaleOrMissing = false,
): Promise<HealthStore> {
  const store = await loadHealth()

  const eligible = bookmarks.filter(b =>
    b.url.startsWith("http://") || b.url.startsWith("https://")
  )

  const toCheck = onlyStaleOrMissing
    ? eligible.filter(b => isStale(store[b.url]))
    : eligible

  let done = 0
  const total = toCheck.length

  if (total === 0) {
    onProgress({ ...store }, 0, 0)
    return store
  }

  for (const b of toCheck) {
    store[b.url] = { ...(store[b.url] ?? {}), status: "pending", checkedAt: Date.now() }
  }
  await saveHealth(store)
  onProgress({ ...store }, 0, total)

  for (let i = 0; i < toCheck.length; i += concurrency) {
    const chunk = toCheck.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async b => {
        const record = await checkUrl(b.url)
        store[b.url] = record
        done++
        onProgress({ ...store }, done, total)
      })
    )
    await saveHealth(store)
  }

  return store
}
//#endregion

//#region ─── Helpers ─────────

export const STALE_MS = 24 * 60 * 60 * 1000

export function isStale(record: HealthRecord | undefined): boolean {
  if (!record || record.status === "unchecked" || record.status === "pending") return true
  return Date.now() - record.checkedAt > STALE_MS
}

export interface HealthRefreshInfo {
  needsRefresh: boolean
  uncheckedCount: number
  staleCount: number
  lastCheckedAt: number | null
  totalEligible: number
}

/** Summarise whether cached health data should be refreshed. */
export function getHealthRefreshInfo(
  bookmarks: { url: string }[],
  health: HealthStore,
): HealthRefreshInfo {
  const eligible = bookmarks.filter(
    b => b.url.startsWith("http://") || b.url.startsWith("https://"),
  )

  let uncheckedCount = 0
  let staleCount = 0
  let lastCheckedAt: number | null = null

  for (const b of eligible) {
    const record = health[b.url]
    if (!record || record.status === "unchecked") {
      uncheckedCount++
    } else if (isStale(record)) {
      staleCount++
    }
    if (record?.checkedAt && record.status !== "pending" && record.status !== "unchecked") {
      lastCheckedAt = lastCheckedAt === null
        ? record.checkedAt
        : Math.max(lastCheckedAt, record.checkedAt)
    }
  }

  return {
    needsRefresh: uncheckedCount > 0 || staleCount > 0,
    uncheckedCount,
    staleCount,
    lastCheckedAt,
    totalEligible: eligible.length,
  }
}

export function filterDead(bookmarks: any[], health: HealthStore): any[] {
  return bookmarks.filter(b => health[b.url]?.status === "dead")
}

export function filterUnverifiable(bookmarks: any[], health: HealthStore): any[] {
  return bookmarks.filter(b => health[b.url]?.status === "unverifiable")
}

/** Dot color + tooltip for a given status */
export function statusDot(status: HealthStatus | undefined): {
  color: string; label: string; emoji: string
} {
  switch (status) {
    case "ok":           return { color: "#22c55e", label: "Reachable",    emoji: "🟢" }
    case "dead":         return { color: "#ef4444", label: "Unreachable",  emoji: "🔴" }
    case "redirect":     return { color: "#eab308", label: "Redirects",    emoji: "🟡" }
    case "pending":      return { color: "#71717a", label: "Checking…",    emoji: "⏳" }
    case "unverifiable": return { color: "#f97316", label: "Unverifiable", emoji: "🟠" }
    default:             return { color: "#3f3f46", label: "Not checked",  emoji: "⚪" }
  }
}
//#endregion