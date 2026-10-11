// QRScreenModal.tsx
import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { generateQRCode } from "scripts/qrGenerator"
import type { UrlShareObject, QRResult } from "scripts/qrGenerator"

//#region ─── style design tokens  ───────

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

function Bracket({ children, style, theme }: { children: React.ReactNode; style?: React.CSSProperties; theme?: string }) {
  const colors = getThemeColors(theme || "light")
  return (
    <span style={{ fontFamily: colors.mono, letterSpacing: "0.08em", ...style }}>
      [ {children} ]
    </span>
  )
}

//#endregion

//#region ─── SpinnerIcon  ────────────

function SpinnerIcon({ size = 14, color }: { size?: number; color?: string }) {
  const col = color || "#161511"
  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
      style={{ flexShrink: 0, pointerEvents: "none" }}
    >
      <rect x="2" y="2" width="20" height="20" stroke={col} strokeWidth="2" strokeOpacity="0.25" />
      <path d="M2 12h8M14 2v8" stroke={col} strokeWidth="2.5" strokeLinecap="square" />
    </motion.svg>
  )
}
//#endregion

//#region ─── QRScreenModal ─────────

type QRScreenModalProps = {
  url: string
  onClose?: () => void
  theme?: string
}

export default function QRScreenModal({ url, onClose, theme = "light" }: QRScreenModalProps) {
  const colors = getThemeColors(theme)
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setQrDataUrl(null)

    const input: UrlShareObject = { url }

    generateQRCode(input).then((result: QRResult) => {
      if (cancelled) return
      if (result.ok) {
        setQrDataUrl(result.dataUrl)
      } else {
        setError(result.error)
      }
    })

    return () => {
      cancelled = true
    }
  }, [url])

  const handleCopyUrl = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: isDark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        fontFamily: colors.mono,
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          maxWidth: "440px",
          width: "100%",
          padding: "28px 28px 24px",
          boxShadow: isDark
            ? "8px 8px 0 rgba(0,0,0,0.5)"
            : "8px 8px 0 rgba(22,21,17,0.15)",
          position: "relative",
          transition: "background-color 0.3s, border-color 0.3s",
        }}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: "12px",
              right: "16px",
              background: "none",
              border: "none",
              color: colors.dim,
              fontSize: "20px",
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
              transition: "color 0.3s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.ink }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.dim }}
          >
            ✕
          </button>
        )}

        {/* Header */}
        <div style={{ marginBottom: "6px" }}>
          <h2
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: colors.ink,
              margin: 0,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}
          >
            ⇱ Share Entry
          </h2>
          <p
            style={{
              color: colors.dim,
              margin: "6px 0 0",
              fontSize: "11px",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}
          >
            // QR TRANSMISSION
          </p>
        </div>

        <div
          style={{
            borderTop: `1px solid ${colors.lineFaint}`,
            marginTop: "16px",
            paddingTop: "20px",
          }}
        >
          {/* QR frame — bordered box with corner ticks, like an archive panel */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              background: colors.bgPanel,
              border: `1px solid ${colors.lineFaint}`,
              minHeight: "300px",
              transition: "background-color 0.3s, border-color 0.3s",
            }}
          >
            {/* corner ticks */}
            {[
              { top: -1, left: -1, borderTop: `2px solid ${colors.ink}`, borderLeft: `2px solid ${colors.ink}` },
              { top: -1, right: -1, borderTop: `2px solid ${colors.ink}`, borderRight: `2px solid ${colors.ink}` },
              { bottom: -1, left: -1, borderBottom: `2px solid ${colors.ink}`, borderLeft: `2px solid ${colors.ink}` },
              { bottom: -1, right: -1, borderBottom: `2px solid ${colors.ink}`, borderRight: `2px solid ${colors.ink}` },
            ].map((s, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  width: "10px",
                  height: "10px",
                  transition: "border-color 0.3s",
                  ...s,
                }}
              />
            ))}

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    textAlign: "center",
                    color: colors.rust,
                    fontSize: "12px",
                    letterSpacing: "0.04em",
                    padding: "20px 0",
                  }}
                >
                  <div style={{ fontSize: "13px", marginBottom: "10px" }}>
                    <Bracket theme={theme}>TRANSMISSION FAILED</Bracket>
                  </div>
                  <p style={{ margin: 0, color: colors.dim, fontSize: "11px", lineHeight: 1.6 }}>
                    {error}
                  </p>
                </motion.div>
              )}

              {!error && !qrDataUrl && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "14px",
                    color: colors.dim,
                    fontSize: "11px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  <SpinnerIcon size={22} color={colors.dim} />
                  Generating QR…
                </motion.div>
              )}

              {qrDataUrl && !error && (
                <motion.img
                  key="qr"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  src={qrDataUrl}
                  alt="QR code for sharing"
                  style={{
                    width: "256px",
                    height: "256px",
                    display: "block",
                    imageRendering: "pixelated",
                  }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* URL + copy row */}
          <div
            style={{
              marginTop: "16px",
              display: "flex",
              alignItems: "stretch",
              gap: "8px",
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${colors.lineFaint}`,
                background: colors.bg,
                padding: "9px 12px",
                fontSize: "11px",
                color: colors.dim,
                fontFamily: colors.mono,
                letterSpacing: "0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              }}
              title={url}
            >
              ▸ {url}
            </div>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ y: 0 }}
              onClick={handleCopyUrl}
              style={{
                padding: "9px 14px",
                border: `1px solid ${copied ? colors.sage : colors.line}`,
                background: copied ? colors.sage : "transparent",
                color: copied ? colors.bg : colors.ink,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: colors.mono,
                whiteSpace: "nowrap",
                transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </motion.button>
          </div>

          {/* Footer hint */}
          <p
            style={{
              margin: "14px 0 0",
              fontSize: "10px",
              color: colors.dimmer,
              letterSpacing: "0.03em",
              lineHeight: 1.6,
              transition: "color 0.3s",
            }}
          >
            • Scan with any QR reader to open this entry
            <br />
            • Generated locally
          </p>
        </div>
      </motion.div>
    </div>
  )
}
//#endregion