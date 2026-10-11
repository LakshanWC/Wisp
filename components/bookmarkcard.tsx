import React, { useState, useEffect } from "react"
import "styles/themes.css"
import { loadFavicon } from "~scripts/faviconHelper"
import { useTheme } from '../scripts/themeProvider'

//#region ─── styleing design ────────
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

interface BookmarkCardProps {
  title: string
  description?: string
  url?: string
  date?: string
  color?: string
  isPrivate?: boolean
  onTogglePrivate?: (e: React.MouseEvent) => void
  onClick?: () => void
}
//#endregion

//#region  ───  SVG Icons ──────────

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

const LinkIcon = ({ size = 12 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
)

const ArrowIcon = ({ size = 12, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none", ...style }}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </svg>
)
//#endregion

//#region ─── Favicon ────────
const FaviconFrame = ({
  url,
  hovered,
  colors,
}: {
  url?: string
  hovered: boolean
  colors: ReturnType<typeof getThemeColors>
}) => {
  const [faviconDataUrl, setFaviconDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadCachedFavicon = async () => {
      if (!url) {
        setLoading(false)
        return
      }

      let domain = ""
      try {
        domain = new URL(url).hostname
      } catch {
        setLoading(false)
        return
      }

      if (!domain) {
        setLoading(false)
        return
      }

      try {
        const cachedDataUrl = await loadFavicon(domain)
        if (isMounted) {
          if (cachedDataUrl) {
            setFaviconDataUrl(cachedDataUrl)
            setFailed(false)
          } else {
            setFailed(true)
          }
          setLoading(false)
        }
      } catch (error) {
        if (isMounted) {
          console.error(`Failed to load favicon for ${domain}:`, error)
          setFailed(true)
          setLoading(false)
        }
      }
    }

    loadCachedFavicon()

    return () => {
      isMounted = false
    }
  }, [url])

  const showFallback = loading || failed || !faviconDataUrl

  return (
    <div
      style={{
        width: "26px",
        height: "26px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${hovered ? colors.line : colors.lineFaint}`,
        background: colors.bgPanel,
        transition: "border-color 0.3s",
      }}
    >
      {showFallback ? (
        <span style={{ color: colors.dimmer, display: "flex", transition: "color 0.3s" }}>
          <LinkIcon size={12} />
        </span>
      ) : (
        <img
          src={faviconDataUrl}
          alt=""
          width={14}
          height={14}
          onError={() => {
            setFailed(true)
            setFaviconDataUrl(null)
          }}
          style={{
            display: "block",
            imageRendering: "pixelated",
            objectFit: "contain",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  )
}
//#endregion

function formatDate(timestamp){
  return new Date(timestamp).toLocaleString();
}

//#region ---- BookmarkCard -----
export default function BookmarkCard({
  title,
  description = "No description",
  url,
  date,
  color,
  isPrivate = false,
  onTogglePrivate,
  onClick,
}: BookmarkCardProps) {
  const { theme } = useTheme()
  const colors = getThemeColors(theme)
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  const [hovered, setHovered] = useState(false)
  const [btnHovered, setBtnHovered] = useState(false)
  const [privateBtnHovered, setPrivateBtnHovered] = useState(false)

  // Shorten URL for display
  const displayUrl = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : ""

  // Use the provided color or fallback
  const accentColor = isPrivate ? colors.ink : (color || colors.ink)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: colors.bg,
        padding: "20px",
        border: `1px solid ${isPrivate ? colors.line : hovered ? colors.line : colors.lineFaint}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: "160px",
        cursor: "pointer",
        position: "relative",
        boxShadow: hovered
          ? isDark
            ? `4px 4px 0 rgba(0,0,0,0.4)`
            : `4px 4px 0 ${isPrivate ? colors.ink : colors.dim}15`
          : "none",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        fontFamily: colors.mono,
        zIndex: hovered ? 2 : 1,
        isolation: "isolate",
      }}
    >
      {/* ── Corner accent (style) — DECORATIVE, must not eat clicks ── */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "2px",
        height: "100%",
        background: isPrivate ? colors.ink : hovered ? colors.dim : colors.lineFaint,
        transition: "background 0.3s ease",
        pointerEvents: "none",   // ← FIX
        zIndex: 0,
      }} />

      {/* ── Top-left corner frame — DECORATIVE ── */}
      <div style={{
        position: "absolute",
        top: "8px",
        left: "8px",
        width: "12px",
        height: "12px",
        borderTop: `1px solid ${hovered ? colors.line : colors.lineFaint}`,
        borderLeft: `1px solid ${hovered ? colors.line : colors.lineFaint}`,
        opacity: hovered ? 1 : 0.3,
        transition: "all 0.3s ease",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "10px", pointerEvents: "none" }}>

        {/* ── Header Row: Favicon + Title + Badge ─────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", overflow: "hidden" }}>
            <FaviconFrame url={url} hovered={hovered} colors={colors} />
            <h3 style={{
              margin: 0,
              marginTop: "2px",
              fontSize: "14px",
              fontWeight: 700,
              lineHeight: 1.4,
              color: hovered ? colors.ink : colors.dim,
              letterSpacing: "0.02em",
              transition: "color 0.3s",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textTransform: "uppercase",
            }}>
              {title}
            </h3>
          </div>

          {/* ── Private Badge ────────────────────────────────────────────────── */}
          {isPrivate && (
            <div style={{
              border: `1px solid ${colors.line}`,
              padding: "4px 10px",
              fontSize: "9px",
              fontWeight: 700,
              color: colors.ink,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              flexShrink: 0,
              background: colors.bgPanel,
              transition: "background-color 0.3s, border-color 0.3s, color 0.3s",
            }}>
              <LockIcon size={9} />
              <span>Private</span>
            </div>
          )}
        </div>

        {/* ── Description ───────────────────────────────────────────────────── */}
        {description && description !== "No description" && (
          <p style={{
            margin: 0,
            fontSize: "12px",
            color: colors.dimmer,
            lineHeight: 1.5,
            letterSpacing: "0.02em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            transition: "color 0.3s",
          }}>
            {description}
          </p>
        )}
      </div>

      {/* ── Footer Section ──────────────────────────────────────────────────── */}
      {/* Re-enable pointer events here so buttons inside are clickable */}
      <div style={{ marginTop: "auto", paddingTop: "16px", position: "relative", zIndex: 2, pointerEvents: "auto" }}>

        {/* ── URL + Date Row ────────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "14px",
          gap: "12px",
          pointerEvents: "none",
        }}>
          {url && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
              <span style={{ color: colors.dimmer, display: "flex", transition: "color 0.3s" }}>
                <LinkIcon size={10} />
              </span>
              <p style={{
                fontSize: "10px",
                color: hovered ? colors.dim : colors.dimmer,
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 500,
                transition: "color 0.3s",
                letterSpacing: "0.02em",
              }}>
                {displayUrl}
              </p>
            </div>
            
          )}
          {date && (
            <p style={{
              fontSize: "10px",
              color: colors.dimmer,
              margin: 0,
              whiteSpace: "nowrap",
              flexShrink: 0,
              fontWeight: 600,
              letterSpacing: "0.04em",
              transition: "color 0.3s",
            }}>
              {formatDate(date)}
            </p>
          )}
        </div>

        {/* ── Action Buttons Row ───────────────────────────────────────────── */}
        {/* Explicit position + z-index so the buttons always win hit-testing */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          position: "relative",
          zIndex: 3,
          pointerEvents: "auto",
        }}>
          {/* ── Visit Button ────────────────────────────────────────────────── */}
          <button
            type="button"
            onMouseEnter={() => setBtnHovered(true)}
            onMouseLeave={() => setBtnHovered(false)}
            onMouseDown={(e) => {
                  if (e.button === 1) {
                e.preventDefault()   // prevents auto-scroll cursor
                e.stopPropagation()
                if (url) {
                  window.open(url, "_blank")
                }
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (url) window.open(url, "_blank")
            }}
            style={{
              flex: 1,
              padding: "8px 16px",
              backgroundColor: btnHovered ? colors.ink : "transparent",
              color: btnHovered ? colors.bg : colors.ink,
              border: `1px solid ${btnHovered ? colors.ink : colors.line}`,
              fontSize: "10px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              fontFamily: colors.mono,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              position: "relative",
              zIndex: 10,
              pointerEvents: "auto",
            }}
          >
            Visit Site
            <ArrowIcon size={10} style={{
              transform: btnHovered ? "translateX(2px)" : "translateX(0)",
              transition: "transform 0.2s",
            }} />
          </button>

          {/* ── Private Toggle Button ──────────────────────────────────────── */}
          {onTogglePrivate && (
            <button
              type="button"
              onMouseEnter={() => setPrivateBtnHovered(true)}
              onMouseLeave={() => setPrivateBtnHovered(false)}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePrivate(e)
              }}
              style={{
                padding: "8px 14px",
                backgroundColor: isPrivate
                  ? colors.bgPanel
                  : privateBtnHovered
                    ? colors.bgPanel
                    : "transparent",
                color: isPrivate ? colors.ink : colors.dimmer,
                border: `1px solid ${isPrivate ? colors.line : privateBtnHovered ? colors.line : colors.lineFaint}`,
                fontSize: "9px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontFamily: colors.mono,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                position: "relative",
                zIndex: 10,
                pointerEvents: "auto",
              }}
              title={isPrivate ? "Remove from private" : "Hide in private view"}
            >
              {isPrivate ? <LockIcon size={11} /> : <UnlockIcon size={11} />}
              <span style={{ pointerEvents: "none" }}>{isPrivate ? "Private" : "Hide"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
//#endregion