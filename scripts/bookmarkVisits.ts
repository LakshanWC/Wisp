// bookmarkVisits.ts
// Tracks the last time a bookmark was opened from ReCall.
// Stored in chrome.storage.local under the key "bookmark_visits".
import browserApi from "./storage"
export type VisitStore = Record<string, number> // bookmarkId → timestamp (ms)

const STORAGE_KEY = "bookmark_visits"

export async function loadVisits(): Promise<VisitStore> {
  const result = await browserApi.storage.local.get(STORAGE_KEY)
  return (result?.[STORAGE_KEY] as VisitStore) ?? {}
}

export async function recordVisit(bookmarkId: string): Promise<void> {
  const visits = await loadVisits()
  visits[bookmarkId] = Date.now()
  await browserApi.storage.local.set({ [STORAGE_KEY]: visits })
}

/**
 * Returns bookmarks that are "forgotten":
 *  - dateAdded is older than `monthsThreshold` months ago, AND
 *  - never visited via ReCall OR last visit was also older than `monthsThreshold`
 */
export function filterForgotten(
  bookmarks: any[],
  visits: VisitStore,
  monthsThreshold: number
): any[] {
  const cutoff = Date.now() - monthsThreshold * 30 * 24 * 60 * 60 * 1000
  return bookmarks.filter(b => {
    const isOld = (b.date ?? 0) < cutoff
    const lastVisit = visits[b.id] ?? 0
    const notVisitedRecently = lastVisit < cutoff
    return isOld && notVisitedRecently
  })
}

/** Human-readable relative time, e.g. "2 years ago" */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years  = Math.floor(days / 365)
  if (years  >= 1) return `${years}y ago`
  if (months >= 1) return `${months}mo ago`
  if (days   >= 1) return `${days}d ago`
  if (hours  >= 1) return `${hours}h ago`
  return `${mins}m ago`
}