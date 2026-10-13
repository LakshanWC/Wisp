import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import BookmarkCard from "./bookmarkcard"
import "styles/themes.css"
import { useTheme } from '../scripts/themeProvider'
import { loadFavicon } from "~scripts/faviconHelper"
import QRScreenModal from "./qrScreenModal"

//#region ─── style design (modals only, they render rarely) ─────────
function getThemeColors(theme: string) {
  const isDark = theme === "dark" || theme === "high-contrast-dark"
  return {
    bg: isDark ? "#1a1a17" : "#e8e4d8",
    bgPanel: isDark ? "#242420" : "#ddd8c8",
    ink: isDark ? "#e8e4d8" : "#161511",
    dim: isDark ? "#8a8578" : "#8a8578",
    dimmer: isDark ? "#6a6578" : "#a8a396",
    line: isDark ? "rgba(232,228,216,0.3)" : "#161511",
    lineFaint: isDark ? "rgba(232,228,216,0.12)" : "rgba(22,21,17,0.18)",
    rust: "#b8341f",
    sage: "#4a5d4f",
    amber: "#a3742f",
    mono: "'JetBrains Mono', 'Courier New', monospace",
  }
}
//#endregion

interface Bookmark {
  id: string
  title: string
  description?: string
  url: string
  date?: string
  color?: string
  healthStatus?: string
  isPrivate?: boolean
}

interface CollapsibleCategoryProps {
  title: string
  bookmarks: Bookmark[]
  defaultOpen?: boolean
  icon?: string
  categoryName?: string
  allCategories?: string[]
  onAssignCategory?: (bookmarkId: string, categoryName: string) => void
  onDeleteBookmarks?: (ids: string[]) => void
  onUpdateUrl?: (bookmarkId: string, newUrl: string) => void
  onUpdateNote?: (bookmarkId: string, note: string) => void
  onTogglePrivate?: (bookmark: Bookmark) => Promise<boolean>
}

//#region ─── Shared Icons ────────────

const ShareIcon = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}>
    <circle cx="18" cy="5" r="3"></circle>
    <circle cx="6" cy="12" r="3"></circle>
    <circle cx="18" cy="19" r="3"></circle>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
  </svg>
)
//#endregion

//#region ─── Folder Icon with Favicons ─────────────

const FolderIcon = ({
  bookmarks,
  icon,
}: {
  bookmarks: Bookmark[]
  icon?: string
}) => {
  const [faviconDataUrls, setFaviconDataUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadFavicons = async () => {
      if (bookmarks.length === 0) { setLoading(false); return }

      const domains = bookmarks
        .map(b => { try { return new URL(b.url).hostname } catch { return null } })
        .filter((d): d is string => d !== null)
        .filter((d, i, arr) => arr.indexOf(d) === i)
        .slice(0, 4)

      if (domains.length === 0) { setLoading(false); return }

      try {
        const results = await Promise.all(domains.map(domain => loadFavicon(domain)))
        if (isMounted) { setFaviconDataUrls(results); setLoading(false) }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load folder favicons:', error)
          setLoading(false)
        }
      }
    }

    loadFavicons()
    return () => { isMounted = false }
  }, [bookmarks])

  const showFallback = loading || faviconDataUrls.length === 0 || faviconDataUrls.every(url => !url)

  return (
    <div className="wisp-folder">
      {showFallback ? (
        <span className="wisp-folder__emoji">{icon || "📁"}</span>
      ) : faviconDataUrls.length === 1 ? (
        <img className="wisp-folder__single" src={faviconDataUrls[0]} alt="" />
      ) : (
        <div className="wisp-folder__grid">
          {faviconDataUrls.map((src, i) => (
            <img key={i} src={src} alt="" />
          ))}
        </div>
      )}
    </div>
  )
}
//#endregion

//#region ─── URL Edit Modal ──────────

