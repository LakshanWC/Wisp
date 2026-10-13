import { useState, useEffect } from "react"
import browserApi from "~scripts/storage"
import type { BookmarkTreeNode } from "~scripts/storage"
import type { BrowserWindow } from "~scripts/storage"
import "styles/popup.css"
import { ThemeProvider } from "./scripts/themeProvider"
import { ThemeToggle } from "./components/themeToggle"
import "styles/themes.css"

// ─── Tile definitions ─────────────────────────────────────────────────────────

type TileId =
  | "total"
  | "topDomain"
  | "forgotten"
  | "broken"
  | "newest"
  | "lastVisit"
  | "categories"

interface TileDef {
  id: TileId
  label: string
  symbol: string
}

const ALL_TILES: TileDef[] = [
  { id: "total",      symbol: "◈", label: "Total bookmarks"  },
  { id: "topDomain",  symbol: "⊙", label: "Top domain"       },
  { id: "forgotten",  symbol: "◷", label: "Forgotten"        },
  { id: "broken",     symbol: "✕", label: "Broken links"     },
  { id: "newest",     symbol: "✦", label: "Newest bookmark"  },
  { id: "lastVisit",  symbol: "◉", label: "Last visited"     },
  { id: "categories", symbol: "⌂", label: "Unique domains"   },
]

const DEFAULT_VISIBLE: TileId[] = ["total", "topDomain", "forgotten", "broken"]
const STORAGE_KEY = "popup_tiles"

