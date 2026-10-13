// components/customNotificationBanner.tsx
import React from "react"
import { motion, AnimatePresence } from "framer-motion"

// ─── NotificationBanner ───────────────────────────────────────────────────────
// Generic top-of-page notice. Accent color is chosen by `variant`, and the
// primary action is optional so it can be a pure informational banner.
//
// Styling is entirely CSS-variable driven (see `.wisp-banner` and variants in
// styles/themes.css). No theme prop, no color palette passed in — a theme
// switch is a single `data-theme` flip on <html> with zero React work here.

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
}

const DEFAULT_ICON: Record<BannerVariant, React.ReactNode> = {
  info:    "▸",
  warning: "◈",
  danger:  "✕",
  success: "⛨",
}

const NotificationBanner = React.memo(function NotificationBanner({
  show,
  title,
  message,
  variant = "info",
  icon,
  actionLabel,
  onAction,
  onDismiss,
}: NotificationBannerProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className={`wisp-banner wisp-banner--${variant}`}
        >
          <div className="wisp-banner__left">
            <span className="wisp-banner__icon">
              {icon ?? DEFAULT_ICON[variant]}
            </span>
            <div style={{ minWidth: 0 }}>
              <p className="wisp-banner__title">{title}</p>
              <p className="wisp-banner__msg">{message}</p>
            </div>
          </div>

          <div className="wisp-banner__right">
            {actionLabel && onAction && (
              <button onClick={onAction} className="wisp-banner__cta">
                {actionLabel}
              </button>
            )}
            <button
              onClick={onDismiss}
              title="Dismiss"
              className="wisp-banner__close"
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