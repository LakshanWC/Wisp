import React from "react"
import { motion, AnimatePresence } from "framer-motion"

// ─── NotificationBanner ───────────────────────────────────────────────────────
// Generic top-of-page notice. Accent color is chosen by `variant`, and the
// primary action is optional so it can be a pure informational banner.

export type BannerVariant = "info" | "warning" | "danger" | "success"

export interface BannerPayload {
  title: string
  message: React.ReactNode
  variant?: BannerVariant
  icon?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
}

export interface NotificationBannerProps extends BannerPayload {
  show: boolean
  onDismiss: () => void
  colors: any
  isDark?: boolean
}

//#region Notification Banner
const NotificationBanner = React.memo(function NotificationBanner({
  show,
  title,
  message,
  variant = "info",
  icon,
  actionLabel,
  onAction,
  onDismiss,
  colors,
  isDark,
}: NotificationBannerProps) {
  // Map variant → accent color from the theme palette
  const accent =
    variant === "danger"  ? colors.rust  :
    variant === "warning" ? colors.amber :
    variant === "success" ? colors.sage  :
    colors.ink

  const defaultIcon =
    variant === "danger"  ? "✕" :
    variant === "warning" ? "◈" :
    variant === "success" ? "⛨" :
    "▸"

  // Translucent background tint per variant
  const bgTint =
    variant === "danger"  ? (isDark ? "rgba(184,52,31,0.15)" : "rgba(184,52,31,0.08)") :
    variant === "warning" ? (isDark ? "rgba(163,116,47,0.15)" : "rgba(163,116,47,0.08)") :
    variant === "success" ? (isDark ? "rgba(74,93,79,0.18)"   : "rgba(74,93,79,0.08)")   :
    (isDark ? "rgba(232,228,216,0.06)" : "rgba(22,21,17,0.04)")

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
            background: bgTint,
            border: `1px solid ${accent}55`,
            padding: "12px 16px", marginBottom: "20px", overflow: "hidden",
            transition: "background-color 0.3s, border-color 0.3s",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <span style={{ fontSize: "16px", flexShrink: 0, color: accent }}>
              {icon ?? defaultIcon}
            </span>
            <div style={{ minWidth: 0 }}>
              <p style={{
                margin: 0, color: accent,
                fontWeight: 700, fontSize: "12px",
                letterSpacing: "0.05em", textTransform: "uppercase",
                transition: "color 0.3s",
              }}>
                {title}
              </p>
              <p style={{
                margin: "2px 0 0", color: colors.dim,
                fontSize: "11px",
                transition: "color 0.3s",
              }}>
                {message}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {actionLabel && onAction && (
              <button
                onClick={onAction}
                style={{
                  padding: "7px 14px",
                  border: `1px solid ${accent}`,
                  background: accent,
                  color: colors.bg,
                  fontSize: "11px", fontWeight: 600, cursor: "pointer",
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  fontFamily: colors.mono,
                  transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                }}
              >
                {actionLabel}
              </button>
            )}
            <button
              onClick={onDismiss}
              title="Dismiss"
              style={{
                background: "none", border: "none", color: colors.dim,
                cursor: "pointer", fontSize: "16px", padding: "0 4px", lineHeight: 1,
                transition: "color 0.3s",
              }}
            >
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

export default NotificationBanner
//#endregion