function UrlEditModal({
  bookmark,
  onSave,
  onClose,
  theme,
}: {
  bookmark: Bookmark
  onSave: (id: string, url: string) => void
  onClose: () => void
  theme?: string
}) {
  const [value, setValue] = useState(bookmark.url)
  const inputRef = useRef<HTMLInputElement>(null)
  const colors = getThemeColors(theme || 'light')
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleSave = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSave(bookmark.id, trimmed)
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: isDark ? "rgba(0,0,0,0.7)" : "rgba(22,21,17,0.3)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          padding: "28px 32px", width: "520px", maxWidth: "90vw",
          boxShadow: isDark ? "8px 8px 0 rgba(0,0,0,0.4)" : "8px 8px 0 rgba(22,21,17,0.12)",
          fontFamily: colors.mono,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div style={{
            width: 36, height: 36,
            border: `1px solid ${colors.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: colors.ink,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: colors.ink, letterSpacing: "0.04em" }}>
            EDIT URL
          </h3>
        </div>

        <p style={{ margin: "0 0 24px", fontSize: "12px", color: colors.dim, letterSpacing: "0.02em" }}>
          Updating link for <span style={{ color: colors.ink, fontWeight: 600 }}>{bookmark.title || bookmark.url}</span>
        </p>

        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose() }}
          placeholder="https://..."
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 16px",
            background: colors.bg,
            border: `1px solid ${colors.line}`,
            color: colors.ink,
            fontSize: "13px", outline: "none",
            fontFamily: colors.mono, letterSpacing: "0.02em",
          }}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              border: `1px solid ${colors.lineFaint}`,
              background: "transparent",
              color: colors.dim,
              fontSize: "11px", fontWeight: 600, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.08em", textTransform: "uppercase",
            }}
          >CANCEL</button>
          <button
            onClick={handleSave}
            disabled={!value.trim() || value.trim() === bookmark.url}
            style={{
              padding: "10px 20px",
              border: `1px solid ${colors.ink}`,
              background: colors.ink,
              color: colors.bg,
              fontSize: "11px", fontWeight: 700,
              cursor: (!value.trim() || value.trim() === bookmark.url) ? "default" : "pointer",
              fontFamily: colors.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              opacity: (!value.trim() || value.trim() === bookmark.url) ? 0.4 : 1,
            }}
          >SAVE URL</button>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── Note Edit Modal ─────────

function NoteEditModal({
  bookmark,
  onSave,
  onClose,
  theme,
}: {
  bookmark: Bookmark
  onSave: (id: string, note: string) => void
  onClose: () => void
  theme?: string
}) {
  const [value, setValue] = useState(bookmark.description ?? "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const colors = getThemeColors(theme || 'light')
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  useEffect(() => { textareaRef.current?.focus() }, [])

  const handleSave = () => {
    onSave(bookmark.id, value.trim())
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: isDark ? "rgba(0,0,0,0.7)" : "rgba(22,21,17,0.3)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          padding: "28px 32px", width: "520px", maxWidth: "90vw",
          boxShadow: isDark ? "8px 8px 0 rgba(0,0,0,0.4)" : "8px 8px 0 rgba(22,21,17,0.12)",
          fontFamily: colors.mono,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div style={{
            width: 36, height: 36,
            border: `1px solid ${colors.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: colors.ink,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: colors.ink, letterSpacing: "0.04em" }}>
            EDIT NOTE
          </h3>
        </div>

        <p style={{ margin: "0 0 24px", fontSize: "12px", color: colors.dim, letterSpacing: "0.02em" }}>
          Adding context to <span style={{ color: colors.ink, fontWeight: 600 }}>{bookmark.title || bookmark.url}</span>
        </p>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") onClose() }}
          placeholder="Add a short note about this bookmark…"
          rows={5}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            padding: "12px 16px",
            background: colors.bg,
            border: `1px solid ${colors.line}`,
            color: colors.ink,
            fontSize: "13px", outline: "none",
            fontFamily: colors.mono, letterSpacing: "0.02em", lineHeight: 1.6,
          }}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              border: `1px solid ${colors.lineFaint}`,
              background: "transparent",
              color: colors.dim,
              fontSize: "11px", fontWeight: 600, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.08em", textTransform: "uppercase",
            }}
          >CANCEL</button>
          <button
            onClick={handleSave}
            style={{
              padding: "10px 20px",
              border: `1px solid ${colors.ink}`,
              background: colors.ink, color: colors.bg,
              fontSize: "11px", fontWeight: 700, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.08em", textTransform: "uppercase",
            }}
          >SAVE NOTE</button>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── Delete Confirm Modal ─────────

