import { useState, useEffect } from "react"
import browserApi  from "~scripts/storage";
import type { BookmarkTreeNode } from "~scripts/storage";
import type { BrowserWindow } from "~scripts/storage";
import "styles/popup.css"
import { ThemeProvider, useTheme } from "scripts/themeProvider"
import { ThemeToggle } from "components/themeToggle"
import "styles/themes.css"

// ─── YoRHa design tokens ───────────────────────────────────────────────────────
const YORHA = {
  bg: "#e8e4d8",
  bgPanel: "#ddd8c8",
  ink: "#161511",
  dim: "#8a8578",
  dimmer: "#a8a396",
  line: "#161511",
  lineFaint: "rgba(22,21,17,0.18)",
  rust: "#b8341f",
  sage: "#4a5d4f",
  amber: "#a3742f",
  mono: "'JetBrains Mono', 'Courier New', monospace",
}

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

  const { theme } = useTheme()
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Cross-browser: promise-based on both Chrome & Firefox
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
    //  Cross-browser (returns a promise — fire & forget is fine here,
    //    but we swallow errors so a failed write doesn't crash the UI)
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

  const getTileContent = (id: TileId): { value: string; sub: string; color?: string } => {
    switch (id) {
      case "total":
        return { value: total.toLocaleString(), sub: "saved bookmarks" }
      case "topDomain":
        return topDomain
          ? { value: topDomain.domain, sub: `${topDomain.count} bookmarks` }
          : { value: "—", sub: "no data yet" }
      case "forgotten":
        return {
          value: forgotten.toString(),
          sub: "not opened in 6mo",
          color: forgotten > 0 ? YORHA.amber : YORHA.sage,
        }
      case "broken":
        return {
          value: broken > 0 || unverifiable > 0 ? `${broken} · ${unverifiable}` : "0",
          sub: broken > 0 || unverifiable > 0 ? "broken · unverifiable" : "all links OK",
          color: broken > 0 ? YORHA.rust : unverifiable > 0 ? YORHA.amber : YORHA.sage,
        }
      case "newest":
        return newest
          ? { value: newest.title || "Untitled", sub: relativeTime(newest.dateAdded!) }
          : { value: "—", sub: "no bookmarks yet" }
      case "lastVisit":
        return lastVisited
          ? { value: lastVisited.title || "Untitled", sub: relativeTime(lastVisited.time) }
          : { value: "—", sub: "no visits recorded" }
      case "categories":
        return { value: uniqueDomains.toString(), sub: "unique domains" }
    }
  }

  // Cross-browser: uses browserApi.windows / tabs / extension helpers
  const openFullView = async () => {
    const optionsUrl = browserApi.runtime.getURL("options.html")

    try {
      const window: BrowserWindow = await browserApi.windows.getCurrent()

      // Incognito check — if we're in incognito without permission, don't
      // try to open in this window (Chrome will refuse); open a new tab in
      // the current window context anyway, which is what the original did.
      let isAllowed = true
      try {
        isAllowed = await browserApi.extension.isAllowedIncognitoAccess()
      } catch {
        // If the check fails, assume no incognito — safer default.
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

  const bgColor = isDark ? "#1a1a17" : YORHA.bg
  const textColor = isDark ? "#e8e4d8" : YORHA.ink
  const dimColor = isDark ? "#8a8578" : YORHA.dim
  const dimmerColor = isDark ? "#6a6578" : YORHA.dimmer
  const borderColor = isDark ? "rgba(232,228,216,0.15)" : YORHA.lineFaint
  const cardBg = isDark ? "#242420" : YORHA.bg

  return (
    <div style={{
      width: 320,
      backgroundColor: bgColor,
      color: textColor,
      fontFamily: YORHA.mono,
      boxSizing: "border-box",
      position: "relative",
      overflow: "hidden",
      transition: "background-color 0.3s, color 0.3s",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          repeating-linear-gradient(0deg, rgba(22,21,17,0.02) 0px, rgba(22,21,17,0.02) 1px, transparent 1px, transparent 3px)
        `,
        pointerEvents: "none",
        opacity: isDark ? 0.3 : 1,
      }} />

      <div style={{
        position: "absolute", top: 12, left: 12,
        width: 16, height: 16,
        borderTop: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`,
        pointerEvents: "none",
        opacity: 0.5,
      }} />
      <div style={{
        position: "absolute", top: 12, right: 12,
        width: 16, height: 16,
        borderTop: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        pointerEvents: "none",
        opacity: 0.5,
      }} />

      <div style={{ padding: "20px 18px 18px", position: "relative" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h1 style={{
              fontSize: 22,
              fontWeight: 700,
              color: textColor,
              margin: 0,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}>
              Wisp
            </h1>
            <p style={{
              color: dimColor,
              margin: "2px 0 0",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}>
              archive unit
            </p>
          </div>

          <button
            onClick={() => setEditMode(e => !e)}
            style={{
              background: editMode ? bgColor : "transparent",
              border: `1px solid ${editMode ? textColor : borderColor}`,
              padding: "6px 12px",
              color: editMode ? textColor : dimColor,
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: YORHA.mono,
              transition: "all 0.15s",
            }}
          >
            {editMode ? "Done" : "✎ Edit"}
          </button>
        </div>

        {/* ── Theme toggle row ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: isDark ? "#242420" : YORHA.bgPanel,
          border: `1px solid ${borderColor}`,
          padding: "6px 12px",
          marginBottom: 12,
          transition: "background 0.3s, border-color 0.3s",
        }}>
          <span style={{
            fontSize: 9,
            color: dimColor,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}>
            Appearance
          </span>
          <ThemeToggle />
        </div>

        {/* ── Edit mode ── */}
        {editMode && (
          <div style={{
            background: isDark ? "#242420" : YORHA.bgPanel,
            border: `1px solid ${borderColor}`,
            padding: "12px 14px",
            marginBottom: 14,
            transition: "background 0.3s, border-color 0.3s",
          }}>
            <p style={{
              margin: "0 0 10px",
              fontSize: 9,
              color: dimColor,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              transition: "color 0.3s",
            }}>
              Choose what to show
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ALL_TILES.map(tile => {
                const on = visibleTiles.includes(tile.id)
                return (
                  <div
                    key={tile.id}
                    onClick={() => toggleTile(tile.id)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "6px 10px",
                      cursor: "pointer",
                      background: on ? bgColor : "transparent",
                      border: `1px solid ${on ? textColor : "transparent"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{
                      fontSize: 11,
                      color: on ? textColor : dimColor,
                      letterSpacing: "0.04em",
                      transition: "color 0.3s",
                    }}>
                      {tile.symbol} {tile.label.toUpperCase()}
                    </span>
                    <div style={{
                      width: 14, height: 14,
                      flexShrink: 0,
                      background: on ? textColor : "transparent",
                      border: `1px solid ${on ? textColor : dimColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                    }}>
                      {on && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1.5 4L3 5.5L6.5 2" stroke={bgColor} strokeWidth="1.5"
                            strokeLinecap="round" strokeLinejoin="round" />
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
          <div style={{
            display: "grid",
            gridTemplateColumns: visibleTiles.length === 1 ? "1fr" : "1fr 1fr",
            gap: 6,
            marginBottom: 14,
          }}>
            {visibleTiles.map(id => {
              const def = ALL_TILES.find(t => t.id === id)!
              const { value, sub, color } = getTileContent(id)
              return (
                <div key={id} style={{
                  background: cardBg,
                  border: `1px solid ${borderColor}`,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                  transition: "background 0.3s, border-color 0.3s",
                }}>
                  <span style={{
                    fontSize: 11,
                    color: dimColor,
                    letterSpacing: "0.04em",
                  }}>
                    {def.symbol}
                  </span>
                  <span style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: color ?? textColor,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    letterSpacing: "0.02em",
                    transition: "color 0.3s",
                  }}>
                    {value}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: dimmerColor,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    letterSpacing: "0.04em",
                    transition: "color 0.3s",
                  }}>
                    {sub}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {!editMode && loaded && visibleTiles.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: "16px 0 14px",
            color: dimmerColor,
            fontSize: 11,
            letterSpacing: "0.04em",
            transition: "color 0.3s",
          }}>
            No tiles selected — tap ✎ Edit to add some.
          </div>
        )}

        <div style={{
          height: 1,
          background: borderColor,
          marginBottom: 14,
          transition: "background 0.3s",
        }} />

        {/* ── Open button ── */}
        <button
          onClick={openFullView}
          style={{
            width: "100%",
            background: textColor,
            color: bgColor,
            border: `1px solid ${textColor}`,
            padding: "10px 0",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: YORHA.mono,
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = "0.85"
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = "1"
          }}
        >
          Open Wisp →
        </button>

      </div>
    </div>
  )
}