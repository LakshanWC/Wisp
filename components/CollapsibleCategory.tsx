import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import BookmarkCard from "./bookmarkcard"
import "styles/themes.css"
import { useTheme } from '../scripts/themeProvider'
import { loadFavicon } from "~scripts/faviconHelper"
import QRScreenModal from "./qrScreenModal"

//#region ─── style design  ─────────
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

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}>
    <rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
)

const UnlockIcon = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}>
    <rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
    <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
  </svg>
)

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
  colors
}: {
  bookmarks: Bookmark[],
  icon?: string,
  colors: ReturnType<typeof getThemeColors>
}) => {
  const [faviconDataUrls, setFaviconDataUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadFavicons = async () => {
      if (bookmarks.length === 0) {
        setLoading(false)
        return
      }

      const domains = bookmarks
        .map(b => {
          try {
            return new URL(b.url).hostname
          } catch {
            return null
          }
        })
        .filter((d): d is string => d !== null)
        .filter((d, i, arr) => arr.indexOf(d) === i)
        .slice(0, 4)

      if (domains.length === 0) {
        setLoading(false)
        return
      }

      try {
        const results = await Promise.all(
          domains.map(domain => loadFavicon(domain))
        )
        if (isMounted) {
          setFaviconDataUrls(results)
          setLoading(false)
        }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load folder favicons:', error)
          setLoading(false)
        }
      }
    }

    loadFavicons()

    return () => {
      isMounted = false
    }
  }, [bookmarks])

  const showFallback = loading || faviconDataUrls.length === 0 || faviconDataUrls.every(url => !url)

  return (
    <div style={{
      width: 44, height: 44, flexShrink: 0,
      border: `1px solid ${colors.lineFaint}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden", position: "relative",
      background: colors.bg,
      transition: "border-color 0.3s, background-color 0.3s",
    }}>
      {showFallback ? (
        <span style={{ fontSize: "20px" }}>{icon || "📁"}</span>
      ) : faviconDataUrls.length === 1 ? (
        <img
          src={faviconDataUrls[0]}
          style={{ width: 28, height: 28, objectFit: "contain" }}
          alt=""
        />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "2px",
          padding: "4px",
          width: "100%",
          height: "100%",
          boxSizing: "border-box"
        }}>
          {faviconDataUrls.map((src, i) => (
            <img
              key={i}
              src={src}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              alt=""
            />
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
        background: theme === "dark" || theme === "high-contrast-dark"
          ? "rgba(0,0,0,0.7)"
          : "rgba(22,21,17,0.3)",
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
          boxShadow: theme === "dark" || theme === "high-contrast-dark"
            ? "8px 8px 0 rgba(0,0,0,0.4)"
            : "8px 8px 0 rgba(22,21,17,0.12)",
          fontFamily: colors.mono,
          transition: "background-color 0.3s, border-color 0.3s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div style={{
            width: 36, height: 36,
            border: `1px solid ${colors.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: colors.ink,
            transition: "border-color 0.3s, color 0.3s",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </div>
          <h3 style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            color: colors.ink,
            letterSpacing: "0.04em",
            transition: "color 0.3s",
          }}>
            EDIT URL
          </h3>
        </div>

        <p style={{
          margin: "0 0 24px",
          fontSize: "12px",
          color: colors.dim,
          letterSpacing: "0.02em",
          transition: "color 0.3s",
        }}>
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
            fontFamily: colors.mono,
            letterSpacing: "0.02em",
            transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
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
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: colors.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
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
              fontSize: "11px",
              fontWeight: 700,
              cursor: (!value.trim() || value.trim() === bookmark.url) ? "default" : "pointer",
              fontFamily: colors.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
              opacity: (!value.trim() || value.trim() === bookmark.url) ? 0.4 : 1,
            }}
          >
            SAVE URL
          </button>
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
        background: theme === "dark" || theme === "high-contrast-dark"
          ? "rgba(0,0,0,0.7)"
          : "rgba(22,21,17,0.3)",
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
          boxShadow: theme === "dark" || theme === "high-contrast-dark"
            ? "8px 8px 0 rgba(0,0,0,0.4)"
            : "8px 8px 0 rgba(22,21,17,0.12)",
          fontFamily: colors.mono,
          transition: "background-color 0.3s, border-color 0.3s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div style={{
            width: 36, height: 36,
            border: `1px solid ${colors.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: colors.ink,
            transition: "border-color 0.3s, color 0.3s",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
          </div>
          <h3 style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            color: colors.ink,
            letterSpacing: "0.04em",
            transition: "color 0.3s",
          }}>
            EDIT NOTE
          </h3>
        </div>

        <p style={{
          margin: "0 0 24px",
          fontSize: "12px",
          color: colors.dim,
          letterSpacing: "0.02em",
          transition: "color 0.3s",
        }}>
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
            fontFamily: colors.mono,
            letterSpacing: "0.02em", lineHeight: 1.6,
            transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
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
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: colors.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          >CANCEL</button>
          <button
            onClick={handleSave}
            style={{
              padding: "10px 20px",
              border: `1px solid ${colors.ink}`,
              background: colors.ink,
              color: colors.bg,
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: colors.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: theme === "dark" || theme === "high-contrast-dark"
          ? "rgba(0,0,0,0.7)"
          : "rgba(22,21,17,0.3)",
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
          padding: "32px", width: "400px", maxWidth: "90vw",
          boxShadow: theme === "dark" || theme === "high-contrast-dark"
            ? "8px 8px 0 rgba(0,0,0,0.4)"
            : "8px 8px 0 rgba(22,21,17,0.12)",
          textAlign: "center",
          fontFamily: colors.mono,
          transition: "background-color 0.3s, border-color 0.3s",
        }}
      >
        <div style={{
          width: 64, height: 64, margin: "0 auto 20px",
          border: `1px solid ${colors.rust}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "28px", color: colors.rust,
          transition: "border-color 0.3s, color 0.3s",
        }}>
          ✕
        </div>
        <h3 style={{
          margin: "0 0 12px",
          fontSize: "18px",
          fontWeight: 700,
          color: colors.ink,
          letterSpacing: "0.02em",
          transition: "color 0.3s",
        }}>
          DELETE {count} BOOKMARK{count !== 1 ? "S" : ""}?
        </h3>
        <p style={{
          margin: "0 0 28px",
          fontSize: "13px",
          color: colors.dim,
          lineHeight: 1.5,
          letterSpacing: "0.02em",
          transition: "color 0.3s",
        }}>
          This will permanently remove {count === 1 ? "this bookmark" : "these bookmarks"} from the archive. This action cannot be undone.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 20px",
              border: `1px solid ${colors.lineFaint}`,
              background: "transparent",
              color: colors.dim,
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: colors.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          >CANCEL</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            style={{
              flex: 1, padding: "10px 16px",
              border: `1px solid ${colors.rust}`,
              background: colors.rust,
              color: colors.bg,
              fontSize: "13px", fontWeight: 700, cursor: "pointer",
              fontFamily: colors.mono, letterSpacing: "0.04em",
              transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
            }}
          >
            DELETE
          </button>
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
  actionBtn: React.CSSProperties
  theme?: string
}>(({ open, onToggle, count, categories, onMove, actionBtn, theme }, ref) => {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const colors = getThemeColors(theme || 'light')

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
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        style={actionBtn}
      >
        MOVE TO
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "4px", opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          width: "240px",
          zIndex: 300,
          boxShadow: theme === "dark" || theme === "high-contrast-dark"
            ? "4px 4px 0 rgba(0,0,0,0.4)"
            : "4px 4px 0 rgba(22,21,17,0.12)",
          display: "flex",
          flexDirection: "column",
          fontFamily: colors.mono,
          transition: "background-color 0.3s, border-color 0.3s",
          maxHeight: "300px",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "12px",
            borderBottom: `1px solid ${colors.lineFaint}`,
            transition: "border-color 0.3s",
          }}>
            <div style={{
              fontSize: "10px",
              color: colors.dim,
              marginBottom: "10px",
              paddingLeft: "4px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}>
              MOVE {count} ITEM{count !== 1 ? "S" : ""}
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search folders…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                background: colors.bg,
                border: `1px solid ${colors.line}`,
                color: colors.ink,
                fontSize: "12px",
                outline: "none",
                fontFamily: colors.mono,
                letterSpacing: "0.02em",
                transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              }}
            />
          </div>

          <div style={{
            overflowY: "auto",
            maxHeight: "220px",
            padding: "6px",
            overscrollBehavior: "contain",
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleMove("") }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                background: "none",
                border: "none",
                color: colors.ink,
                fontSize: "12px",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: colors.mono,
                letterSpacing: "0.04em",
                borderRadius: "2px",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.lineFaint }}
              onMouseLeave={e => { e.currentTarget.style.background = "none" }}
            >
              <span style={{ opacity: 0.5, marginRight: "8px" }}>◈</span> AUTO-DETECT
            </button>

            {filtered.length === 0 ? (
              <div style={{
                padding: "12px",
                fontSize: "12px",
                color: colors.dimmer,
                textAlign: "center",
                letterSpacing: "0.02em",
                transition: "color 0.3s",
              }}>
                No folders match
              </div>
            ) : (
              filtered.map(cat => (
                <button
                  key={cat}
                  onClick={(e) => { e.stopPropagation(); handleMove(cat) }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 14px",
                    background: "none",
                    border: "none",
                    color: colors.ink,
                    fontSize: "12px",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: colors.mono,
                    letterSpacing: "0.04em",
                    borderRadius: "2px",
                    transition: "all 0.15s ease",
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
  const { theme } = useTheme()
  const colors = getThemeColors(theme)
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  const [isOpen, setIsOpen]       = useState(defaultOpen)
  const contentRef                = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | "auto">(defaultOpen ? "auto" : 0)

  // ── Selection state ──────────────────────────────────────────────────────
  const [selectMode, setSelectMode]   = useState(false)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement>(null)

  // ── Share state (single-select) ──────────────────────────────────────────
  const [shareMode, setShareMode]       = useState(false)
  const [shareTarget, setShareTarget]   = useState<Bookmark | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  // ── Modals ───────────────────────────────────────────────────────────────
  const [urlEditTarget, setUrlEditTarget]   = useState<Bookmark | null>(null)
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
      // Also drop a share target if the underlying bookmark disappeared
      setShareTarget(prev => prev && memoizedBookmarks.some(b => b.id === prev.id) ? prev : null)
      setShareMode(false)
      prevLengthRef.current = memoizedBookmarks.length
    }
  }, [memoizedBookmarks.length])

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }
  const exitShareMode  = () => { setShareMode(false); setShareTarget(null) }

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // Single-select: clicking a card replaces the target; clicking the same one clears it.
  const toggleShareTarget = useCallback((bookmark: Bookmark) => {
    setShareTarget(prev => (prev?.id === bookmark.id ? null : bookmark))
  }, [])

  const toggleAll = () => {
    if (selected.size === memoizedBookmarks.length) setSelected(new Set())
    else setSelected(new Set(memoizedBookmarks.map(b => b.id)))
  }

  const handleMove = useCallback((cat: string) => {
    if (!onAssignCategory) return
    const ids = Array.from(selected)
    ids.forEach(id => onAssignCategory(id, cat))
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
  const allSelected     = selected.size === memoizedBookmarks.length && memoizedBookmarks.length > 0
  const someSelected    = selected.size > 0

  const handleTogglePrivate = async (bookmark: Bookmark, e: React.MouseEvent) => {
    // 🔍 CLICK TRACE — this is the actual click target
    console.log("[CollapsibleCategory] handleTogglePrivate called", {
      id: bookmark.id,
      title: bookmark.title,
      hasHandler: typeof onTogglePrivate === "function",
    })

    e.stopPropagation()

    if (typeof onTogglePrivate !== "function") {
      console.warn("[CollapsibleCategory] onTogglePrivate was not passed down")
      return
    }

    try {
      const result = await onTogglePrivate(bookmark)
      console.log("[CollapsibleCategory] onTogglePrivate resolved:", result)
    } catch (err) {
      console.error("[CollapsibleCategory] onTogglePrivate rejected:", err)
    }
  }

  // ─── Action button style ──────────────────────────────────────────────────
  const actionBtnStyle: React.CSSProperties = {
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    color: colors.ink,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: colors.mono,
    transition: "all 0.2s ease",
  }

  // ─── Card highlight rules ─────────────────────────────────────────────────
  const isBookmarkSelected = (id: string) =>
    selectMode ? selected.has(id) : shareMode ? shareTarget?.id === id : false

  const anyModeActive = selectMode || shareMode

  return (
    <>
      {/* ── Modals rendered via portal to escape ancestor stacking contexts ── */}
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

      <div
        style={{
          marginBottom: "24px",
          background: colors.bg,
          border: `1px solid ${anyModeActive ? colors.ink : colors.lineFaint}`,
          overflow: "visible",
          fontFamily: colors.mono,
          position: "relative",
          boxShadow: anyModeActive ? (isDark ? "4px 4px 0 rgba(0,0,0,0.4)" : "4px 4px 0 rgba(22,21,17,0.08)") : "none",
          transition: "background-color 0.3s, border-color 0.3s, box-shadow 0.3s",
        }}
      >
        {/* ── Corner accent ─────────────────────────────────────────────────── */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: "3px",
          background: isOpen ? colors.ink : colors.dimmer,
          opacity: isOpen ? 1 : 0.3,
          transition: "opacity 0.4s ease, background-color 0.3s",
          zIndex: 1,
          pointerEvents: "none",
        }} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          padding: "20px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", userSelect: "none",
          background: isOpen ? colors.bgPanel : colors.bg,
          borderBottom: isOpen ? `1px solid ${colors.lineFaint}` : "1px solid transparent",
          transition: "background 0.3s ease, border-color 0.3s ease",
          position: "relative",
          zIndex: 2,
        }}>

          {/* Left: icon + title */}
          <div onClick={() => !anyModeActive && setIsOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1, minWidth: 0 }}>
            <FolderIcon bookmarks={memoizedBookmarks} icon={icon} colors={colors} />

            <div style={{ minWidth: 0 }}>
              <h2 style={{
                margin: 0,
                fontSize: "15px",
                fontWeight: 700,
                color: colors.ink,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                transition: "color 0.3s",
              }}>
                {title}
              </h2>
              <p style={{
                margin: "4px 0 0",
                fontSize: "11px",
                color: colors.dim,
                letterSpacing: "0.04em",
                transition: "color 0.3s",
              }}>
                {selectMode && someSelected
                  ? <span style={{ color: colors.amber, fontWeight: 700 }}>{selected.size} OF {memoizedBookmarks.length} SELECTED</span>
                  : shareMode
                    ? (shareTarget
                        ? <span style={{ color: colors.amber, fontWeight: 700 }}>SHARE: {shareTarget.title || shareTarget.url}</span>
                        : <span style={{ color: colors.amber, fontWeight: 700 }}>PICK ONE TO SHARE</span>)
                    : <>{memoizedBookmarks.length} {memoizedBookmarks.length === 1 ? "ENTRY" : "ENTRIES"}</>
                }
              </p>
            </div>
          </div>

          {/* Right: actions */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "16px" }}>
            {!anyModeActive ? (
              <>
                {/* SHARE — single-select share flow */}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setSelectMode(false)
                    setSelected(new Set())
                    setShareMode(true)
                    setShareTarget(null)
                    setIsOpen(true)
                  }}
                  title="Pick one bookmark to share as a QR code"
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 14px",
                    border: `1px solid ${colors.line}`,
                    background: "transparent",
                    color: colors.ink,
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontFamily: colors.mono,
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = colors.ink
                    e.currentTarget.style.color = colors.bg
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = colors.ink
                  }}
                >
                  <ShareIcon size={12} />
                  SHARE
                </button>

                <button
                  onClick={e => {
                    e.stopPropagation()
                    setShareMode(false)
                    setShareTarget(null)
                    setSelectMode(true)
                    setIsOpen(true)
                  }}
                  style={{
                    padding: "8px 14px",
                    border: `1px solid ${colors.line}`,
                    background: "transparent",
                    color: colors.ink,
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontFamily: colors.mono,
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = colors.ink
                    e.currentTarget.style.color = colors.bg
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = colors.ink
                  }}
                >
                  SELECT
                </button>

                <div
                  onClick={() => setIsOpen(o => !o)}
                  style={{
                    width: 32, height: 32,
                    cursor: "pointer",
                    border: `1px solid ${isOpen ? colors.line : "transparent"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s ease",
                    background: isOpen ? colors.bgPanel : "transparent",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = colors.line }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = isOpen ? colors.line : "transparent" }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
                    <path d="M3 5L7 9L11 5" stroke={isOpen ? colors.ink : colors.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </>
            ) : (
              /* ── Bulk action bar (select mode + share mode share this shell) ── */
              <div style={{
                display: "flex", alignItems: "center", gap: "4px",
                background: colors.bgPanel,
                padding: "4px",
                border: `1px solid ${colors.lineFaint}`,
                transition: "background-color 0.3s, border-color 0.3s",
              }} onClick={e => e.stopPropagation()}>

                {selectMode && (
                  <>
                    <button onClick={toggleAll} style={actionBtnStyle}>
                      {allSelected ? "DESELECT ALL" : "SELECT ALL"}
                    </button>
                    {someSelected && <div style={{ width: "1px", height: "16px", background: colors.lineFaint, margin: "0 2px", transition: "background-color 0.3s" }} />}
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
                        actionBtn={actionBtnStyle}
                        theme={theme}
                      />
                    )}
                    {onUpdateUrl && singleSelected && <button onClick={() => setUrlEditTarget(singleSelected)} style={actionBtnStyle}>EDIT URL</button>}
                    {onUpdateNote && singleSelected && <button onClick={() => setNoteEditTarget(singleSelected)} style={actionBtnStyle}>EDIT NOTE</button>}
                    {onDeleteBookmarks && (
                      <button onClick={() => setShowDeleteConfirm(true)} style={{ ...actionBtnStyle, color: colors.rust }}>DELETE</button>
                    )}
                  </>
                )}

                {shareMode && (
                  <>
                    <span style={{
                      padding: "8px 10px",
                      fontSize: "10px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: colors.dim,
                      fontFamily: colors.mono,
                    }}>
                      {shareTarget ? "1 SELECTED" : "SELECT 1"}
                    </span>
                    <button
                      onClick={handleOpenShare}
                      disabled={!shareTarget}
                      style={{
                        ...actionBtnStyle,
                        padding: "8px 14px",
                        border: `1px solid ${shareTarget ? colors.ink : colors.lineFaint}`,
                        background: shareTarget ? colors.ink : "transparent",
                        color: shareTarget ? colors.bg : colors.dimmer,
                        fontWeight: 700,
                        cursor: shareTarget ? "pointer" : "default",
                        display: "flex", alignItems: "center", gap: "6px",
                      }}
                    >
                      <ShareIcon size={11} />
                      SHARE
                    </button>
                  </>
                )}

                <div style={{ width: "1px", height: "16px", background: colors.lineFaint, margin: "0 2px", transition: "background-color 0.3s" }} />
                <button
                  onClick={() => { exitSelectMode(); exitShareMode() }}
                  title="Cancel"
                  style={{ ...actionBtnStyle, padding: "8px", display: "flex" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Animated content ──────────────────────────────────────────────── */}
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
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: "16px",
              }}>
                {memoizedBookmarks.map(bookmark => {
                  const selected = isBookmarkSelected(bookmark.id)
                  return (
                    <div
                      key={bookmark.id}
                      onClick={() => {
                        if (selectMode) toggleSelect(bookmark.id)
                        else if (shareMode) toggleShareTarget(bookmark)
                      }}
                      style={{
                        position: "relative",
                        isolation: "isolate",
                        cursor: anyModeActive ? "pointer" : "default",
                        border: selected
                          ? `2px solid ${colors.ink}`
                          : "2px solid transparent",
                        transition: "border 0.2s ease",
                      }}
                    >
                      {/* Selection / share checkbox overlay */}
                      {anyModeActive && (
                        <div style={{
                          position: "absolute", top: "12px", left: "12px", zIndex: 30,
                          width: "22px", height: "22px",
                          border: `2px solid ${selected ? colors.ink : colors.dimmer}`,
                          background: selected ? colors.ink : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.2s ease", pointerEvents: "none",
                          // In share mode, use a rounded indicator to signal single-select
                          borderRadius: shareMode ? "50%" : "0",
                        }}>
                          {selected && (
                            shareMode ? (
                              <span style={{
                                width: "8px", height: "8px", borderRadius: "50%",
                                background: colors.bg,
                              }} />
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke={colors.bg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )
                          )}
                        </div>
                      )}

                      {anyModeActive && !selected && (
                        <div style={{
                          position: "absolute", inset: 0,
                          background: isDark ? "rgba(232,228,216,0.04)" : "rgba(22,21,17,0.04)",
                          zIndex: 5, pointerEvents: "none"
                        }} />
                      )}

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
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{
                  width: 64, height: 64, margin: "0 auto 16px",
                  border: `1px solid ${colors.lineFaint}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "28px", color: colors.dimmer,
                  transition: "border-color 0.3s, color 0.3s",
                }}>
                  ◈
                </div>
                <p style={{
                  margin: 0,
                  fontSize: "13px",
                  color: colors.dim,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  transition: "color 0.3s",
                }}>
                  No entries here
                </p>
                <p style={{
                  margin: "4px 0 0",
                  fontSize: "11px",
                  color: colors.dimmer,
                  letterSpacing: "0.02em",
                  transition: "color 0.3s",
                }}>
                  Save some links to see them in this folder.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

//#endregion