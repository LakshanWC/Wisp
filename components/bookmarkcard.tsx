import React, { useState, useEffect } from "react"
import "styles/themes.css"
import { loadFavicon } from "~scripts/faviconHelper"

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

//#region ─── SVG Icons ──────────────────────────────────────────────────────

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

const ArrowIcon = ({ size = 12 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </svg>
)
//#endregion

//#region ─── Favicon ────────────────────────────────────────────────────────

const FaviconFrame = ({ url }: { url?: string }) => {
  const [faviconDataUrl, setFaviconDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadCachedFavicon = async () => {
      if (!url) { setLoading(false); return }

      let domain = ""
      try { domain = new URL(url).hostname } catch { setLoading(false); return }
      if (!domain) { setLoading(false); return }

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
    return () => { isMounted = false }
  }, [url])

  const showFallback = loading || failed || !faviconDataUrl

  return (
    <div className="wisp-favicon">
      {showFallback ? (
        <span className="wisp-favicon__fallback">
          <LinkIcon size={12} />
        </span>
      ) : (
        <img
          src={faviconDataUrl}
          alt=""
          width={14}
          height={14}
          onError={() => { setFailed(true); setFaviconDataUrl(null) }}
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

function formatDate(timestamp: string | number) {
  return new Date(timestamp).toLocaleString()
}

//#region ─── BookmarkCard ───────────────────────────────────────────────────

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
  const displayUrl = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : ""

  // Only per-card dynamic value left: the left accent bar color when a
  // custom `color` is passed. We publish it as a CSS variable so the
  // pseudo-element picks it up, and the theme system never touches it.
  const accentStyle: React.CSSProperties =
    !isPrivate && color
      ? ({
          ["--card-accent-idle" as any]: color,
          ["--card-accent-hover" as any]: color,
        } as React.CSSProperties)
      : {}

  return (
    <div
      className={`wisp-card${isPrivate ? " is-private" : ""}`}
      onClick={onClick}
      style={accentStyle}
    >
      <div className="wisp-card__content">
        {/* ── Header Row ─────────────────────────────────────────────────── */}
        <div className="wisp-card__header">
          <div className="wisp-card__header-left">
            <FaviconFrame url={url} />
            <h3 className="wisp-card__title">{title}</h3>
          </div>

          {isPrivate && (
            <div className="wisp-card__badge">
              <LockIcon size={9} />
              <span>Private</span>
            </div>
          )}
        </div>

        {/* ── Description ─────────────────────────────────────────────────── */}
        {description && description !== "No description" && (
          <p className="wisp-card__desc">{description}</p>
        )}
      </div>

      {/* ── Footer Section ──────────────────────────────────────────────── */}
      <div className="wisp-card__footer">
        {/* ── URL + Date Row ────────────────────────────────────────────── */}
        <div className="wisp-card__meta">
          {url && (
            <div className="wisp-card__url-wrap">
              <span className="wisp-card__icon">
                <LinkIcon size={10} />
              </span>
              <p className="wisp-card__url">{displayUrl}</p>
            </div>
          )}
          {date && <p className="wisp-card__date">{formatDate(date)}</p>}
        </div>

        {/* ── Action Buttons Row ────────────────────────────────────────── */}
        <div className="wisp-card__actions">
          <button
            type="button"
            className="wisp-btn wisp-btn--visit"
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                e.stopPropagation()
                if (url) window.open(url, "_blank")
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (url) window.open(url, "_blank")
            }}
          >
            Visit Site
            <span className="wisp-btn__arrow">
              <ArrowIcon size={10} />
            </span>
          </button>

          {onTogglePrivate && (
            <button
              type="button"
              className={`wisp-btn wisp-btn--private${isPrivate ? " is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePrivate(e)
              }}
              title={isPrivate ? "Remove from private" : "Hide in private view"}
            >
              {isPrivate ? <LockIcon size={11} /> : <UnlockIcon size={11} />}
              <span>{isPrivate ? "Private" : "Hide"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
//#endregion