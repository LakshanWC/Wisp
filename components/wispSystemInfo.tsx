// components/SettingsModal.tsx
import React, { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { browserApi } from "~scripts/storage"
import { REQUIRED_PERMISSIONS } from "~scripts/extentionRequestedPermissons"
import { SpinnerIcon } from "~components/customspinner"
import BugReportModal from "~components/bugReportModal"
import { getCurrentInstalledVersion } from "~scripts/sendBugReport"
import { getUpdateDetails } from "~scripts/newUpdateDetailFetcher"
import type {
  LocalizedText,
  BrowserKey,
  ChangelogEntry,
  ChangelogNote,
  LatestVersionMap,
  PaidVersion,
  Promotion,
  UpcomingVersion,
  UpdateDetails,
} from "~scripts/jsonDataStructher"

export const CURRENT_VERSION = getCurrentInstalledVersion()

const RELEASE_CACHE_KEY = "wisp_release_info"
const RELEASE_CACHE_TTL = 1000 * 1 //60 * 60 *12 // 12h

//#region ─── Placeholder guards ────────────
// The remote JSON uses the literal string "null" as a placeholder value for
// fields that haven't been filled in yet. Treat it (and empty strings) as
// "no value" so we never render a card full of "null".
function isPlaceholder(v: unknown): boolean {
  if (v == null) return true
  if (typeof v !== "string") return false
  const t = v.trim().toLowerCase()
  return t === "" || t === "null" || t === "undefined" || t === "n/a"
}

function hasText(v: unknown): boolean {
  return !isPlaceholder(v)
}

function hasLocalizedText(v: { en?: string } | null | undefined): boolean {
  return !!v && hasText(v.en)
}
//#endregion

//#region ─── Scrollbar styling ─────
// Injected once. Themed via CSS custom properties that we update from React
// so light/dark/high-contrast modes all get a matching scrollbar.
const SCROLLBAR_STYLE_ID = "wisp-scrollbar-style"

function ensureScrollbarStyle() {
  if (typeof document === "undefined") return
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = SCROLLBAR_STYLE_ID
  style.textContent = `
    .wisp-scroll {
      scrollbar-width: thin;
      scrollbar-color: var(--wisp-sb-thumb) var(--wisp-sb-track);
    }
    .wisp-scroll::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    .wisp-scroll::-webkit-scrollbar-track {
      background: var(--wisp-sb-track);
    }
    .wisp-scroll::-webkit-scrollbar-thumb {
      background: var(--wisp-sb-thumb);
      border: 2px solid var(--wisp-sb-track);
    }
    .wisp-scroll::-webkit-scrollbar-thumb:hover {
      background: var(--wisp-sb-thumb-hover);
    }
    .wisp-scroll::-webkit-scrollbar-corner {
      background: var(--wisp-sb-track);
    }
  `
  document.head.appendChild(style)
}

function scrollbarVars(colors: any, isDark: boolean): React.CSSProperties {
  return {
    ["--wisp-sb-track" as any]: isDark
      ? "rgba(0,0,0,0.25)"
      : "rgba(22,21,17,0.06)",
    ["--wisp-sb-thumb" as any]: isDark
      ? "rgba(232,228,216,0.18)"
      : "rgba(22,21,17,0.28)",
    ["--wisp-sb-thumb-hover" as any]: colors?.amber ?? "#c8a03c",
  }
}

//#endregion

//#region ─── Helpers ─────────

function currentBrowser(): BrowserKey {
  const ua = (globalThis as any).navigator?.userAgent?.toLowerCase?.() ?? ""
  if (ua.includes("firefox")) return "firefox"
  if (ua.includes("edg/")) return "edge"
  return "chrome"
}

// Tiny semver compare — assumes "x.y.z", no prerelease tags.
export function isNewer(latest: string | null | undefined, current: string) {
  if (!latest) return false
  const a = latest.split(".").map(Number)
  const b = current.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

function pickLatestForThisBrowser(details: UpdateDetails): string | null {
  return details.freeVersion?.latestVersion?.[currentBrowser()] ?? null
}

function pickDownloadUrl(details: UpdateDetails): string | null {
  const b = currentBrowser()
  return (
    details.freeVersion?.downloadUrls?.[b] ??
    details.freeVersion?.downloadUrls?.default ??
    null
  )
}
//#endregion

//#region ─── Release info hook ────────

export function useReleaseInfo(enabled: boolean) {
  const [data, setData] = useState<UpdateDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      const minSpin = new Promise((r) => setTimeout(r, 800))

      try {
        const cached = await browserApi.storage.local.get(RELEASE_CACHE_KEY)
        const entry = cached?.[RELEASE_CACHE_KEY] as
          | { at: number; data: UpdateDetails }
          | undefined

        if (entry && Date.now() - entry.at < RELEASE_CACHE_TTL) {
          await minSpin
          if (!cancelled) {
            setData(entry.data)
            setLoading(false)
          }
          return
        }

        const json = (await getUpdateDetails()) as unknown as UpdateDetails
        if (!json || typeof json !== "object" || !("freeVersion" in json)) {
          throw new Error("Malformed update details")
        }

        await browserApi.storage.local.set({
          [RELEASE_CACHE_KEY]: { at: Date.now(), data: json },
        })

        await minSpin
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch (e: any) {
        await minSpin
        if (!cancelled) {
          setError(e?.message ?? "Could not check for updates")
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { data, loading, error }
}

// Peek at the cached release so the header can show a dot without firing a fetch.
export async function peekHasNews(): Promise<boolean> {
  try {
    const cached = await browserApi.storage.local.get(RELEASE_CACHE_KEY)
    const entry = cached?.[RELEASE_CACHE_KEY] as
      | { at: number; data: UpdateDetails }
      | undefined
    if (!entry?.data?.freeVersion) return false
    const latest = pickLatestForThisBrowser(entry.data)
    return isNewer(latest, CURRENT_VERSION)
  } catch {
    return false
  }
}
//#endregion

//#region ─── Shared bits ──────────

function SectionLabel({
  children,
  colors,
}: {
  children: React.ReactNode
  colors: any
}) {
  return (
    <div
      style={{
        fontSize: "10px",
        color: colors.dim,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: "10px",
        transition: "color 0.3s",
      }}
    >
      {children}
    </div>
  )
}

function PanelRow({
  children,
  colors,
  isDark,
  style,
}: {
  children: React.ReactNode
  colors: any
  isDark: boolean
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 12px",
        border: `1px solid ${colors.lineFaint}`,
        background: isDark ? "rgba(232,228,216,0.02)" : "rgba(22,21,17,0.02)",
        transition: "background-color 0.3s, border-color 0.3s",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function ModalShell({
  children,
  onClose,
  theme,
  colors,
  width = 520,
}: {
  children: React.ReactNode
  onClose: () => void
  theme: string
  colors: any
  width?: number
}) {
  const isDark = theme === "dark" || theme === "high-contrast-dark"
  const [styleReady, setStyleReady] = useState(false)

  useEffect(() => {
    ensureScrollbarStyle()
    setStyleReady(true)
  }, [])

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
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="wisp-scroll"
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          maxWidth: `${width}px`,
          width: "100%",
          padding: "32px",
          boxShadow: isDark
            ? "8px 8px 0 rgba(0,0,0,0.5)"
            : "8px 8px 0 rgba(22,21,17,0.15)",
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative",
          transition: "background-color 0.3s, border-color 0.3s",
          ...(styleReady ? scrollbarVars(colors, isDark) : {}),
        }}
      >
        <button
          onClick={onClose}
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
            transition: "color 0.3s",
            zIndex: 2,
          }}
        >
          ✕
        </button>
        {children}
      </motion.div>
    </div>
  )
}

function ModalTitle({
  children,
  colors,
}: {
  children: React.ReactNode
  colors: any
}) {
  return (
    <h2
      style={{
        fontSize: "16px",
        fontWeight: 700,
        color: colors.ink,
        margin: "0 0 20px 0",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontFamily: colors.mono,
        transition: "color 0.3s",
      }}
    >
      {children}
    </h2>
  )
}
//#endregion

//#region ─── SYSTEM panel ───────

// A single row in the Data & Privacy list. Keeps the bullet + body text
// aligned so multi-line items don't wrap under the bullet.
function PrivacyItem({
  bullet,
  colors,
  children,
}: {
  bullet: string
  colors: any
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "flex-start",
        lineHeight: 1.6,
      }}
    >
      <span
        style={{
          color: colors.sage,
          flexShrink: 0,
          lineHeight: 1.6,
        }}
      >
        {bullet}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  )
}