function DeleteConfirmModal({
  count,
  onConfirm,
  onClose,
  theme,
}: {
  count: number
  onConfirm: () => void
  onClose: () => void
  theme?: string
}) {
  const colors = getThemeColors(theme || 'light')
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: isDark ? "rgba(0,0,0,0.7)" : "rgba(22,21,17,0.3)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          padding: "32px", width: "400px", maxWidth: "90vw",
          boxShadow: isDark ? "8px 8px 0 rgba(0,0,0,0.4)" : "8px 8px 0 rgba(22,21,17,0.12)",
          textAlign: "center", fontFamily: colors.mono,
        }}
      >
        <div style={{
          width: 64, height: 64, margin: "0 auto 20px",
          border: `1px solid ${colors.rust}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "28px", color: colors.rust,
        }}>✕</div>
        <h3 style={{ margin: "0 0 12px", fontSize: "18px", fontWeight: 700, color: colors.ink, letterSpacing: "0.02em" }}>
          DELETE {count} BOOKMARK{count !== 1 ? "S" : ""}?
        </h3>
        <p style={{ margin: "0 0 28px", fontSize: "13px", color: colors.dim, lineHeight: 1.5, letterSpacing: "0.02em" }}>
          This will permanently remove {count === 1 ? "this bookmark" : "these bookmarks"} from the archive. This action cannot be undone.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "10px 20px",
              border: `1px solid ${colors.lineFaint}`,
              background: "transparent", color: colors.dim,
              fontSize: "11px", fontWeight: 600, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.08em", textTransform: "uppercase",
            }}
          >CANCEL</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            style={{
              flex: 1, padding: "10px 16px",
              border: `1px solid ${colors.rust}`,
              background: colors.rust, color: colors.bg,
              fontSize: "13px", fontWeight: 700, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.04em",
            }}
          >DELETE</button>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── MoveMenu ────────

const MoveMenu = React.forwardRef<HTMLDivElement, {
  open: boolean
  onToggle: () => void
  count: number
  categories: string[]
  onMove: (cat: string) => void
  theme?: string
}>(({ open, onToggle, count, categories, onMove, theme }, ref) => {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const colors = getThemeColors(theme || 'light')
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  useEffect(() => {
    if (open) { setQuery(""); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  const filtered = query.trim()
    ? categories.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : categories

  const handleMove = useCallback((cat: string) => {
    onMove(cat)
    onToggle()
  }, [onMove, onToggle])

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="wisp-cat__action-btn"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
      >
        MOVE TO
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          width: "240px", zIndex: 300,
          boxShadow: isDark ? "4px 4px 0 rgba(0,0,0,0.4)" : "4px 4px 0 rgba(22,21,17,0.12)",
          display: "flex", flexDirection: "column",
          fontFamily: colors.mono,
          maxHeight: "300px", overflow: "hidden",
        }}>
          <div style={{ padding: "12px", borderBottom: `1px solid ${colors.lineFaint}` }}>
            <div style={{
              fontSize: "10px", color: colors.dim, marginBottom: "10px",
              paddingLeft: "4px", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              MOVE {count} ITEM{count !== 1 ? "S" : ""}
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search folders…"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "8px 12px",
                background: colors.bg,
                border: `1px solid ${colors.line}`,
                color: colors.ink,
                fontSize: "12px", outline: "none",
                fontFamily: colors.mono, letterSpacing: "0.02em",
              }}
            />
          </div>

          <div style={{ overflowY: "auto", maxHeight: "220px", padding: "6px", overscrollBehavior: "contain" }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleMove("") }}
              style={{
                display: "block", width: "100%",
                padding: "10px 14px",
                background: "none", border: "none",
                color: colors.ink, fontSize: "12px", textAlign: "left",
                cursor: "pointer", fontFamily: colors.mono,
                letterSpacing: "0.04em",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.lineFaint }}
              onMouseLeave={e => { e.currentTarget.style.background = "none" }}
            >
              <span style={{ opacity: 0.5, marginRight: "8px" }}>◈</span> AUTO-DETECT
            </button>

            {filtered.length === 0 ? (
              <div style={{
                padding: "12px", fontSize: "12px",
                color: colors.dimmer, textAlign: "center",
                letterSpacing: "0.02em",
              }}>
                No folders match
              </div>
            ) : (
              filtered.map(cat => (
                <button
                  key={cat}
                  onClick={(e) => { e.stopPropagation(); handleMove(cat) }}
                  style={{
                    display: "block", width: "100%",
                    padding: "10px 14px",
                    background: "none", border: "none",
                    color: colors.ink, fontSize: "12px", textAlign: "left",
                    cursor: "pointer", fontFamily: colors.mono,
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.lineFaint }}
                  onMouseLeave={e => { e.currentTarget.style.background = "none" }}
                >
                  {cat.toUpperCase()}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
})

MoveMenu.displayName = "MoveMenu"
//#endregion

//#region ─── Main Component(CollapsibleCategory) ─────────────

export default function CollapsibleCategory({
  title,
  bookmarks,
  defaultOpen = true,
  icon = "📁",
  categoryName,
  allCategories = [],
  onAssignCategory,
  onDeleteBookmarks,
  onUpdateUrl,
  onUpdateNote,
  onTogglePrivate,
}: CollapsibleCategoryProps) {
  // Only used to pass a theme string to modals/portal content. Not read by
  // the wrapper chrome anymore — CSS vars handle everything.
  const { theme } = useTheme()

  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | "auto">(defaultOpen ? "auto" : 0)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement>(null)

  const [shareMode, setShareMode] = useState(false)
  const [shareTarget, setShareTarget] = useState<Bookmark | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  const [urlEditTarget, setUrlEditTarget] = useState<Bookmark | null>(null)
  const [noteEditTarget, setNoteEditTarget] = useState<Bookmark | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const memoizedBookmarks = useMemo(() => bookmarks, [bookmarks])

  const prevBookmarksRef = useRef(memoizedBookmarks)
  const bookmarksLengthRef = useRef(memoizedBookmarks.length)

  useEffect(() => {
    const lengthChanged = memoizedBookmarks.length !== bookmarksLengthRef.current
    const contentChanged = memoizedBookmarks !== prevBookmarksRef.current

    if (!contentRef.current) return

    if (isOpen) {
      const h = contentRef.current.scrollHeight
      setContentHeight(h)
      const t = setTimeout(() => setContentHeight("auto"), 300)
      return () => clearTimeout(t)
    } else {
      setContentHeight(contentRef.current.scrollHeight)
      requestAnimationFrame(() => requestAnimationFrame(() => setContentHeight(0)))
    }

    prevBookmarksRef.current = memoizedBookmarks
    bookmarksLengthRef.current = memoizedBookmarks.length
  }, [isOpen, memoizedBookmarks.length])

  useEffect(() => {
    if (!moveMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [moveMenuOpen])

  const prevLengthRef = useRef(memoizedBookmarks.length)

  useEffect(() => {
    if (prevLengthRef.current !== memoizedBookmarks.length) {
      setSelectMode(false)
      setSelected(new Set())
      setShareTarget(prev => prev && memoizedBookmarks.some(b => b.id === prev.id) ? prev : null)
      setShareMode(false)
      prevLengthRef.current = memoizedBookmarks.length
    }
  }, [memoizedBookmarks.length])

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }
  const exitShareMode = () => { setShareMode(false); setShareTarget(null) }

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleShareTarget = useCallback((bookmark: Bookmark) => {
    setShareTarget(prev => (prev?.id === bookmark.id ? null : bookmark))
  }, [])

  const toggleAll = () => {
    if (selected.size === memoizedBookmarks.length) setSelected(new Set())
    else setSelected(new Set(memoizedBookmarks.map(b => b.id)))
  }

  const handleMove = useCallback((cat: string) => {
    if (!onAssignCategory) return
    Array.from(selected).forEach(id => onAssignCategory(id, cat))
    setMoveMenuOpen(false)
    exitSelectMode()
  }, [onAssignCategory, selected])

  const handleDelete = () => {
    if (!onDeleteBookmarks) return
    onDeleteBookmarks(Array.from(selected))
    exitSelectMode()
  }

  const handleOpenShare = useCallback(() => {
    if (!shareTarget) return
    setShareModalOpen(true)
  }, [shareTarget])

  const singleSelected = selected.size === 1
    ? memoizedBookmarks.find(b => b.id === Array.from(selected)[0]) ?? null
    : null

  const otherCategories = allCategories.filter(c => c !== categoryName)
  const allSelected = selected.size === memoizedBookmarks.length && memoizedBookmarks.length > 0
  const someSelected = selected.size > 0

  const handleTogglePrivate = async (bookmark: Bookmark, e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof onTogglePrivate !== "function") return
    try {
      await onTogglePrivate(bookmark)
    } catch (err) {
      console.error("[CollapsibleCategory] onTogglePrivate rejected:", err)
    }
  }

  const isBookmarkSelected = (id: string) =>
    selectMode ? selected.has(id) : shareMode ? shareTarget?.id === id : false

  const anyModeActive = selectMode || shareMode

  return (
    <>
      {/* ── Modals (portals) ── */}
      {urlEditTarget && onUpdateUrl && createPortal(
        <UrlEditModal
          bookmark={urlEditTarget}
          onSave={onUpdateUrl}
          onClose={() => setUrlEditTarget(null)}
          theme={theme}
        />,
        document.body
      )}

      {noteEditTarget && onUpdateNote && createPortal(
        <NoteEditModal
          bookmark={noteEditTarget}
          onSave={onUpdateNote}
          onClose={() => setNoteEditTarget(null)}
          theme={theme}
        />,
        document.body
      )}

      {showDeleteConfirm && createPortal(
        <DeleteConfirmModal
          count={selected.size}
          onConfirm={handleDelete}
          onClose={() => setShowDeleteConfirm(false)}
          theme={theme}
        />,
        document.body
      )}

      {shareModalOpen && shareTarget && createPortal(
        <QRScreenModal
          url={shareTarget.url}
          onClose={() => setShareModalOpen(false)}
          theme={theme}
        />,
        document.body
      )}

      {/* ── Category wrapper — all chrome via CSS vars ── */}
      <div className={`wisp-cat${isOpen ? " is-open" : ""}${anyModeActive ? " is-active-mode" : ""}`}>
        <div className="wisp-cat__accent" />

        {/* ── Header ── */}
        <div className="wisp-cat__header">
          {/* Left: icon + title */}
          <div
            className="wisp-cat__header-left"
            onClick={() => !anyModeActive && setIsOpen(o => !o)}
          >
            <FolderIcon bookmarks={memoizedBookmarks} icon={icon} />

            <div className="wisp-cat__title-block">
              <h2 className="wisp-cat__title">{title}</h2>
              <p className="wisp-cat__subtitle">
                {selectMode && someSelected ? (
                  <span className="highlight">
                    {selected.size} OF {memoizedBookmarks.length} SELECTED
                  </span>
                ) : shareMode ? (
                  shareTarget ? (
                    <span className="highlight">SHARE: {shareTarget.title || shareTarget.url}</span>
                  ) : (
                    <span className="highlight">PICK ONE TO SHARE</span>
                  )
                ) : (
                  <>
                    {memoizedBookmarks.length} {memoizedBookmarks.length === 1 ? "ENTRY" : "ENTRIES"}
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Right: actions */}
          <div className="wisp-cat__actions">
            {!anyModeActive ? (
              <>
                <button
                  className="wisp-cat__btn"
                  onClick={e => {
                    e.stopPropagation()
                    setSelectMode(false)
                    setSelected(new Set())
                    setShareMode(true)
                    setShareTarget(null)
                    setIsOpen(true)
                  }}
                  title="Pick one bookmark to share as a QR code"
                >
                  <ShareIcon size={12} />
                  SHARE
                </button>

                <button
                  className="wisp-cat__btn"
                  onClick={e => {
                    e.stopPropagation()
                    setShareMode(false)
                    setShareTarget(null)
                    setSelectMode(true)
                    setIsOpen(true)
                  }}
                >
                  SELECT
                </button>

                <div className="wisp-cat__chev" onClick={() => setIsOpen(o => !o)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </>
            ) : (
              <div className="wisp-cat__bulk" onClick={e => e.stopPropagation()}>
                {selectMode && (
                  <>
                    <button className="wisp-cat__action-btn" onClick={toggleAll}>
                      {allSelected ? "DESELECT ALL" : "SELECT ALL"}
                    </button>
                    {someSelected && <div className="wisp-cat__divider" />}
                  </>
                )}

                {selectMode && someSelected && (
                  <>
                    {onAssignCategory && otherCategories.length > 0 && (
                      <MoveMenu
                        ref={moveMenuRef}
                        open={moveMenuOpen}
                        onToggle={() => setMoveMenuOpen(o => !o)}
                        count={selected.size}
                        categories={otherCategories}
                        onMove={handleMove}
                        theme={theme}
                      />
                    )}
                    {onUpdateUrl && singleSelected && (
                      <button className="wisp-cat__action-btn" onClick={() => setUrlEditTarget(singleSelected)}>
                        EDIT URL
                      </button>
                    )}
                    {onUpdateNote && singleSelected && (
                      <button className="wisp-cat__action-btn" onClick={() => setNoteEditTarget(singleSelected)}>
                        EDIT NOTE
                      </button>
                    )}
                    {onDeleteBookmarks && (
                      <button className="wisp-cat__action-btn danger" onClick={() => setShowDeleteConfirm(true)}>
                        DELETE
                      </button>
                    )}
                  </>
                )}

                {shareMode && (
                  <>
                    <span className="wisp-cat__action-btn" style={{ cursor: "default" }}>
                      {shareTarget ? "1 SELECTED" : "SELECT 1"}
                    </span>
                    <button
                      className={`wisp-cat__share-btn${shareTarget ? " is-ready" : ""}`}
                      onClick={handleOpenShare}
                      disabled={!shareTarget}
                    >
                      <ShareIcon size={11} />
                      SHARE
                    </button>
                  </>
                )}

                <div className="wisp-cat__divider" />
                <button
                  className="wisp-cat__action-btn"
                  onClick={() => { exitSelectMode(); exitShareMode() }}
                  title="Cancel"
                  style={{ padding: "8px", display: "flex" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Animated content ── */}
        <div
          ref={contentRef}
          style={{
            height: contentHeight === "auto" ? "auto" : `${contentHeight}px`,
            overflow: "hidden",
            transition: "height 0.3s cubic-bezier(0.4,0,0.2,1)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ padding: "24px" }}>
            {memoizedBookmarks.length > 0 ? (
              <div className="wisp-cat__grid">
                {memoizedBookmarks.map(bookmark => {
                  const isSel = isBookmarkSelected(bookmark.id)
                  return (
                    <div
                      key={bookmark.id}
                      className={`wisp-bm-wrap${anyModeActive ? " selectable" : ""}${isSel ? " is-selected" : ""}`}
                      onClick={() => {
                        if (selectMode) toggleSelect(bookmark.id)
                        else if (shareMode) toggleShareTarget(bookmark)
                      }}
                    >
                      {anyModeActive && (
                        <div className={`wisp-bm-wrap__check${isSel ? " is-on" : ""}${shareMode ? " rounded" : ""}`}>
                          {isSel && (
                            shareMode ? (
                              <span className="dot" />
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )
                          )}
                        </div>
                      )}

                      {anyModeActive && !isSel && <div className="wisp-bm-wrap__dim" />}

                      <BookmarkCard
                        title={bookmark.title}
                        description={bookmark.description}
                        url={bookmark.url}
                        date={bookmark.date}
                        color={bookmark.color}
                        isPrivate={bookmark.isPrivate}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="wisp-cat__empty">
                <div className="wisp-cat__empty-icon">◈</div>
                <p className="wisp-cat__empty-title">No entries here</p>
                <p className="wisp-cat__empty-sub">Save some links to see them in this folder.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

//#endregion