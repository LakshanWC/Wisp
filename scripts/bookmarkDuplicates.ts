// bookmarkDuplicates.ts
// Detects duplicate bookmarks at two levels:
//   1. Exact  — identical URLs (after basic trimming)
//   2. Similar — same page after normalizing away www, http/https, trailing
//                slashes, fragments, and common tracking parameters

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DuplicateGroup {
  key: string          // the normalised URL used to group
  bookmarks: any[]     // the actual bookmark objects
}

export interface DuplicateResult {
  exact:   DuplicateGroup[]
  similar: DuplicateGroup[]  // excludes groups already in exact
}

//#region ─── Tracking / noise params to strip ───────────────

const STRIP_PARAMS = new Set([
  // UTM
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  // Social / ad networks
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  "msclkid", "twclid", "igshid", "ttclid",
  // Generic referrers
  "ref", "referer", "referrer", "source", "src", "campaign",
  "affiliate", "partner", "promo", "coupon",
  // Analytics noise
  "_ga", "_gl", "mc_cid", "mc_eid",
  // Misc
  "feature", "app", "from", "via",
])
//#endregion

//#region ─── URL normalisation ───────

export function normaliseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return raw.trim().toLowerCase()
  }

  // 1. Force https
  url.protocol = "https:"

  // 2. Lowercase + strip www
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "")

  // 3. Strip tracking params
  const toDelete: string[] = []
  url.searchParams.forEach((_, key) => {
    if (STRIP_PARAMS.has(key.toLowerCase())) toDelete.push(key)
  })
  toDelete.forEach(k => url.searchParams.delete(k))

  // 4. Sort remaining params for stable comparison
  url.searchParams.sort()

  // 5. Strip trailing slash from path (but keep root "/")
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1)
  }

  // 6. Strip fragment
  url.hash = ""

  return url.toString()
}
//#endregion

//#region ─── Core detection ──────────

export function findDuplicates(bookmarks: any[]): DuplicateResult {
  const httpBookmarks = bookmarks.filter(b =>
    b.url?.startsWith("http://") || b.url?.startsWith("https://")
  )

  // ── Exact duplicates ──────────────────────────────────────────────────────
  const exactMap = new Map<string, any[]>()
  for (const b of httpBookmarks) {
    const key = b.url.trim()
    if (!exactMap.has(key)) exactMap.set(key, [])
    exactMap.get(key)!.push(b)
  }
  const exact: DuplicateGroup[] = []
  const exactUrls = new Set<string>()   // track which URLs are already in exact
  for (const [key, bms] of exactMap) {
    if (bms.length > 1) {
      exact.push({ key, bookmarks: bms })
      bms.forEach(b => exactUrls.add(b.url.trim()))
    }
  }

  // ── Similar duplicates ────────────────────────────────────────────────────
  // Only include bookmarks not already caught by exact
  const similarCandidates = httpBookmarks.filter(b => !exactUrls.has(b.url.trim()))

  const similarMap = new Map<string, any[]>()
  for (const b of similarCandidates) {
    const key = normaliseUrl(b.url)
    if (!similarMap.has(key)) similarMap.set(key, [])
    similarMap.get(key)!.push(b)
  }
  const similar: DuplicateGroup[] = []
  for (const [key, bms] of similarMap) {
    if (bms.length > 1) similar.push({ key, bookmarks: bms })
  }

  // Sort each group oldest-first so the "original" is at the top
  const byDate = (a: any, b: any) => (a.date ?? 0) - (b.date ?? 0)
  exact.forEach(g   => g.bookmarks.sort(byDate))
  similar.forEach(g => g.bookmarks.sort(byDate))

  // Sort groups by size descending (worst offenders first)
  exact.sort((a, b)   => b.bookmarks.length - a.bookmarks.length)
  similar.sort((a, b) => b.bookmarks.length - a.bookmarks.length)

  return { exact, similar }
}
//#endregion

//#region ─── Helpers ─────────

export function totalDuplicateCount(result: DuplicateResult): number {
  // Count the "extra" copies — i.e. total bookmarks minus one per group
  const countExtras = (groups: DuplicateGroup[]) =>
    groups.reduce((sum, g) => sum + g.bookmarks.length - 1, 0)
  return countExtras(result.exact) + countExtras(result.similar)
}
//#endregion