type AccentClass = "" | "is-amber" | "is-rust" | "is-sage"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function flattenBookmarks(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  const result: BookmarkTreeNode[] = []
  for (const n of nodes) {
    if (n.url) result.push(n)
    if (n.children) result.push(...flattenBookmarks(n.children))
  }
  return result
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IndexPopup() {
  return (
    <ThemeProvider>
      <PopupContent />
    </ThemeProvider>
  )
}

function PopupContent() {
  const [bookmarks, setBookmarks]       = useState<BookmarkTreeNode[]>([])
  const [health, setHealth]             = useState<Record<string, { status: string }>>({})
  const [visits, setVisits]             = useState<Record<string, number>>({})
  const [visibleTiles, setVisibleTiles] = useState<TileId[]>(DEFAULT_VISIBLE)
  const [editMode, setEditMode]         = useState(false)
  const [loaded, setLoaded]             = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [tree, result] = await Promise.all([
          browserApi.bookmarks.getTree(),
          browserApi.storage.local.get(["bookmark_health", "bookmark_visits", STORAGE_KEY]),
        ])

        if (cancelled) return

        setBookmarks(flattenBookmarks(tree ?? []))
        if (result.bookmark_health) setHealth(result.bookmark_health)
        if (result.bookmark_visits) setVisits(result.bookmark_visits)
        if (result[STORAGE_KEY])    setVisibleTiles(result[STORAGE_KEY])
        setLoaded(true)
      } catch (err) {
        console.error("[Wisp] Failed to load popup data:", err)
        if (!cancelled) setLoaded(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const toggleTile = (id: TileId) => {
    const next = visibleTiles.includes(id)
      ? visibleTiles.filter(t => t !== id)
      : [...visibleTiles, id]
    setVisibleTiles(next)
    browserApi.storage.local.set({ [STORAGE_KEY]: next }).catch(err => {
      console.error("[Wisp] Failed to persist tile prefs:", err)
    })
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const total = bookmarks.length

  const topDomain = (() => {
    const counts: Record<string, number> = {}
    for (const b of bookmarks) {
      try {
        const d = new URL(b.url!).hostname.replace("www.", "")
        counts[d] = (counts[d] ?? 0) + 1
      } catch {}
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return top ? { domain: top[0], count: top[1] } : null
  })()

  const forgotten = bookmarks.filter(b => {
    const v = visits[b.id!]
    const ref = v ?? b.dateAdded ?? 0
    return Date.now() - ref > 6 * 30 * 24 * 3600000
  }).length

  const broken       = Object.values(health).filter(r => r.status === "dead").length
  const unverifiable = Object.values(health).filter(r => r.status === "unverifiable").length

  const newest = [...bookmarks]
    .filter(b => b.dateAdded)
    .sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0))[0]

  const lastVisited = (() => {
    const top = Object.entries(visits).sort((a, b) => b[1] - a[1])[0]
    if (!top) return null
    const bm = bookmarks.find(b => b.id === top[0])
    return bm ? { title: bm.title, time: top[1] } : null
  })()

  const uniqueDomains = new Set(
    bookmarks.map(b => { try { return new URL(b.url!).hostname } catch { return "" } })
  ).size

  const getTileContent = (id: TileId): { value: string; sub: string; accent: AccentClass } => {
    switch (id) {
      case "total":
        return { value: total.toLocaleString(), sub: "saved bookmarks", accent: "" }
      case "topDomain":
        return topDomain
          ? { value: topDomain.domain, sub: `${topDomain.count} bookmarks`, accent: "" }
          : { value: "—", sub: "no data yet", accent: "" }
      case "forgotten":
        return {
          value: forgotten.toString(),
          sub: "not opened in 6mo",
          accent: forgotten > 0 ? "is-amber" : "is-sage",
        }
      case "broken":
        return {
          value: broken > 0 || unverifiable > 0 ? `${broken} · ${unverifiable}` : "0",
          sub: broken > 0 || unverifiable > 0 ? "broken · unverifiable" : "all links OK",
          accent: broken > 0 ? "is-rust" : unverifiable > 0 ? "is-amber" : "is-sage",
        }
      case "newest":
        return newest
          ? { value: newest.title || "Untitled", sub: relativeTime(newest.dateAdded!), accent: "" }
          : { value: "—", sub: "no bookmarks yet", accent: "" }
      case "lastVisit":
        return lastVisited
          ? { value: lastVisited.title || "Untitled", sub: relativeTime(lastVisited.time), accent: "" }
          : { value: "—", sub: "no visits recorded", accent: "" }
      case "categories":
        return { value: uniqueDomains.toString(), sub: "unique domains", accent: "" }
    }
  }

  const openFullView = async () => {
    const optionsUrl = browserApi.runtime.getURL("options.html")

    try {
      const window: BrowserWindow = await browserApi.windows.getCurrent()

      let isAllowed = true
      try {
        isAllowed = await browserApi.extension.isAllowedIncognitoAccess()
      } catch {
        isAllowed = false
      }

      const isIncognito = window.incognito || false

      if (isIncognito && !isAllowed) {
        await browserApi.tabs.create({ url: optionsUrl })
      } else {
        await browserApi.tabs.create({ url: optionsUrl, windowId: window.id })
      }
    } catch (err) {
      console.error("[Wisp] openFullView fallback:", err)
      try {
        await browserApi.tabs.create({ url: optionsUrl })
      } catch (fallbackErr) {
        console.error("[Wisp] Could not open options page:", fallbackErr)
      }
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="wisp-popup">
      <div className="wisp-popup__scanlines" />
      <div className="wisp-popup__corner wisp-popup__corner--tl" />
      <div className="wisp-popup__corner wisp-popup__corner--tr" />

      <div className="wisp-popup__body">

        {/* ── Header ── */}
        <div className="wisp-popup__head">
          <div>
            <h1 className="wisp-popup__title">Wisp</h1>
            <p className="wisp-popup__subtitle">archive unit</p>
          </div>

          <button
            onClick={() => setEditMode(e => !e)}
            className={`wisp-popup__editbtn${editMode ? " is-active" : ""}`}
          >
            {editMode ? "Done" : "✎ Edit"}
          </button>
        </div>

        {/* ── Theme toggle row ── */}
        <div className="wisp-popup__appearance">
          <span className="wisp-popup__appearance-label">Appearance</span>
          <ThemeToggle />
        </div>

        {/* ── Edit mode ── */}
        {editMode && (
          <div className="wisp-popup__editpanel">
            <p className="wisp-popup__editpanel-title">Choose what to show</p>
            <div className="wisp-popup__editpanel-list">
              {ALL_TILES.map(tile => {
                const on = visibleTiles.includes(tile.id)
                return (
                  <div
                    key={tile.id}
                    onClick={() => toggleTile(tile.id)}
                    className={`wisp-popup__tile-toggle${on ? " is-on" : ""}`}
                  >
                    <span className="wisp-popup__tile-toggle-label">
                      {tile.symbol} {tile.label.toUpperCase()}
                    </span>
                    <div className="wisp-popup__tile-check">
                      {on && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path
                            d="M1.5 4L3 5.5L6.5 2"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Stat tiles ── */}
        {!editMode && loaded && visibleTiles.length > 0 && (
          <div className={`wisp-popup__tiles ${visibleTiles.length === 1 ? "cols-1" : "cols-2"}`}>
            {visibleTiles.map(id => {
              const def = ALL_TILES.find(t => t.id === id)!
              const { value, sub, accent } = getTileContent(id)
              return (
                <div key={id} className="wisp-popup__tile">
                  <span className="wisp-popup__tile-symbol">{def.symbol}</span>
                  <span className={`wisp-popup__tile-value${accent ? " " + accent : ""}`}>
                    {value}
                  </span>
                  <span className="wisp-popup__tile-sub">{sub}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {!editMode && loaded && visibleTiles.length === 0 && (
          <div className="wisp-popup__empty">
            No tiles selected — tap ✎ Edit to add some.
          </div>
        )}

        <div className="wisp-popup__divider" />

        {/* ── Open button ── */}
        <button onClick={openFullView} className="wisp-popup__open">
          Open Wisp →
        </button>

      </div>
    </div>
  )
}