export const SystemPanel = React.memo(function SystemPanel({
  isOpen,
  onClose,
  theme,
  colors,
}: {
  isOpen: boolean
  onClose: () => void
  theme: string
  colors: any
}) {
  const isDark = theme === "dark" || theme === "high-contrast-dark"
  const [permissionsOpen, setPermissionsOpen] = useState(false)

  if (!isOpen) return null

  return (
    <ModalShell onClose={onClose} theme={theme} colors={colors} width={560}>
      <ModalTitle colors={colors}>[ SYSTEM ]</ModalTitle>

      <div style={{ marginBottom: "24px" }}>
        <SectionLabel colors={colors}>▸ About</SectionLabel>
        <PanelRow colors={colors} isDark={isDark}>
          <div>
            <div
              style={{
                fontSize: "13px",
                color: colors.ink,
                fontWeight: 600,
                letterSpacing: "0.04em",
                transition: "color 0.3s",
              }}
            >
              Wisp · v{CURRENT_VERSION}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: colors.dim,
                marginTop: "4px",
                lineHeight: 1.5,
                transition: "color 0.3s",
              }}
            >
              A local-first bookmark manager. Categories, link health, and
              private entries — all stored in your browser.
            </div>
          </div>
        </PanelRow>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <button
          type="button"
          onClick={() => setPermissionsOpen((v) => !v)}
          aria-expanded={permissionsOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            width: "100%",
            padding: 0,
            margin: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <motion.span
            animate={{ rotate: permissionsOpen ? 90 : 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              display: "inline-block",
              fontSize: "10px",
              color: colors.dim,
              lineHeight: 1,
              transformOrigin: "50% 50%",
            }}
          >
            ▸
          </motion.span>
          <span
            style={{
              fontSize: "10px",
              color: colors.dim,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              transition: "color 0.3s",
            }}
          >
            Permissions
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "10px",
              color: colors.dimmer,
              letterSpacing: "0.06em",
              fontFamily: colors.mono,
              transition: "color 0.3s",
            }}
          >
            {permissionsOpen ? "hide" : `${REQUIRED_PERMISSIONS.length}`}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {permissionsOpen && (
            <motion.div
              key="permissions-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ paddingTop: "10px" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {REQUIRED_PERMISSIONS.map((p) => (
                    <PanelRow key={p.name} colors={colors} isDark={isDark}>
                      <span
                        style={{
                          color: colors.amber,
                          fontSize: "12px",
                          lineHeight: "18px",
                          flexShrink: 0,
                        }}
                      >
                        {p.icon}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <code
                          style={{
                            fontFamily: colors.mono,
                            fontSize: "11.5px",
                            color: colors.ink,
                            letterSpacing: "0.02em",
                            transition: "color 0.3s",
                          }}
                        >
                          {p.name}
                          {p.optional && (
                            <span
                              style={{
                                marginLeft: "8px",
                                color: colors.dim,
                                fontSize: "10px",
                                letterSpacing: "0.06em",
                              }}
                            >
                              [optional]
                            </span>
                          )}
                        </code>
                        <div
                          style={{
                            fontSize: "11px",
                            color: colors.dim,
                            marginTop: "4px",
                            lineHeight: 1.5,
                            transition: "color 0.3s",
                          }}
                        >
                          {p.why}
                        </div>
                      </div>
                    </PanelRow>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 12px",
                    background: isDark
                      ? "rgba(74,93,79,0.12)"
                      : "rgba(74,93,79,0.07)",
                    borderLeft: `2px solid ${colors.sage}`,
                    fontSize: "11px",
                    color: colors.dim,
                    lineHeight: 1.6,
                    transition: "background-color 0.3s, border-color 0.3s",
                  }}
                >
                  <code style={{ fontFamily: colors.mono }}>http://*/*</code>{" "}
                  and{" "}
                  <code style={{ fontFamily: colors.mono }}>https://*/*</code>{" "}
                  — check whether your saved links still work. Wisp sends a
                  HEAD request from your browser straight to each saved site,
                  without cookies, and never reads page contents.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div>
        <SectionLabel colors={colors}>▸ Data & Privacy</SectionLabel>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            fontSize: "11px",
            color: colors.dim,
            transition: "color 0.3s",
          }}
        >
          <PrivacyItem bullet="›" colors={colors}>
            Everything Wisp stores lives in{" "}
            <code style={{ fontFamily: colors.mono }}>
              browser.storage.local
            </code>{" "}
            on this device.
          </PrivacyItem>

          <PrivacyItem bullet="›" colors={colors}>
            No accounts, no telemetry, no analytics.
          </PrivacyItem>

          <PrivacyItem bullet="›" colors={colors}>
            Link checks contact only the sites you saved.
          </PrivacyItem>

          {/* Only include this line if you keep Google favicons: */}
          <PrivacyItem bullet="›" colors={colors}>
            Site icons come from Google's favicon service, which sees the
            domain name of each saved site.
          </PrivacyItem>

          <div
            style={{
              marginTop: "6px",
              padding: "12px 14px",
              background: isDark
                ? "rgba(74,93,79,0.10)"
                : "rgba(74,93,79,0.06)",
              border: `1px solid ${colors.sage}44`,
              transition: "background-color 0.3s, border-color 0.3s",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "6px",
                fontSize: "10px",
                color: colors.sage,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontFamily: colors.mono,
              }}
            >
              ⌘ Private vault
            </div>
            <div style={{ lineHeight: 1.65 }}>
              Encrypted on this device with AES-256-GCM. The key is derived
              from your password. If you lose both your password and your
              recovery key, it can't be opened — and uninstalling Wisp deletes
              it. Keep a backup.
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  )
})
//#endregion

//#region ─── UPDATES panel Styling─────────

const NOTE_META: Record<
  string,
  { glyph: string; label: string; tint: (c: any) => string }
> = {
  new: { glyph: "✦", label: "NEW", tint: (c) => c.amber },
  improved: { glyph: "▲", label: "IMPROVED", tint: (c) => c.sage },
  fixed: { glyph: "✚", label: "FIXED", tint: (c) => c.dim },
}

function Badge({
  children,
  color,
  colors,
}: {
  children: React.ReactNode
  color: string
  colors: any
}) {
  return (
    <span
      style={{
        fontFamily: colors.mono,
        fontSize: "9.5px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        padding: "2px 6px",
        border: `1px solid ${color}66`,
        color,
        background: `${color}14`,
        flexShrink: 0,
        transition: "color 0.3s, border-color 0.3s, background-color 0.3s",
      }}
    >
      {children}
    </span>
  )
}

// A thin divider between sections — gives visual breathing room without
// making the modal feel like a wall of text.
function Divider({ colors }: { colors: any }) {
  return (
    <div
      style={{
        height: "1px",
        background: colors.lineFaint,
        margin: "22px 0",
        transition: "background-color 0.3s",
      }}
    />
  )
}

// Section header with optional right-aligned action. Keeps headers consistent.
function SectionHeader({
  label,
  colors,
  action,
}: {
  label: string
  colors: any
  action?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "10px",
        minHeight: "16px",
      }}
    >
      <SectionLabel colors={colors}>{label}</SectionLabel>
      {action}
    </div>
  )
}
//#endregion

//#region ─── UpdatesPanel ───
export const UpdatesPanel = React.memo(function UpdatesPanel({
  isOpen,
  onClose,
  theme,
  colors,
}: {
  isOpen: boolean
  onClose: () => void
  theme: string
  colors: any
}) {
  const isDark = theme === "dark" || theme === "high-contrast-dark"
  const { data, loading, error } = useReleaseInfo(isOpen)
  const [showBugModal, setShowBugModal] = useState(false)
  const [showAllChangelog, setShowAllChangelog] = useState(false)

  const openTab = (url: string) => {
    browserApi.tabs.create({ url })
  }

  // ── Derived values ────────────────────────────────────────────────────
  const latestForBrowser = useMemo(
    () => (data ? pickLatestForThisBrowser(data) : null),
    [data]
  )
  const newer = isNewer(latestForBrowser, CURRENT_VERSION)
  const downloadUrl = useMemo(
    () => (data ? pickDownloadUrl(data) : null),
    [data]
  )

  const upcoming = useMemo(() => {
    if (!data) return []
    return [...(data.upcomingVersions ?? [])]
      .filter((u) => {
        if (!u) return false
        // Drop entries that are fully placeholder data.
        if (u.status === "released") return false
        if (isPlaceholder(u.status)) return false
        if (isPlaceholder(u.id)) return false
        if (isPlaceholder(u.version)) return false
        // Require at least one meaningful piece of content.
        const hasMessage = hasLocalizedText(u.message)
        const hasHighlights =
          Array.isArray(u.highlights) &&
          u.highlights.some((h) => hasLocalizedText(h?.text))
        return hasMessage || hasHighlights
      })
      .sort((a, b) => {
        const da = hasText(a.expectedDate) ? a.expectedDate! : "9999"
        const db = hasText(b.expectedDate) ? b.expectedDate! : "9999"
        return da.localeCompare(db)
      })
      .slice(0, 2)
  }, [data])

  const changelog = useMemo(() => {
    if (!data?.changelog) return []
    const cleaned = data.changelog
      .map((entry) => {
        if (!entry) return null
        const freeVer = entry.releases?.free
        const notes = (entry.notes ?? []).filter(
          (n) =>
            hasLocalizedText(n?.text) &&
            (!n.appliesTo?.length || n.appliesTo.includes("free"))
        )
        const hasVersion = hasText(freeVer)
        // A changelog entry is only worth showing if it has a version
        // and/or at least one real note.
        if (!hasVersion && notes.length === 0) return null
        return { ...entry, notes }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => {
        const da = hasText(a.date) ? a.date : ""
        const db = hasText(b.date) ? b.date : ""
        return db.localeCompare(da)
      })

    return showAllChangelog ? cleaned : cleaned.slice(0, 1)
  }, [data, showAllChangelog])

  const activePromo = useMemo(() => {
    const promo = data?.promotions?.find((p) => p?.enabled)
    if (!promo) return null
    // Require real title/message text — otherwise it's a placeholder.
    if (!hasLocalizedText(promo.title) && !hasLocalizedText(promo.message)) {
      return null
    }
    return promo
  }, [data])

  if (!isOpen) return null

  const flags = data?.featureFlags
  const banner = data?.statusBanner
  const bannerMessage = hasLocalizedText(banner?.message)
    ? banner!.message.en
    : null
  const bannerLink = hasText(banner?.link) ? banner!.link! : null

  // Paid version: only show if the name isn't a placeholder and there's
  // actually something to say (announcement or price or features).
  const paid = data?.paidVersion
  const paidHasContent =
    !!paid &&
    hasText(paid.name) &&
    (hasLocalizedText(paid.announcement) ||
      !!paid.price ||
      (Array.isArray(paid.features) &&
        paid.features.some((f) => hasLocalizedText(f?.name))))

  const showPaid =
    flags?.showPaidBanner !== false && paidHasContent && !!paid

  const showUpcoming = flags?.showUpcomingBanner !== false
  const showChangelog = flags?.showChangelogButton !== false

  // Which sections actually render — to decide where dividers go.
  const hasVersionSection = true
  const hasPromoSection = !!activePromo
  const hasUpcomingSection = showUpcoming && upcoming.length > 0
  const hasChangelogSection = showChangelog && changelog.length > 0
  const hasPaidSection = !!showPaid && !!paid
  const hasFeedbackSection = true

  return (
    <>
      <ModalShell onClose={onClose} theme={theme} colors={colors} width={560}>
        <ModalTitle colors={colors}>[ UPDATES ]</ModalTitle>

        {/* ── Status banner ─────────────────────────────────────────── */}
        {banner?.active && bannerMessage && (
          <div
            style={{
              marginBottom: "18px",
              padding: "10px 12px",
              border: `1px solid ${
                banner.level === "error"
                  ? "#c06060"
                  : banner.level === "warning"
                  ? colors.amber
                  : colors.line
              }`,
              background:
                banner.level === "error"
                  ? "rgba(192,96,96,0.10)"
                  : banner.level === "warning"
                  ? "rgba(200,160,60,0.10)"
                  : "rgba(0,0,0,0.04)",
              fontSize: "11px",
              color: colors.ink,
              lineHeight: 1.5,
              transition: "color 0.3s",
            }}
          >
            {bannerMessage}
            {bannerLink && (
              <button
                onClick={() => openTab(bannerLink)}
                style={{
                  marginLeft: "10px",
                  background: "none",
                  border: "none",
                  color: colors.amber,
                  fontFamily: colors.mono,
                  fontSize: "11px",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Details →
              </button>
            )}
          </div>
        )}

        {/* ── 1. VERSION ────────────────────────────────────────────── */}
        <div>
          <SectionHeader label="▸ Version" colors={colors} />
          <PanelRow colors={colors} isDark={isDark}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: colors.mono,
                    fontSize: "12px",
                    color: colors.ink,
                    transition: "color 0.3s",
                  }}
                >
                  Current · {CURRENT_VERSION}
                </span>
                {!loading && !error && data && !newer && (
                  <span
                    style={{
                      fontSize: "11px",
                      color: colors.sage,
                      transition: "color 0.3s",
                    }}
                  >
                    ✓ Up to date
                  </span>
                )}
                {!loading && !error && data && newer && latestForBrowser && (
                  <span
                    style={{
                      fontFamily: colors.mono,
                      fontSize: "12px",
                      color: colors.amber,
                      transition: "color 0.3s",
                    }}
                  >
                    → Latest · {latestForBrowser}
                  </span>
                )}
              </div>

              {loading && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "8px",
                    fontSize: "11px",
                    color: colors.dim,
                  }}
                >
                  <SpinnerIcon size={14} />
                  Checking for updates…
                </div>
              )}

              {!loading && error && (
                <div
                  style={{
                    marginTop: "8px",
                    fontSize: "11px",
                    color: colors.dimmer,
                    transition: "color 0.3s",
                  }}
                >
                  Could not check for updates right now.
                </div>
              )}

              {!loading && !error && data && newer && (
                <>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: colors.dimmer,
                      marginTop: "8px",
                      lineHeight: 1.5,
                    }}
                  >
                    Update available for {currentBrowser()}.
                  </div>
                  {downloadUrl && (
                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ y: 0 }}
                      onClick={() => openTab(downloadUrl)}
                      style={{
                        marginTop: "10px",
                        padding: "7px 14px",
                        border: `1px solid ${colors.amber}`,
                        background: colors.amber,
                        color: "#16150f",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: colors.mono,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Update now →
                    </motion.button>
                  )}
                </>
              )}
            </div>
          </PanelRow>
        </div>

        {/* ── 2. OFFER (promotion) ─────────────────────────────────── */}
        {hasPromoSection && activePromo && (
          <>
            <Divider colors={colors} />
            <div>
              <SectionHeader label="▸ Offer" colors={colors} />
              <div
                style={{
                  padding: "12px 14px",
                  border: `1px dashed ${colors.amber}88`,
                  background: isDark
                    ? "rgba(200,160,60,0.08)"
                    : "rgba(200,160,60,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  {hasLocalizedText(activePromo.title) && (
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: colors.amber,
                        letterSpacing: "0.03em",
                        fontFamily: colors.mono,
                      }}
                    >
                      {activePromo.title.en}
                    </span>
                  )}
                  {hasText(activePromo.code) && (
                    <Badge color={colors.amber} colors={colors}>
                      {activePromo.code}
                    </Badge>
                  )}
                </div>
                {hasLocalizedText(activePromo.message) && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: colors.dim,
                      marginTop: "6px",
                      lineHeight: 1.6,
                    }}
                  >
                    {activePromo.message.en}
                  </div>
                )}
                {activePromo.link?.url && (
                  <button
                    onClick={() => openTab(activePromo.link!.url)}
                    style={{
                      marginTop: "10px",
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: colors.amber,
                      fontFamily: colors.mono,
                      fontSize: "11px",
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Redeem →
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── 3. UPCOMING ──────────────────────────────────────────── */}
        {hasUpcomingSection && (
          <>
            <Divider colors={colors} />
            <div>
              <SectionHeader label="▸ Coming Soon" colors={colors} />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {upcoming.map((u) => {
                  const highlights = (u.highlights ?? []).filter((h) =>
                    hasLocalizedText(h?.text)
                  )
                  const hasExpected = hasText(u.expectedDate)
                  return (
                    <PanelRow key={u.id} colors={colors} isDark={isDark}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          {hasText(u.version) && (
                            <code
                              style={{
                                fontFamily: colors.mono,
                                fontSize: "12px",
                                color: colors.ink,
                                transition: "color 0.3s",
                              }}
                            >
                              {u.version}
                            </code>
                          )}
                          {hasText(u.status) && (
                            <Badge color={colors.sage} colors={colors}>
                              {u.status}
                            </Badge>
                          )}
                          {hasText(u.importance) && (
                            <Badge color={colors.dim} colors={colors}>
                              {u.importance}
                            </Badge>
                          )}
                        </div>
                        {hasLocalizedText(u.message) && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: colors.dim,
                              marginTop: "6px",
                              lineHeight: 1.5,
                              transition: "color 0.3s",
                            }}
                          >
                            {u.message.en}
                          </div>
                        )}
                        {highlights.length > 0 && (
                          <ul
                            style={{
                              margin: "8px 0 0 0",
                              paddingLeft: "18px",
                              fontSize: "11px",
                              color: colors.dim,
                              lineHeight: 1.6,
                            }}
                          >
                            {highlights.map((h, i) => (
                              <li key={i}>{h.text.en}</li>
                            ))}
                          </ul>
                        )}
                        {hasExpected && (
                          <div
                            style={{
                              fontSize: "10.5px",
                              color: colors.dimmer,
                              marginTop: "8px",
                              fontFamily: colors.mono,
                            }}
                          >
                            Expected · {u.expectedDate}
                            {u.dateIsEstimate ? " (est.)" : ""}
                          </div>
                        )}
                      </div>
                    </PanelRow>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ── 4. CHANGELOG ─────────────────────────────────────────── */}
        {hasChangelogSection && (
          <>
            <Divider colors={colors} />
            <div>
              <SectionHeader
                label="▸ What's New"
                colors={colors}
                action={
                  changelog.length > 1 ? (
                    <button
                      onClick={() => setShowAllChangelog((v) => !v)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: colors.dim,
                        fontFamily: colors.mono,
                        fontSize: "10px",
                        letterSpacing: "0.06em",
                        cursor: "pointer",
                        transition: "color 0.3s",
                      }}
                    >
                      {showAllChangelog ? "show less" : "show all"}
                    </button>
                  ) : undefined
                }
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {changelog.map((entry, idx) => {
                  const freeVer = hasText(entry.releases?.free)
                    ? entry.releases!.free
                    : null
                  const notesForFree = entry.notes
                  return (
                    <PanelRow
                      key={`${entry.date}-${idx}`}
                      colors={colors}
                      isDark={isDark}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          {freeVer && (
                            <code
                              style={{
                                fontFamily: colors.mono,
                                fontSize: "12px",
                                color: colors.ink,
                              }}
                            >
                              {freeVer}
                            </code>
                          )}
                          {hasText(entry.importance) && (
                            <Badge
                              color={
                                entry.importance === "major"
                                  ? colors.amber
                                  : entry.importance === "minor"
                                  ? colors.sage
                                  : colors.dim
                              }
                              colors={colors}
                            >
                              {entry.importance}
                            </Badge>
                          )}
                          {hasText(entry.date) && (
                            <span
                              style={{
                                fontSize: "10.5px",
                                color: colors.dimmer,
                                fontFamily: colors.mono,
                                marginLeft: "auto",
                              }}
                            >
                              {entry.date}
                            </span>
                          )}
                        </div>

                        {notesForFree.length > 0 && (
                          <ul
                            style={{
                              margin: "10px 0 0 0",
                              padding: 0,
                              listStyle: "none",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                          >
                            {notesForFree.map((n, i) => {
                              const meta = NOTE_META[n.type] ?? NOTE_META.new
                              const tint = meta.tint(colors)
                              return (
                                <li
                                  key={i}
                                  style={{
                                    display: "flex",
                                    gap: "8px",
                                    fontSize: "11px",
                                    color: colors.dim,
                                    lineHeight: 1.5,
                                  }}
                                >
                                  <span
                                    style={{
                                      color: tint,
                                      fontFamily: colors.mono,
                                      fontSize: "10px",
                                      flexShrink: 0,
                                      width: "66px",
                                      paddingTop: "1px",
                                    }}
                                  >
                                    {meta.glyph} {meta.label}
                                  </span>
                                  <span style={{ flex: 1 }}>{n.text.en}</span>
                                </li>
                              )
                            })}
                          </ul>
                        )}

                        {hasText(entry.link) && (
                          <button
                            onClick={() => openTab(entry.link!)}
                            style={{
                              marginTop: "10px",
                              padding: 0,
                              background: "none",
                              border: "none",
                              color: colors.amber,
                              fontSize: "11px",
                              fontFamily: colors.mono,
                              cursor: "pointer",
                              letterSpacing: "0.04em",
                            }}
                          >
                            View full release notes →
                          </button>
                        )}
                      </div>
                    </PanelRow>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ── 5. WISP PRO ──────────────────────────────────────────── */}
        {hasPaidSection && paid && (
          <>
            <Divider colors={colors} />
            <div>
              <SectionHeader
                label={`▸ ${hasText(paid.name) ? paid.name : "Wisp Pro"}`}
                colors={colors}
              />
              <div
                style={{
                  padding: "14px 16px",
                  background: isDark
                    ? "rgba(124,106,176,0.14)"
                    : "rgba(91,74,138,0.08)",
                  border: `1px solid ${isDark ? "#7c6ab0" : "#5b4a8a"}55`,
                  transition: "background-color 0.3s, border-color 0.3s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: isDark ? "#a496d4" : "#5b4a8a",
                      letterSpacing: "0.03em",
                      transition: "color 0.3s",
                    }}
                  >
                    {hasLocalizedText(paid.announcement)
                      ? paid.announcement!.en
                      : "Coming soon"}
                  </div>
                  {paid.price && (
                    <Badge
                      color={isDark ? "#a496d4" : "#5b4a8a"}
                      colors={colors}
                    >
                      {paid.price.amount} {paid.price.currency} ·{" "}
                      {paid.price.model}
                    </Badge>
                  )}
                </div>

                {hasText(paid.expectedDate) && (
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: colors.dim,
                      marginTop: "6px",
                      fontFamily: colors.mono,
                      transition: "color 0.3s",
                    }}
                  >
                    Expected · {paid.expectedDate}
                    {paid.dateIsEstimate ? " (est.)" : ""}
                  </div>
                )}

                {(() => {
                  const features = (paid.features ?? []).filter((f) =>
                    hasLocalizedText(f?.name)
                  )
                  if (features.length === 0) return null
                  return (
                    <ul
                      style={{
                        margin: "10px 0 0 0",
                        paddingLeft: "18px",
                        fontSize: "11px",
                        color: colors.dim,
                        lineHeight: 1.7,
                      }}
                    >
                      {features.map((f) => (
                        <li key={f.id}>
                          <span style={{ color: colors.ink }}>
                            {f.name.en}
                          </span>
                          {hasLocalizedText(f.description) && (
                            <>
                              {" — "}
                              {f.description.en}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )
                })()}

                {(() => {
                  const b = currentBrowser()
                  const link =
                    paid.links?.[b] ?? paid.links?.default
                  if (!link?.url) return null
                  return (
                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ y: 0 }}
                      onClick={() => openTab(link.url)}
                      style={{
                        marginTop: "12px",
                        padding: "7px 16px",
                        border: `1px solid ${isDark ? "#7c6ab0" : "#5b4a8a"}`,
                        background: isDark ? "#7c6ab0" : "#5b4a8a",
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: colors.mono,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {hasLocalizedText(link.title)
                        ? link.title!.en
                        : "Learn more"}{" "}
                      →
                    </motion.button>
                  )
                })()}
              </div>
            </div>
          </>
        )}

        {/* ── 6. FEEDBACK ──────────────────────────────────────────── */}
        {hasFeedbackSection && (
          <>
            <Divider colors={colors} />
            <div>
              <SectionHeader label="▸ Feedback" colors={colors} />
              <div style={{ display: "flex", gap: "8px" }}>
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0 }}
                  onClick={() => setShowBugModal(true)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    border: `1px solid ${colors.line}`,
                    background: "transparent",
                    color: colors.ink,
                    fontSize: "11px",
                    cursor: "pointer",
                    fontFamily: colors.mono,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  ⚑ Report a bug
                </motion.button>
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0 }}
                  onClick={() => setShowBugModal(true)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    border: `1px solid ${colors.line}`,
                    background: "transparent",
                    color: colors.ink,
                    fontSize: "11px",
                    cursor: "pointer",
                    fontFamily: colors.mono,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  ✦ Request a feature
                </motion.button>
              </div>
              <div
                style={{
                  fontSize: "10.5px",
                  color: colors.dimmer,
                  marginTop: "8px",
                  lineHeight: 1.5,
                }}
              >
                Opens a GitHub issue with your version and browser pre-filled.
              </div>
            </div>
          </>
        )}
      </ModalShell>

      <BugReportModal
        isOpen={showBugModal}
        onClose={() => setShowBugModal(false)}
        theme={theme}
        colors={colors}
      />
    </>
  )
})

//#endregion