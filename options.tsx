// FullView.tsx
//#region ─── Imports ──────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react"
import type { KeyboardEvent } from "react"
import { useFullViewLogic, FORGOTTEN_OPTIONS, PILLS_PREVIEW, groupModeLabel, healthRefreshMessage, exportMenuItemStyle, pillStyle, getCategoryIcon } from "./scripts/FullViewLogic"
import CollapsibleCategory from "./components/CollapsibleCategory"
import "./styles/defaultstyle.css"
import "./styles/themes.css"
import { type GroupMode } from "./scripts/bookmarkseparator"
import { ThemeProvider, useTheme } from './scripts/themeProvider'
import { ThemeToggle } from './components/themeToggle'
import { PrivateView } from './components/privateView'
import DuplicatesView from "./components/DuplicatesView"
import TimelineView from "./components/TimelineView"
import { relativeTime } from "./scripts/bookmarkVisits"
import { statusDot } from "./scripts/bookmarkHealth"
import { type VisitStore } from "./scripts/bookmarkVisits"
import { type HealthStore, HealthStatus } from "./scripts/bookmarkHealth"
import { loadFavicon } from "~scripts/faviconHelper"
import { motion, AnimatePresence } from "framer-motion"
import { estimateClusterCap } from "~scripts/catagorizeHelper"
import { browserApi } from "./scripts/storage"
import { exportWispBackup, exportStandardHtml } from "./scripts/bookmarkExport"
import { SpinnerIcon } from "~components/customspinner"
import {
  SystemPanel,
  UpdatesPanel,
  peekHasNews,
} from "~components/wispSystemInfo"
import NotificationBanner, { type BannerPayload } from "~components/customNotificationBanner"
import WispIntro from "~intro/WispIntro"
//#endregion

//#region ─── Intro gate ────────────────────────────────────────────────────────
const INTRO_KEY = "wisp_intro_seen"
//#endregion

//#region ─── YoRHa design tokens ───────────────────────────────────────────────

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

// ── FIX: memoize Bracket — it was re-created on every parent render
const Bracket = React.memo(function Bracket({ children, style, theme }: { children: React.ReactNode; style?: React.CSSProperties; theme?: string }) {
  const colors = getThemeColors(theme || 'light')
  return (
    <span style={{ fontFamily: colors.mono, letterSpacing: "0.08em", ...style }}>
      [ {children} ]
    </span>
  )
})
//#endregion

//#region ─── Memoized sub-components ───────────────────────────────────────────

const HeaderStats = React.memo(function HeaderStats({
  allBookmarks, categories, groupMode,
  forgottenCount, brokenCount, unverifiableCount, duplicateCount,
  colors
}: {
  allBookmarks: any[]
  categories: string[]
  groupMode: GroupMode
  forgottenCount: number
  brokenCount: number
  unverifiableCount: number
  duplicateCount: number
  colors: any
}) {
  return (
    <div style={{
      marginTop: "25px",
      color: colors.dim, fontSize: "12px",
      letterSpacing: "0.03em", transition: "color 0.3s",
    }}>
      <span>

        {allBookmarks.length} ENTRIES · {categories.length} {groupModeLabel(groupMode).toUpperCase()}
        {forgottenCount > 0 && (
          <span style={{ color: colors.amber, marginLeft: "10px" }}>· {forgottenCount} DORMANT</span>
        )}
        {(brokenCount > 0 || unverifiableCount > 0) && (
          <span style={{ color: colors.rust, marginLeft: "10px" }}>· {brokenCount} SEVERED{unverifiableCount > 0 ? ` · ${unverifiableCount} UNVERIFIED` : ""}</span>
        )}
        {duplicateCount > 0 && (
          <span style={{ color: colors.amber, marginLeft: "10px" }}>· {duplicateCount} DUPLICATE{duplicateCount !== 1 ? "S" : ""}</span>
        )}
      </span>
    </div>
  )
})

// ─── SkeletonPill — placeholder outline shown while data loads ────────────────

const SkeletonPill = React.memo(function SkeletonPill({
  width = 90,
  colors,
}: {
  width?: number | string
  colors: any
}) {
  return (
    <motion.div
      initial={{ opacity: 0.25 }}
      animate={{ opacity: [0.25, 0.55, 0.25] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      style={{
        height: "33px",
        width,
        border: `1px dashed ${colors.line}`,
        background: "transparent",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    />
  )
})

const CheckLinksLabel = React.memo(function CheckLinksLabel({
  isChecking,
  progress,
  needsRefresh,
  color,
}: {
  isChecking: boolean
  progress: { done: number; total: number } | null
  needsRefresh: boolean
  color: string
}) {
  if (isChecking) {
    return (
      <>
        <SpinnerIcon color={color} />
        {" CHECKING "}{progress?.done ?? 0}/{(progress?.total ?? 0)}
      </>
    )
  }
  if (needsRefresh) return <>◎ UPDATE LINK CHECK</>
  return <>◎ CHECK LINKS</>
})
//#endregion

//#region ─── Main Component ───────────────────────────────────────────────────

export default function FullView() {
  return (
    <ThemeProvider>
      <FullViewRoot />
    </ThemeProvider>
  )
}

//#region ─── Intro gate wrapper ────────────────────────────────────────────────

function FullViewRoot() {
  const [introDone, setIntroDone] = useState<boolean | null>(null)

  useEffect(() => {
    browserApi.storage.local.get([INTRO_KEY]).then((r: Record<string, any>) => {
      setIntroDone(!!r[INTRO_KEY])
    })
  }, [])

  const finishIntro = () => {
    browserApi.storage.local.set({ [INTRO_KEY]: true }).then(() => {
      setIntroDone(true)
    })
  }

  if (introDone === null) {
    return <div style={{ minHeight: "100vh", background: "#161512" }} />
  }

  return introDone
    ? <FullViewContent />
    : <WispIntro onReady={finishIntro} />
}
//#endregion

//#region ─── FullViewContent ───────────────────────────────────────────────────

function FullViewContent() {
  //#region ─── Hooks & state ─────────────────────────────────────────────────
  const logic = useFullViewLogic()
  const { theme } = useTheme()
  const colors = getThemeColors(theme)
  const isDark = theme === "dark" || theme === "high-contrast-dark"
  const [showSystemModal, setShowSystemModal] = useState(false)
  const [showUpdatesModal, setShowUpdatesModal] = useState(false)
  const [hasNews, setHasNews] = useState(false)
  const [isSearchBarFocused, setIsSearchBarFocused] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSlashHint, setShowSlashHint] = useState(false)
  const slashHintTimerRef = useRef<number | null>(null)
  const [banner, setBanner] = useState<BannerPayload | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  // ── FIX: defer the health store used by the big tree so that in-flight
  //         health updates don't rebuild every category/card on every tick.
  const deferredHealth = useDeferredValue(logic.health)

  // ── FIX: precompute a Set of private bookmark IDs (was O(n·m) .some() calls)
  const privateIds = useMemo(
    () => new Set(logic.privateBookmarks.map((pb: any) => pb.id)),
    [logic.privateBookmarks]
  )
  //#endregion

  //#region ─── Banner callbacks ──────────────────────────────────────────────
  const showBanner = useCallback((payload: BannerPayload) => {
    setBanner(payload)
  }, [])

  const hideBanner = useCallback(() => {
    setBanner(null)
  }, [])
  //#endregion

  //#region ─── Scroll-to-top tracking + handler ──────────────────────────────
  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 400)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll() // sync on mount
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const scrollToSearch = useCallback(() => {
    const el = document.getElementById("searchTextBox")
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
      // nudge focus so the user lands ready to type
      window.setTimeout(() => inputRef.current?.focus(), 400)
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [])
  //#endregion

  //#region ─── Global "/" shortcut + slash hint ──────────────────────────────
  useEffect(() => {
    const flashHint = () => {
      setShowSlashHint(true)
      if (slashHintTimerRef.current) window.clearTimeout(slashHintTimerRef.current)
      slashHintTimerRef.current = window.setTimeout(() => {
        setShowSlashHint(false)
      }, 2200)
    }

    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const active = document.activeElement as HTMLElement | null
      const isTyping =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)

      if (isTyping) return

      // "/" → jump to search
      if (event.key === "/") {
        event.preventDefault()
        setIsSearchBarFocused(true)
        setShowSlashHint(false)
        if (slashHintTimerRef.current) {
          window.clearTimeout(slashHintTimerRef.current)
          slashHintTimerRef.current = null
        }
        inputRef.current?.focus()
        return
      }
      // Ignore
      const ignoredKeys = new Set([
        "Shift", "Control", "Alt", "Meta", "CapsLock", "Tab",
        "Escape", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Home", "End", "PageUp", "PageDown", "Insert", "Delete",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
      ])
      if (ignoredKeys.has(event.key)) return
      flashHint()
    }

    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown)
      if (slashHintTimerRef.current) window.clearTimeout(slashHintTimerRef.current)
    }
  }, [])
  //#endregion

  //#region ─── Updates news peek ─────────────────────────────────────────────
  // ── FIX: only re-check for news when the Updates panel *closes*,
  //         not on every state flip (open + close).
  useEffect(() => {
    if (!showUpdatesModal) peekHasNews().then(setHasNews)
  }, [showUpdatesModal])
  //#endregion

  //#region ─── Derived loading / presence flags ──────────────────────────────
  const isLoading = useMemo(
    () =>
      logic.allBookmarks.length === 0 &&
      logic.importStatus !== "done" &&
      logic.importStatus !== "error",
    [logic.allBookmarks.length, logic.importStatus]
  )

  const hasCustomCats = useMemo(() => logic.customCats.length > 0, [logic.customCats.length])
  const hasForgotten = useMemo(() => logic.forgottenBookmarks.length > 0, [logic.forgottenBookmarks.length])
  const hasBroken = useMemo(() => logic.brokenBookmarks.length > 0, [logic.brokenBookmarks.length])
  const hasUnverifiable = useMemo(() => logic.unverifiableBookmarks.length > 0, [logic.unverifiableBookmarks.length])
  const hasDuplicates = useMemo(() => logic.duplicateCount > 0, [logic.duplicateCount])
  //#endregion

  //#region ─── Category pills (with inline rename / delete) ──────────────────
  const CategoryPills = useMemo(() => {
    const categories = logic.pillsExpanded ? logic.categories : logic.categories.slice(0, PILLS_PREVIEW)
    return categories.map(cat => {
      const customCat = logic.customCats.find(c => c.name === cat)
      if (logic.renamingCat === cat) {
        return (
          <div key={cat} style={{
            display: "flex", alignItems: "center", gap: "6px",
            background: colors.bgPanel,
            border: `1px solid ${colors.line}`,
            padding: "4px 8px 4px 12px",
            transition: "background-color 0.3s, border-color 0.3s",
          }}>
            <input ref={logic.renameInputRef} value={logic.renameValue}
              onChange={e => logic.setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") logic.handleRenameCommit(); if (e.key === "Escape") logic.setRenamingCat(null) }}
              style={{
                background: "none", border: "none", outline: "none",
                color: colors.ink, fontFamily: colors.mono,
                fontSize: "12px", width: "140px",
                transition: "color 0.3s",
              }} />
            <button onClick={logic.handleRenameCommit} disabled={!logic.renameValue.trim()} style={{
              background: logic.renameValue.trim() ? colors.ink : colors.dimmer,
              border: "none", color: colors.bg,
              fontSize: "11px", padding: "3px 10px",
              cursor: logic.renameValue.trim() ? "pointer" : "default",
              fontFamily: colors.mono, textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "background-color 0.3s, color 0.3s",
            }}>Save</button>
            <button onClick={() => logic.setRenamingCat(null)} style={{
              background: "none", border: "none",
              color: colors.dim, cursor: "pointer",
              fontSize: "14px", padding: "0 4px",
              transition: "color 0.3s",
            }}>✕</button>
            {Object.values(logic.aliases).includes(cat) && (
              <button onClick={() => logic.handleRenameRevert(cat)} style={{
                background: "none", border: "none",
                color: colors.dim, cursor: "pointer",
                fontSize: "10px", padding: "0 4px",
                transition: "color 0.3s",
              }}>↩ revert</button>
            )}
          </div>
        )
      }
      return (
        <div key={cat} className="category-pill-group" style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <YorhaPill
            active={!logic.showForgotten && !logic.showBroken && !logic.showUnverifiable && !logic.showDuplicates && logic.selectedCategory === cat}
            count={logic.grouped[cat].length}
            paddingRight={customCat ? "56px" : "36px"}
            onClick={() => logic.handleCategoryChange(logic.selectedCategory === cat ? "" : cat)}
            theme={theme}
            colors={colors}
          >
            {getCategoryIcon(cat, logic.groupMode)} {cat.toUpperCase()}
          </YorhaPill>
          <button onClick={e => { e.stopPropagation(); logic.handleRenameStart(cat) }} className="rename-btn"
            style={{
              position: "absolute", right: customCat ? "30px" : "8px",
              background: "none", border: "none",
              color: colors.dimmer, cursor: "pointer",
              fontSize: "12px", padding: "0 4px", display: "flex", alignItems: "center",
              transition: "color 0.3s",
            }}>✎</button>
          {customCat && (
            <button onClick={e => { e.stopPropagation(); logic.handleDeleteCategory(customCat.id) }}
              style={{
                position: "absolute", right: "8px",
                background: "none", border: "none",
                color: colors.dim, cursor: "pointer",
                fontSize: "12px", lineHeight: 1, padding: "0 2px",
                transition: "color 0.3s",
              }}>✕</button>
          )}
        </div>
      )
    })
  }, [
    logic.categories, logic.pillsExpanded, logic.selectedCategory,
    logic.showForgotten, logic.showBroken, logic.showUnverifiable,
    logic.showDuplicates, logic.renamingCat, logic.renameValue,
    logic.customCats, logic.grouped, logic.groupMode, logic.handleCategoryChange,
    logic.handleRenameCommit, logic.handleRenameStart, logic.handleDeleteCategory,
    logic.setRenameValue, logic.setRenamingCat,
    colors, theme
  ])
  //#endregion

  //#region ─── Private bookmark filtering ────────────────────────────────────
  // ── FIX: use the precomputed privateIds Set instead of O(n·m) .some()
  const filterPrivateBookmarks = useCallback((bookmarks: any[]) => {
    if (logic.isPrivateUnlocked) return bookmarks
    return bookmarks.filter(b => !privateIds.has(b.id))
  }, [logic.isPrivateUnlocked, privateIds])
  //#endregion

  //#region ─── Manual health override handlers ───────────────────────────────
  const handleMarkWorking = useCallback((url: string) => {
    logic.setManualHealth(url, HealthStatus.Live)
  }, [logic.setManualHealth])

  const handleMarkBroken = useCallback((url: string) => {
    logic.setManualHealth(url, HealthStatus.Dead)
  }, [logic.setManualHealth])

  const handleDeleteOne = useCallback((id: string) => {
    logic.handleDeleteBookmarks([id])
  }, [logic.handleDeleteBookmarks])
  //#endregion

  //#region ─── Main content router (memoized) ────────────────────────────────
  const MainContent = useMemo(() => {
    // ── FIX: use deferredHealth everywhere in this memo (both body and deps)
    const health = deferredHealth

    // ─── Private view ──────────────────────────────────────────────────────
    if (logic.showPrivate) {
      return (
        <PrivateView
          onUnlock={logic.handlePrivateUnlock}
          onLock={logic.handlePrivateLock}
          isUnlocked={logic.isPrivateUnlocked}
          theme={theme}
          colors={colors}
          onNotify={showBanner}
        />
      )
    }

    // ─── Duplicates view ──────────────────────────────────────────────────
    if (logic.showDuplicates && logic.duplicateResult) {
      return (
        <DuplicatesView
          result={logic.duplicateResult}
          onDelete={logic.handleDeleteDuplicates}
          theme={theme}
          colors={colors}
        />
      )
    }

    // ─── Forgotten view ────────────────────────────────────────────────────
    if (logic.showForgotten) {
      return (
        <ForgottenView
          bookmarks={filterPrivateBookmarks(logic.forgottenFiltered)}
          visits={logic.visits}
          health={health}
          months={logic.forgottenMonths}
          onOpen={logic.handleOpenBookmark}
          allCategories={logic.allCategoryNames}
          onAssignCategory={logic.handleAssignCategory}
          theme={theme}
          colors={colors}
        />
      )
    }

    // ─── Broken view ──────────────────────────────────────────────────────
    if (logic.showBroken) {
      return (
        <BrokenView
          bookmarks={filterPrivateBookmarks(logic.brokenFiltered)}
          unverifiable={[]}
          visits={logic.visits}
          isChecking={logic.isChecking}
          onOpen={logic.handleOpenBookmark}
          onRecheck={logic.runHealthCheckForUrls}
          allCategories={logic.allCategoryNames}
          onAssignCategory={logic.handleAssignCategory}
          onMarkWorking={handleMarkWorking}
          onMarkBroken={handleMarkBroken}
          onDeleteBookmarks={handleDeleteOne}
          theme={theme}
          colors={colors}
        />
      )
    }

    // ─── Unverifiable view ────────────────────────────────────────────────
    if (logic.showUnverifiable) {
      return (
        <BrokenView
          bookmarks={[]}
          unverifiable={filterPrivateBookmarks(logic.unverifiableFiltered)}
          visits={logic.visits}
          isChecking={logic.isChecking}
          onOpen={logic.handleOpenBookmark}
          onRecheck={logic.runHealthCheckForUrls}
          allCategories={logic.allCategoryNames}
          onAssignCategory={logic.handleAssignCategory}
          onMarkWorking={handleMarkWorking}
          onMarkBroken={handleMarkBroken}
          onDeleteBookmarks={handleDeleteOne}
          theme={theme}
          colors={colors}
        />
      )
    }

    // ─── Auto-categorization view ─────────────────────────────────────────
    // Only entered when the user has EXPLICITLY toggled auto on — never auto-switched.
    if (logic.groupMode === "topic" && logic.useAutoCategorization) {
      const autoCategories = logic.autoCategories
      const categoryNames = Object.keys(autoCategories)

      // While the categorization is still running and we have nothing yet,
      // show a dedicated loading state instead of an empty view.
      if (logic.isAutoCategorizing && categoryNames.length === 0) {
        return (
          <div style={{
            textAlign: "center", color: colors.dim,
            marginTop: "80px", fontSize: "13px",
            letterSpacing: "0.05em", textTransform: "uppercase",
            transition: "color 0.3s",
          }}>
            <SpinnerIcon size={22} color={colors.dim} />
            <p style={{ marginTop: "12px", fontSize: "12px", letterSpacing: "0.04em" }}>
              Analyzing {logic.allBookmarks.length} bookmarks…
            </p>
          </div>
        )
      }

      if (categoryNames.length === 0) {
        return (
          <div style={{
            textAlign: "center", color: colors.dim,
            marginTop: "80px", fontSize: "13px",
            letterSpacing: "0.05em", textTransform: "uppercase",
            transition: "color 0.3s",
          }}>
            <Bracket theme={theme}>NO AUTO-CATEGORIES FOUND</Bracket>
          </div>
        )
      }

      return categoryNames.map((cat) => {
        const entries = autoCategories[cat] || []

        const matchedBookmarks = entries
          .map(entry => {
            let found = logic.allBookmarks.find(b => b.url === entry.url)
            if (!found) found = logic.allBookmarks.find(b => b.title === entry.title)
            if (!found) {
              found = logic.allBookmarks.find(b =>
                (b.url && entry.url && b.url.includes(entry.url)) ||
                (b.title && entry.title && b.title.includes(entry.title))
              )
            }
            return found
          })
          .filter(Boolean)
          // ── FIX: use Set lookup instead of .some()
          .filter(b => logic.isPrivateUnlocked || !privateIds.has(b.id))
          .map(b => ({
            ...b,
            description: logic.meta[b.id]?.description,
            healthStatus: health[b.url]?.status,
            // ── FIX: Set lookup
            isPrivate: privateIds.has(b.id)
          }))

        if (matchedBookmarks.length === 0) return null

        return (
          <div
            key={cat}
            style={{
              opacity: 1,
              position: "relative",
              zIndex: 1,
            }}
          >
            <CollapsibleCategory
              title={`🤖 ${cat.toUpperCase()}`}
              icon=""
              bookmarks={matchedBookmarks}
              defaultOpen={true}
              categoryName={cat}
              allCategories={logic.allCategoryNames}
              onAssignCategory={logic.handleAssignCategory}
              onDeleteBookmarks={logic.handleDeleteBookmarks}
              onUpdateUrl={logic.handleUpdateUrl}
              onUpdateNote={logic.handleUpdateNote}
            />
          </div>
        )
      }).filter(Boolean)
    }

    // ─── Timeline view ─────────────────────────────────────────────────────
    if (logic.groupMode === "date") {
      return (
        <TimelineView
          categories={logic.visibleCategories}
          getFiltered={(cat: string) => filterPrivateBookmarks(logic.getFiltered(cat))}
          meta={logic.meta}
          allCategoryNames={logic.allCategoryNames}
          onAssignCategory={logic.handleAssignCategory}
          groupMode={logic.groupMode}
          getCategoryIcon={getCategoryIcon}
          theme={theme}
          colors={colors}
          onDeleteBookmarks={logic.handleDeleteBookmarks}
          onUpdateUrl={logic.handleUpdateUrl}
          onUpdateNote={logic.handleUpdateNote}
        />
      )
    }

    // ─── Regular category view ─────────────────────────────────────────────
    if (logic.visibleCategories.length === 0) {
      return (
        <div style={{
          textAlign: "center", color: colors.dim,
          marginTop: "80px", fontSize: "13px",
          letterSpacing: "0.05em", textTransform: "uppercase",
          transition: "color 0.3s",
        }}>
          <Bracket theme={theme}>NO ENTRIES FOUND</Bracket>
        </div>
      )
    }

    return logic.visibleCategories.map((cat) => {
      const filteredBookmarks = filterPrivateBookmarks(logic.getFiltered(cat))
        .map(b => ({
          ...b,
          description: logic.meta[b.id]?.description,
          healthStatus: health[b.url]?.status,
          // ── FIX: Set lookup
          isPrivate: privateIds.has(b.id)
        }))

      if (filteredBookmarks.length === 0) return null

      return (
        <div
          key={cat}
          style={{
            opacity: 1,
            position: "relative",
            zIndex: 1,
          }}
        >
          <CollapsibleCategory
            title={`${getCategoryIcon(cat, logic.groupMode)}  ${cat}`}
            icon=""
            bookmarks={filteredBookmarks}
            defaultOpen={true}
            categoryName={cat}
            allCategories={logic.allCategoryNames}
            onAssignCategory={logic.handleAssignCategory}
            onDeleteBookmarks={logic.handleDeleteBookmarks}
            onUpdateUrl={logic.handleUpdateUrl}
            onUpdateNote={logic.handleUpdateNote}
          />
        </div>
      )
    }).filter(Boolean)
  }, [
    logic.showPrivate, logic.showDuplicates, logic.showForgotten,
    logic.showBroken, logic.showUnverifiable, logic.groupMode,
    logic.visibleCategories, logic.forgottenFiltered,
    logic.unverifiableFiltered, logic.brokenFiltered,
    logic.duplicateResult, logic.visits,
    // ── FIX: depend on deferredHealth, not logic.health
    deferredHealth,
    logic.forgottenMonths, logic.meta, logic.privateBookmarks,
    logic.allCategoryNames, logic.getFiltered,
    logic.autoCategories, logic.isAutoCategorizing,
    logic.useAutoCategorization, logic.allBookmarks,
    logic.isPrivateUnlocked, logic.handlePrivateUnlock,
    logic.handlePrivateLock, logic.handleOpenBookmark,
    logic.handleAssignCategory, logic.handleDeleteDuplicates,
    logic.handleDeleteBookmarks, logic.handleUpdateUrl,
    logic.handleUpdateNote,
    logic.runHealthCheck,
    handleMarkWorking, handleMarkBroken, handleDeleteOne,
    filterPrivateBookmarks, privateIds, theme, colors
  ])
  //#endregion

  //#region ─── Check-links / header memo props ───────────────────────────────
  const handleCheckLinks = useCallback((force: boolean) => {
    logic.runHealthCheck(force)
  }, [logic.runHealthCheck])

  const headerStatsProps = useMemo(() => ({
    allBookmarks: logic.allBookmarks,
    categories: logic.categories,
    groupMode: logic.groupMode,
    forgottenCount: logic.forgottenBookmarks.length,
    brokenCount: logic.brokenBookmarks.length,
    unverifiableCount: logic.unverifiableBookmarks.length,
    duplicateCount: logic.duplicateCount,
    colors
  }), [logic.allBookmarks, logic.categories, logic.groupMode, logic.forgottenBookmarks.length, logic.brokenBookmarks.length, logic.unverifiableBookmarks.length, logic.duplicateCount, colors])

  const containerStyle = useMemo<React.CSSProperties>(() => ({
    backgroundColor: colors.bg,
    backgroundImage: isDark ? `
      repeating-linear-gradient(0deg, rgba(232,228,216,0.03) 0px, rgba(232,228,216,0.03) 1px, transparent 1px, transparent 3px),
      radial-gradient(ellipse at top, rgba(232,228,216,0.04), transparent 60%)
    ` : `
      repeating-linear-gradient(0deg, rgba(22,21,17,0.025) 0px, rgba(22,21,17,0.025) 1px, transparent 1px, transparent 3px),
      radial-gradient(ellipse at top, rgba(22,21,17,0.05), transparent 60%)
    `,
    minHeight: "100vh",
    padding: "40px 32px",
    fontFamily: colors.mono,
    boxSizing: "border-box",
    color: colors.ink,
    transition: "background-color 0.3s, color 0.3s",
    position: "relative",
  }), [colors, isDark])

  // ── FIX: memoized check-links label props (avoids object identity churn)
  const checkLabelColor = useMemo(
    () => (logic.isChecking ? colors.dim : colors.ink),
    [logic.isChecking, colors.dim, colors.ink]
  )
  //#endregion

  //#region ─── Render ────────────────────────────────────────────────────────
  return (
    <div style={containerStyle}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", position: "relative", zIndex: 1 }}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div
          style={{
            marginBottom: "24px",
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            gap: "16px",
            borderBottom: `1px solid ${colors.line}`,
            paddingBottom: "20px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <h1 style={{
                fontSize: "30px", fontWeight: 700,
                color: colors.ink, margin: 0,
                letterSpacing: "0.12em", textTransform: "uppercase",
                transition: "color 0.3s",
              }}>
                Wisp
              </h1>
              <span style={{
                fontSize: "11px", color: colors.dim,
                letterSpacing: "0.1em",
                transition: "color 0.3s",
              }}>
                // ARCHIVE UNIT
              </span>
            </div>
            <HeaderStats {...headerStatsProps} />
          </div>

          {/* OUTER: column wrapper */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flexShrink: 0 }}>

            {/* INNER: buttons row */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ThemeToggle />

              {/* [i] System — about + permissions */}
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ y: 0 }}
                onClick={() => setShowSystemModal(true)}
                style={{
                  padding: "9px 12px",
                  border: `1px solid ${colors.line}`,
                  background: "transparent", color: colors.ink,
                  fontSize: "11px", cursor: "pointer",
                  fontFamily: colors.mono,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                }}
                title="About Wisp · permissions"
              >
                ⛨ ABOUT
              </motion.button>

              {/* [↻] Updates — dot when newer version known */}
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ y: 0 }}
                onClick={() => setShowUpdatesModal(true)}
                style={{
                  position: "relative",
                  padding: "9px 12px",
                  border: `1px solid ${hasNews ? colors.amber : colors.line}`,
                  background: "transparent",
                  color: hasNews ? colors.amber : colors.ink,
                  fontSize: "11px", cursor: "pointer",
                  fontFamily: colors.mono,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                }}
                title={hasNews ? "New version available" : "Updates · release notes"}
              >
                ⇪ UPDATES
                {hasNews && (
                  <span
                    style={{
                      position: "absolute", top: "4px", right: "4px",
                      width: "5px", height: "5px",
                      background: colors.amber, borderRadius: "50%",
                    }}
                  />
                )}
              </motion.button>

              {logic.importStatus === "importing" && (
                <span style={{
                  fontSize: "11px", color: colors.dim,
                  display: "flex", alignItems: "center", gap: "6px",
                  letterSpacing: "0.05em",
                  transition: "color 0.3s",
                }}>
                  <SpinnerIcon size={12} color={colors.dim} /> SYNCING…
                </span>
              )}
              {logic.importStatus === "done" && logic.importResult && (
                <span style={{
                  fontSize: "11px", color: colors.sage,
                  letterSpacing: "0.05em",
                  transition: "color 0.3s",
                }}>
                  {"metaRestored" in logic.importResult ? (
                    <>
                      ✓ RESTORED {logic.importResult.metaRestored}
                      {logic.importResult.createdCount > 0
                        ? ` · ${logic.importResult.createdCount} CREATED` : ""}
                      {logic.importResult.unmatched > 0
                        ? ` · ${logic.importResult.unmatched} UNMATCHED` : ""}
                    </>
                  ) : (
                    <>
                      ✓ IMPORTED {logic.importResult.bookmarks}
                      {logic.importResult.folders > 0
                        ? ` · ${logic.importResult.folders} FOLDERS` : ""}
                      {logic.importResult.skipped > 0
                        ? ` · ${logic.importResult.skipped} SKIPPED` : ""}
                    </>
                  )}
                </span>
              )}
              {logic.importStatus === "error" && (
                <span style={{
                  fontSize: "11px", color: colors.rust,
                  letterSpacing: "0.05em",
                  transition: "color 0.3s",
                }} title={logic.importError ?? ""}>
                  ✕ {logic.importError}
                </span>
              )}

              <input
                ref={logic.importInputRef}
                type="file"
                accept=".json,.html"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  e.target.value = ""
                  if (file) logic.handleImport(file)
                }}
              />

              <div ref={logic.exportMenuRef} style={{ position: "relative" }}>
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0 }}
                  onClick={() => logic.setShowExportMenu(m => !m)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "9px 14px",
                    border: `1px solid ${colors.line}`,
                    background: logic.showExportMenu ? colors.ink : "transparent",
                    color: logic.showExportMenu ? colors.bg : colors.ink,
                    fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase",
                    cursor: "pointer", whiteSpace: "nowrap", fontFamily: colors.mono,
                    transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                  }}
                >
                  ↓ EXPORT / IMPORT
                </motion.button>

                <AnimatePresence>
                  {logic.showExportMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15 }}
                      style={{
                        position: "absolute", top: "calc(100% + 6px)", right: 0,
                        background: colors.bg,
                        border: `1px solid ${colors.line}`,
                        minWidth: "230px", zIndex: 200,
                        boxShadow: isDark ? "4px 4px 0 rgba(0,0,0,0.4)" : "4px 4px 0 rgba(22,21,17,0.15)",
                        overflow: "hidden",
                        transition: "background-color 0.3s, border-color 0.3s",
                      }}>
                      <div style={{
                        padding: "10px 14px 6px", fontSize: "10px",
                        color: colors.dim,
                        borderBottom: `1px solid ${colors.lineFaint}`,
                        textTransform: "uppercase", letterSpacing: "0.12em",
                        transition: "color 0.3s, border-color 0.3s",
                      }}>
                        ▸ Export
                      </div>
                      <button
                        onClick={() => { exportStandardHtml(); logic.setShowExportMenu(false) }}
                        style={{
                          ...exportMenuItemStyle, fontFamily: colors.mono,
                          borderRadius: 0, color: colors.ink,
                          transition: "background-color 0.2s, color 0.3s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark ? "rgba(232,228,216,0.08)" : "rgba(22,21,17,0.06)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none" }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: colors.ink, fontSize: "12px", letterSpacing: "0.02em" }}>BROWSER FORMAT</div>
                          <div style={{ fontSize: "10px", color: colors.dim, marginTop: "2px" }}>Standard HTML — import into any browser</div>
                        </div>
                      </button>
                      <button
                        onClick={() => { exportWispBackup(); logic.setShowExportMenu(false) }}
                        style={{
                          ...exportMenuItemStyle, fontFamily: colors.mono,
                          borderRadius: 0, color: colors.ink,
                          transition: "background-color 0.2s, color 0.3s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark ? "rgba(232,228,216,0.08)" : "rgba(22,21,17,0.06)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none" }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: colors.ink, fontSize: "12px", letterSpacing: "0.02em" }}>Wisp BACKUP</div>
                          <div style={{ fontSize: "10px", color: colors.dim, marginTop: "2px" }}>JSON — preserves categories, notes & aliases</div>
                        </div>
                      </button>

                      <div style={{
                        padding: "10px 14px 6px", fontSize: "10px",
                        color: colors.dim,
                        borderTop: `1px solid ${colors.lineFaint}`,
                        borderBottom: `1px solid ${colors.lineFaint}`,
                        textTransform: "uppercase", letterSpacing: "0.12em",
                        transition: "color 0.3s, border-color 0.3s",
                      }}>
                        ▸ Import
                      </div>
                      <button
                        onClick={() => { logic.importInputRef.current?.click(); logic.setShowExportMenu(false) }}
                        style={{
                          ...exportMenuItemStyle, fontFamily: colors.mono,
                          borderRadius: 0, color: colors.ink,
                          transition: "background-color 0.2s, color 0.3s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark ? "rgba(232,228,216,0.08)" : "rgba(22,21,17,0.06)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none" }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: colors.ink, fontSize: "12px", letterSpacing: "0.02em" }}>RESTORE BACKUP</div>
                          <div style={{ fontSize: "10px", color: colors.dim, marginTop: "2px" }}>Re-applies categories, notes & aliases by URL</div>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.button
                whileHover={logic.isChecking ? {} : { y: -1 }}
                whileTap={logic.isChecking ? {} : { y: 0 }}
                onClick={() => handleCheckLinks(logic.healthRefresh.needsRefresh ? false : true)}
                disabled={logic.isChecking}
                title={
                  logic.isChecking
                    ? `Checking… ${logic.checkProgress?.done ?? 0}/${logic.checkProgress?.total ?? 0}`
                    : logic.healthRefresh.needsRefresh
                      ? "Update cached link check"
                      : "Re-check all links"
                }
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "9px 16px",
                  border: `1px solid ${logic.isChecking ? colors.dim : colors.line}`,
                  background: logic.isChecking ? colors.bgPanel : "transparent",
                  color: checkLabelColor,
                  fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase",
                  cursor: logic.isChecking ? "default" : "pointer", whiteSpace: "nowrap",
                  fontFamily: colors.mono,
                  transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                  position: "relative",
                }}
              >
                {/* ── FIX: isolated memoized label — only this subtree re-renders on progress ticks */}
                <CheckLinksLabel
                  isChecking={logic.isChecking}
                  progress={logic.checkProgress ?? null}
                  needsRefresh={logic.healthRefresh.needsRefresh}
                  color={colors.dim}
                />
              </motion.button>

            </div>{/* END INNER buttons row */}

            {/* Text now sits BELOW the row, under Check Links */}
            <span style={{
              color: colors.dim,
              fontSize: "12px",
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
              transition: "color 0.3s",
            }}>
              <a
                href="https://www.buymeacoffee.com/lampmoth"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  background: "#FFDD00",
                  color: "#000",
                  border: "1px solid #000",
                  fontFamily: colors.mono,
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  textDecoration: "none",
                  transition: "background-color 0.3s, color 0.3s",
                }}
              >
                ☕ Buy me a coffee
              </a>
            </span>

          </div>{/* END OUTER column wrapper */}
        </div>

        {/* ── Progress bar ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {logic.isChecking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                height: "3px", background: colors.bgPanel,
                marginBottom: "20px", overflow: "hidden",
                border: `1px solid ${colors.lineFaint}`,
                transition: "background-color 0.3s, border-color 0.3s",
                position: "relative",
              }}>
              <motion.div
                animate={{ width: `${logic.progressPct}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                style={{
                  height: "100%",
                  background: `repeating-linear-gradient(90deg, ${colors.ink} 0px, ${colors.ink} 6px, ${colors.dim} 6px, ${colors.dim} 8px)`,
                  transition: "background-color 0.3s",
                  position: "relative",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Search + Group mode ───────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{
              position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)",
              color: colors.dim, fontSize: "13px", pointerEvents: "none",
              transition: "color 0.3s",
            }}>▸</span>
            <input
              ref={inputRef}
              id="searchTextBox"
              onFocus={() => setIsSearchBarFocused(true)}
              onBlur={() => setIsSearchBarFocused(false)}
              value={logic.search}
              onChange={e => { logic.setSearch(e.target.value); logic.setSelectedCategory(""); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setShowDuplicates(false) }}
              placeholder="SEARCH ARCHIVE..."
              style={{
                width: "100%", padding: "12px 40px 12px 30px",
                background: colors.bg,
                border: `1px solid ${colors.line}`,
                color: colors.ink,
                boxSizing: "border-box", fontSize: "13px", outline: "none",
                letterSpacing: "0.04em", fontFamily: colors.mono,
                transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              }}
            />
            {logic.search.length > 0 && (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  logic.setSearch("")
                  logic.setSelectedCategory("")
                  logic.setShowForgotten(false)
                  logic.setShowBroken(false)
                  logic.setShowUnverifiable(false)
                  logic.setShowDuplicates(false)
                  inputRef.current?.focus()
                }}
                title="Clear search"
                aria-label="Clear search"
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "20px",
                  height: "20px",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: colors.dim,
                  fontFamily: colors.mono,
                  fontSize: "14px",
                  lineHeight: 1,
                  cursor: "pointer",
                  transition: "color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = colors.ink }}
                onMouseLeave={e => { e.currentTarget.style.color = colors.dim }}
              >
                ✕
              </button>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <select
              value={logic.groupMode}
              onChange={e => logic.handleGroupModeChange(e.target.value as GroupMode)}
              style={{
                appearance: "none", WebkitAppearance: "none",
                padding: "12px 40px 12px 16px",
                background: colors.bg,
                border: `1px solid ${colors.line}`,
                color: colors.ink,
                fontSize: "12px", cursor: "pointer", outline: "none", minWidth: "200px",
                letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: colors.mono,
                transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              }}
            >
              <option value="topic">Group: Topic</option>
              <option value="domain">Group: Domain</option>
              <option value="month">Group: Month</option>
              <option value="date">Group: Date</option>
            </select>
            <div style={{
              position: "absolute", right: "12px", top: "50%",
              transform: "translateY(-50%)", pointerEvents: "none",
              color: colors.ink, fontSize: "11px",
              transition: "color 0.3s",
            }}>▾</div>
          </div>
        </div>

        {/* ── Pills ─────────────────────────────────────────────────────────── */}
        {logic.showPills && (
          <div
            style={{
              marginBottom: "24px",
              minHeight: "82px",
            }}
          >
            {isLoading ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <SkeletonPill width={54} colors={colors} />
                <SkeletonPill width={94} colors={colors} />
                <SkeletonPill width={112} colors={colors} />
                <SkeletonPill width={98} colors={colors} />
                <SkeletonPill width={104} colors={colors} />
                <SkeletonPill width={88} colors={colors} />
                <SkeletonPill width={122} colors={colors} />
                <SkeletonPill width={78} colors={colors} />
              </div>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
                >

                  <YorhaPill
                    active={!logic.showForgotten && !logic.showBroken && !logic.showUnverifiable && !logic.showDuplicates && logic.selectedCategory === ""}
                    onClick={() => { logic.setSelectedCategory(""); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setShowDuplicates(false) }}
                    theme={theme}
                    colors={colors}
                  >ALL</YorhaPill>

                  <YorhaPill
                    active={logic.showPrivate}
                    accent={isDark ? "#7c6ab0" : "#5b4a8a"}
                    onClick={logic.togglePrivateView}
                    theme={theme}
                    colors={colors}
                  >
                    {logic.showPrivate ? (logic.isPrivateUnlocked ? "🔓" : "🔒") : "🔒"} PRIVATE
                  </YorhaPill>

                  {hasForgotten && (
                    <div ref={logic.thresholdMenuRef} style={{ position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <YorhaPill
                          active={logic.showForgotten}
                          accent={colors.amber}
                          count={logic.forgottenBookmarks.length}
                          joinRight
                          onClick={() => { logic.setShowForgotten(f => !f); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                          theme={theme}
                          colors={colors}
                        >◷ DORMANT</YorhaPill>
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={e => { e.stopPropagation(); logic.setShowThresholdMenu(m => !m) }}
                          style={{
                            padding: "10px 8px",
                            borderTop: `1px solid ${logic.showForgotten ? colors.amber : colors.line}`,
                            borderLeft: "none",
                            borderBottom: `1px solid ${logic.showForgotten ? colors.amber : colors.line}`,
                            borderRight: "none",
                            background: logic.showForgotten ? colors.amber : "transparent",
                            color: logic.showForgotten ? colors.bg : colors.dim,
                            cursor: "pointer", fontSize: "10px", lineHeight: 1,
                            transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                          }}
                        >▾</motion.button>
                      </div>
                      <AnimatePresence>
                        {logic.showThresholdMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15 }}
                            style={{
                              position: "absolute", top: "calc(100% + 6px)", left: 0,
                              background: colors.bg,
                              border: `1px solid ${colors.line}`,
                              padding: "6px", zIndex: 100, minWidth: "160px",
                              boxShadow: isDark ? "4px 4px 0 rgba(0,0,0,0.4)" : "4px 4px 0 rgba(22,21,17,0.15)",
                              transition: "background-color 0.3s, border-color 0.3s",
                            }}>
                            <p style={{
                              margin: "0 0 6px 6px", fontSize: "10px",
                              color: colors.dim,
                              textTransform: "uppercase", letterSpacing: "0.08em",
                              transition: "color 0.3s",
                            }}>Not visited in…</p>
                            {FORGOTTEN_OPTIONS.map(opt => (
                              <button key={opt.value}
                                onClick={() => { logic.setForgottenMonths(opt.value); logic.setShowThresholdMenu(false); logic.setShowForgotten(true); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                                style={{
                                  display: "block", width: "100%", textAlign: "left",
                                  padding: "7px 12px",
                                  background: logic.forgottenMonths === opt.value ? (isDark ? "rgba(163,116,47,0.25)" : "rgba(163,116,47,0.12)") : "none",
                                  border: "none",
                                  color: logic.forgottenMonths === opt.value ? colors.amber : colors.ink,
                                  fontSize: "12px", cursor: "pointer", fontFamily: colors.mono,
                                  transition: "background-color 0.2s, color 0.3s",
                                }}
                              >{logic.forgottenMonths === opt.value && "▸ "}{opt.label}</button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {hasBroken && (
                    <YorhaPill
                      active={logic.showBroken}
                      accent={colors.rust}
                      count={logic.isChecking ? undefined : logic.brokenBookmarks.length}
                      onClick={() => { logic.setShowBroken(b => !b); logic.setShowForgotten(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                      theme={theme}
                      colors={colors}
                    >
                      {logic.isChecking ? <SpinnerIcon size={11} color={colors.dim} /> : "✕"} SEVERED
                    </YorhaPill>
                  )}

                  {hasUnverifiable && (
                    <YorhaPill
                      active={logic.showUnverifiable}
                      accent={colors.amber}
                      count={logic.isChecking ? undefined : logic.unverifiableBookmarks.length}
                      onClick={() => { logic.setShowUnverifiable(u => !u); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                      theme={theme}
                      colors={colors}
                    >
                      {logic.isChecking ? <SpinnerIcon size={11} color={colors.dim} /> : "◐"} UNVERIFIED
                    </YorhaPill>
                  )}

                  {hasDuplicates && (
                    <YorhaPill
                      active={logic.showDuplicates}
                      accent={colors.amber}
                      count={logic.duplicateCount}
                      onClick={logic.toggleDuplicates}
                      theme={theme}
                      colors={colors}
                    >⧉ DUPLICATES</YorhaPill>
                  )}

                  {/* ── AUTO pill — always visible in topic mode (no search).
                       While categorizing, it shows a spinner and is non-clickable.
                       It NEVER auto-activates — user must click it explicitly. */}
                  {logic.groupMode === "topic" && !logic.search && (
                    <YorhaPill
                      active={logic.useAutoCategorization}
                      accent={isDark ? "#7c6ab0" : "#5b4a8a"}
                      onClick={logic.isAutoCategorizing ? undefined : logic.toggleAutoCategorization}
                      disabled={logic.isAutoCategorizing}
                      theme={theme}
                      colors={colors}
                    >
                      {logic.isAutoCategorizing ? (
                        <>
                          <SpinnerIcon
                            size={11}
                            color={logic.useAutoCategorization ? colors.bg : colors.dim}
                          />
                          AUTO
                        </>
                      ) : (
                        <>🤖 AUTO</>
                      )}
                    </YorhaPill>
                  )}

                  {CategoryPills}

                  {logic.categories.length > PILLS_PREVIEW && (
                    <motion.button whileHover={{ y: -1 }} onClick={() => logic.setPillsExpanded(p => !p)} style={{
                      padding: "8px 14px", border: `1px dashed ${colors.dim}`,
                      background: "transparent", color: colors.dim, fontSize: "11px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "5px", fontFamily: colors.mono,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      transition: "color 0.3s, border-color 0.3s",
                    }}>
                      {logic.pillsExpanded ? "▲ Less" : <>▾ <span style={{ color: colors.ink, fontWeight: 700 }}>+{logic.categories.length - PILLS_PREVIEW}</span> more</>}
                    </motion.button>
                  )}

                  {!logic.showNewCatForm ? (
                    <motion.button whileHover={{ y: -1 }} onClick={() => logic.setShowNewCatForm(true)}
                      style={{
                        padding: "8px 14px",
                        color: colors.ink,
                        border: `1px dashed ${colors.line}`,
                        background: "transparent",
                        fontFamily: colors.mono, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em",
                        display: "flex", alignItems: "center", gap: "6px", cursor: "pointer",
                        transition: "color 0.3s, border-color 0.3s",
                      }}>
                      <span style={{ fontSize: "14px", lineHeight: 1 }}>+</span> New category
                    </motion.button>
                  ) : (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      background: colors.bgPanel,
                      border: `1px solid ${colors.line}`,
                      padding: "4px 8px 4px 10px",
                      transition: "background-color 0.3s, border-color 0.3s",
                    }}>
                      <input value={logic.newCatIcon} onChange={e => logic.setNewCatIcon(e.target.value)} maxLength={2}
                        style={{
                          width: "28px", background: "none", border: "none", outline: "none",
                          fontSize: "15px", textAlign: "center", color: colors.ink,
                          transition: "color 0.3s",
                        }} />
                      <input ref={logic.newCatInputRef} value={logic.newCatName} onChange={e => logic.setNewCatName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") logic.handleAddCategory(); if (e.key === "Escape") { logic.setShowNewCatForm(false); logic.setNewCatName("") } }}
                        placeholder="Category name"
                        style={{
                          background: "none", border: "none", outline: "none",
                          color: colors.ink, fontSize: "12px", width: "140px", fontFamily: colors.mono,
                          transition: "color 0.3s",
                        }} />
                      <button onClick={logic.handleAddCategory} disabled={!logic.newCatName.trim()} style={{
                        background: logic.newCatName.trim() ? colors.ink : colors.dimmer,
                        border: "none", color: colors.bg,
                        fontSize: "11px", padding: "3px 10px",
                        cursor: logic.newCatName.trim() ? "pointer" : "default",
                        fontFamily: colors.mono, textTransform: "uppercase", letterSpacing: "0.05em",
                        transition: "background-color 0.3s, color 0.3s",
                      }}>Add</button>
                      <button onClick={() => { logic.setShowNewCatForm(false); logic.setNewCatName("") }}
                        style={{
                          background: "none", border: "none",
                          color: colors.dim, cursor: "pointer",
                          fontSize: "14px", padding: "0 4px",
                          transition: "color 0.3s",
                        }}>✕</button>
                    </div>
                  )}
                </motion.div>

                {hasCustomCats && (
                  <p style={{
                    margin: "10px 0 0 2px", fontSize: "10px",
                    color: colors.dimmer, letterSpacing: "0.03em",
                    transition: "color 0.3s",
                  }}>
                    ▸ Custom categories have ✕ — click to delete. Select bookmarks inside a group to move, edit, or delete them.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Vault backup reminder banner ─────────────────────────────────── */}
        <NotificationBanner
          show={banner !== null}
          title={banner?.title ?? ""}
          message={banner?.message ?? ""}
          variant={banner?.variant}
          icon={banner?.icon}
          actionLabel={banner?.actionLabel}
          onAction={banner?.onAction}
          onDismiss={hideBanner}
          colors={colors}
          isDark={isDark}
        />

        {/* ── Health cache banner ──────────────────────────────────────────── */}
        <AnimatePresence>
          {logic.showHealthBanner && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                background: isDark ? "rgba(163,116,47,0.15)" : "rgba(163,116,47,0.08)",
                border: `1px solid ${colors.amber}55`,
                padding: "12px 16px", marginBottom: "20px", overflow: "hidden",
                transition: "background-color 0.3s, border-color 0.3s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <span style={{ fontSize: "16px", flexShrink: 0, color: colors.amber }}>◈</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    margin: 0, color: colors.amber,
                    fontWeight: 700, fontSize: "12px",
                    letterSpacing: "0.05em", textTransform: "uppercase",
                    transition: "color 0.3s",
                  }}>
                    Link check may be stale
                  </p>
                  <p style={{
                    margin: "2px 0 0", color: colors.dim,
                    fontSize: "11px",
                    transition: "color 0.3s",
                  }}>
                    {healthRefreshMessage(logic.healthRefresh)}
                    {logic.healthRefresh.lastCheckedAt && (
                      <> · Last checked {relativeTime(logic.healthRefresh.lastCheckedAt)}</>
                    )}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                <button
                  onClick={() => { handleCheckLinks(false) }}
                  style={{
                    padding: "7px 14px",
                    border: `1px solid ${colors.amber}`,
                    background: colors.amber,
                    color: colors.bg,
                    fontSize: "11px", fontWeight: 600, cursor: "pointer",
                    letterSpacing: "0.05em", textTransform: "uppercase",
                    fontFamily: colors.mono,
                    transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                  }}
                >
                  Check links
                </button>
                <button
                  onClick={() => logic.setHealthBannerDismissed(true)}
                  title="Dismiss for now"
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

        {/* ── Main content ─────────────────────────────────────────────────── */}
        {MainContent}

      </div>

      {/* ── System panel — about + permissions ──────────────────────────────── */}
      <AnimatePresence>
        {showSystemModal && (
          <SystemPanel
            isOpen={showSystemModal}
            onClose={() => setShowSystemModal(false)}
            theme={theme}
            colors={colors}
          />
        )}
      </AnimatePresence>

      {/* ── Updates panel — version + Pro + feedback + support ─────────────── */}
      <AnimatePresence>
        {showUpdatesModal && (
          <UpdatesPanel
            isOpen={showUpdatesModal}
            onClose={() => setShowUpdatesModal(false)}
            theme={theme}
            colors={colors}
          />
        )}
      </AnimatePresence>

      {/* ── Slash hint — bottom-left of viewport ───────────────────────── */}
      <AnimatePresence>
        {showSlashHint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "fixed",
              left: "20px",
              bottom: "20px",
              zIndex: 500,
              padding: "6px 12px",
              border: `1px solid ${colors.line}`,
              background: colors.bg,
              color: colors.dim,
              fontFamily: colors.mono,
              fontSize: "11px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              pointerEvents: "none",
              boxShadow: isDark
                ? "3px 3px 0 rgba(0,0,0,0.4)"
                : "3px 3px 0 rgba(22,21,17,0.12)",
              transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
            }}
          >
            Press{" "}
            <span style={{ color: colors.ink, fontWeight: 700 }}>/</span>{" "}
            to jump to search
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scroll to top — bottom-right of viewport ─────────────────────── */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            whileHover={{ y: -2 }}
            whileTap={{ y: 0 }}
            onClick={scrollToSearch}
            title="Back to search"
            aria-label="Scroll to search"
            style={{
              position: "fixed",
              right: "20px",
              bottom: "20px",
              zIndex: 500,
              width: "40px",
              height: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: `1px solid ${colors.line}`,
              background: colors.bg,
              color: colors.ink,
              fontFamily: colors.mono,
              fontSize: "16px",
              lineHeight: 1,
              cursor: "pointer",
              boxShadow: isDark
                ? "3px 3px 0 rgba(0,0,0,0.4)"
                : "3px 3px 0 rgba(22,21,17,0.12)",
              transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = colors.ink
              e.currentTarget.style.color = colors.bg
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = colors.bg
              e.currentTarget.style.color = colors.ink
            }}
          >
            ↑
          </motion.button>
        )}
      </AnimatePresence>

    </div>
  )
  //#endregion
}
//#endregion
//#endregion

//#region ─── YorhaPill ────────────────────────────────────────────────────────

const YorhaPill = React.memo(function YorhaPill({
  active, accent, count, joinRight, paddingRight, onClick, children,
  theme, colors, disabled,
}: {
  active: boolean
  accent?: string
  count?: number
  joinRight?: boolean
  paddingRight?: string
  onClick?: () => void
  children: React.ReactNode
  theme?: string
  colors?: any
  disabled?: boolean
}) {
  const col = colors || getThemeColors(theme || 'light')
  const color = accent || col.ink

  return (
    <motion.button
      whileHover={disabled ? {} : { y: -1 }}
      whileTap={disabled ? {} : { y: 0 }}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: `8px ${paddingRight || "14px"} 8px 14px`,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: active ? color : col.line,
        borderRightWidth: joinRight ? "0px" : "1px",
        background: active ? color : "transparent",
        color: active ? col.bg : col.ink,
        fontSize: "11px", letterSpacing: "0.06em",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.75 : 1,
        fontFamily: col.mono, whiteSpace: "nowrap", position: "relative",
        transition: "background-color 0.3s, color 0.3s, border-color 0.3s, opacity 0.3s",
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span style={{
          marginLeft: "2px", padding: "1px 6px", fontSize: "10px",
          border: `1px solid ${active ? col.bg : color}55`,
          color: active ? col.bg : color,
          transition: "color 0.3s, border-color 0.3s",
        }}>{count}</span>
      )}
    </motion.button>
  )
})
//#endregion

//#region ─── CardActionButton ─────────────────────────────────────────────────

function CardActionButton({
  onClick, color, children, colors, title,
}: {
  onClick: () => void
  color: string
  children: React.ReactNode
  colors: any
  title?: string
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ y: 0 }}
      onClick={e => { e.stopPropagation(); onClick() }}
      title={title}
      style={{
        padding: "4px 10px",
        border: `1px solid ${color}88`,
        background: "transparent",
        color,
        fontSize: "10px",
        fontFamily: colors.mono,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 0.2s, color 0.3s, border-color 0.3s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}22` }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
    >
      {children}
    </motion.button>
  )
}
//#endregion

//#region ─── ForgottenView ────────────────────────────────────────────────────

const ForgottenView = React.memo(function ForgottenView({ bookmarks, visits, health, months, onOpen, allCategories, onAssignCategory, theme, colors }: {
  bookmarks: any[]; visits: VisitStore; health: HealthStore; months: number
  onOpen: (id: string, url: string) => void; allCategories: string[]
  onAssignCategory: (id: string, cat: string) => void; theme?: string; colors?: any
}) {
  const col = colors || getThemeColors(theme || 'light')

  if (bookmarks.length === 0) return (
    <div style={{ textAlign: "center", color: col.dim, marginTop: "80px", transition: "color 0.3s" }}>
      <div style={{ fontSize: "13px", letterSpacing: "0.08em" }}><Bracket theme={theme}>ARCHIVE CLEAN</Bracket></div>
      <p style={{ fontSize: "13px", marginTop: "10px" }}>No dormant entries older than {months} months.</p>
    </div>
  )

  const label = months >= 12 ? `${months / 12} year${months > 12 ? "s" : ""}` : `${months} months`

  return (
    <div>
      <div style={{
        background: theme === "dark" || theme === "high-contrast-dark" ? "rgba(163,116,47,0.15)" : "rgba(163,116,47,0.08)",
        border: `1px solid ${col.amber}55`,
        padding: "14px 18px", marginBottom: "24px",
        display: "flex", alignItems: "center", gap: "12px",
        transition: "background-color 0.3s, border-color 0.3s",
      }}>
        <span style={{ fontSize: "18px", color: col.amber }}>◷</span>
        <div>
          <p style={{
            margin: 0, color: col.amber,
            fontWeight: 700, fontSize: "12px",
            textTransform: "uppercase", letterSpacing: "0.05em",
            transition: "color 0.3s",
          }}>
            {bookmarks.length} entries unvisited for {label}
          </p>
          <p style={{
            margin: "3px 0 0", color: col.dim,
            fontSize: "11px",
            transition: "color 0.3s",
          }}>
            Click an entry to open it — it will be cleared from this list.
          </p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
        {bookmarks.map((b, i) => (
          <BookmarkCard key={b.id} bookmark={b} visits={visits} health={health} onOpen={onOpen} index={i}
            accentColor={col.amber} theme={theme} colors={col} />
        ))}
      </div>
    </div>
  )
})
//#endregion

//#region ─── BrokenView ───────────────────────────────────────────────────────

const BrokenView = React.memo(function BrokenView({
  bookmarks, unverifiable, visits, isChecking, onOpen, onRecheck,
  allCategories, onAssignCategory,
  onMarkWorking, onMarkBroken, onDeleteBookmarks,
  theme, colors, disableFavicon
}: {
  bookmarks: any[]; unverifiable: any[]; visits: VisitStore; isChecking: boolean
  onOpen: (id: string, url: string) => void; onRecheck: (urls: string[]) => void
  allCategories: string[]; onAssignCategory: (id: string, cat: string) => void
  onMarkWorking: (url: string) => void
  onMarkBroken: (url: string) => void
  onDeleteBookmarks: (id: string) => void
  theme?: string; colors?: any
  disableFavicon?: boolean
}) {
  const col = colors || getThemeColors(theme || 'light')
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  // ── FIX: memoize derived health maps so they aren't rebuilt on every render
  const deadHealth: HealthStore = useMemo(() => {
    const h: HealthStore = {}
    for (const b of bookmarks) h[b.url] = { status: "dead", checkedAt: Date.now() }
    return h
  }, [bookmarks])

  const unverifiableHealth: HealthStore = useMemo(() => {
    const h: HealthStore = {}
    for (const b of unverifiable) h[b.url] = { status: "unverifiable", checkedAt: Date.now() }
    return h
  }, [unverifiable])

  if (isChecking) return (
    <div style={{ textAlign: "center", color: col.dim, marginTop: "80px", transition: "color 0.3s" }}>
      <SpinnerIcon size={26} color={col.dim} />
      <p style={{ fontSize: "13px", marginTop: "16px", letterSpacing: "0.04em" }}>
        Scanning links… results will populate shortly.
      </p>
    </div>
  )

  if (bookmarks.length === 0 && unverifiable.length === 0) return (
    <div style={{ textAlign: "center", color: col.dim, marginTop: "80px", transition: "color 0.3s" }}>
      <div style={{ fontSize: "13px", letterSpacing: "0.08em", color: col.sage }}>
        <Bracket theme={theme}>ALL LINKS VERIFIED</Bracket>
      </div>
      <p style={{ fontSize: "13px", marginTop: "10px" }}>All checked links appear reachable.</p>
      <motion.button whileHover={{ y: -1 }} onClick={() => onRecheck(bookmarks.map(b => b.url))} style={{
        marginTop: "14px", padding: "9px 20px", border: `1px solid ${col.line}`,
        background: "transparent", color: col.ink,
        fontSize: "11px", cursor: "pointer",
        fontFamily: col.mono, textTransform: "uppercase", letterSpacing: "0.06em",
        transition: "color 0.3s, border-color 0.3s, background-color 0.3s",
      }}>↻ Re-check now</motion.button>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
      {bookmarks.length > 0 && (
        <div>
          <div style={{
            background: isDark ? "rgba(184,52,31,0.15)" : "rgba(184,52,31,0.08)",
            border: `1px solid ${col.rust}55`,
            padding: "14px 18px", marginBottom: "16px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
            transition: "background-color 0.3s, border-color 0.3s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "18px", color: col.rust }}>✕</span>
              <div>
                <p style={{
                  margin: 0, color: col.rust,
                  fontWeight: 700, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  transition: "color 0.3s",
                }}>
                  {bookmarks.length} severed connection{bookmarks.length !== 1 ? "s" : ""}
                </p>
                <p style={{
                  margin: "3px 0 0", color: col.dim,
                  fontSize: "11px",
                  transition: "color 0.3s",
                }}>
                  These URLs did not respond — likely down, moved, or removed.
                </p>
              </div>
            </div>
            <motion.button whileHover={{ y: -1 }} onClick={() => onRecheck(bookmarks.map(b => b.url))} style={{
              padding: "7px 14px", border: `1px solid ${col.line}`,
              background: "transparent", color: col.ink,
              fontSize: "11px", cursor: "pointer", flexShrink: 0,
              fontFamily: col.mono, textTransform: "uppercase", letterSpacing: "0.05em",
              transition: "color 0.3s, border-color 0.3s, background-color 0.3s",
            }}>↻ Re-check</motion.button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
            {bookmarks.map((b, i) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                visits={visits}
                health={deadHealth}
                onOpen={onOpen}
                index={i}
                accentColor={col.rust}
                theme={theme}
                colors={col}
                actions={
                  <>
                    <CardActionButton
                      colors={col}
                      color={col.sage}
                      title="Mark this link as working — it will be removed from Severed."
                      onClick={() => onMarkWorking(b.url)}
                    >
                      ✓ Working
                    </CardActionButton>
                    <CardActionButton
                      colors={col}
                      color={col.rust}
                      title="Delete this bookmark permanently."
                      onClick={() => {
                        if (confirm(`Delete "${b.title || b.url}"?`)) onDeleteBookmarks(b.id)
                      }}
                    >
                      ⌫ Delete
                    </CardActionButton>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}

      {unverifiable.length > 0 && (
        <div>
          <div style={{
            background: isDark ? "rgba(163,116,47,0.15)" : "rgba(163,116,47,0.08)",
            border: `1px solid ${col.amber}55`,
            padding: "14px 18px", marginBottom: "16px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
            transition: "background-color 0.3s, border-color 0.3s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "18px", color: col.amber }}>◐</span>
              <div>
                <p style={{
                  margin: 0, color: col.amber,
                  fontWeight: 700, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  transition: "color 0.3s",
                }}>
                  {unverifiable.length} unverified connection{unverifiable.length !== 1 ? "s" : ""}
                </p>
                <p style={{
                  margin: "3px 0 0", color: col.dim,
                  fontSize: "11px",
                  transition: "color 0.3s",
                }}>
                  Timed out during check — likely shielded by Cloudflare or similar. Triage manually below.
                </p>
              </div>
            </div>
            <motion.button whileHover={{ y: -1 }} onClick={() => onRecheck(unverifiable.map(b => b.url))} style={{
              padding: "7px 14px", border: `1px solid ${col.line}`,
              background: "transparent", color: col.ink,
              fontSize: "11px", cursor: "pointer", flexShrink: 0,
              fontFamily: col.mono, textTransform: "uppercase", letterSpacing: "0.05em",
              transition: "color 0.3s, border-color 0.3s, background-color 0.3s",
            }}>↻ Re-check</motion.button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
            {unverifiable.map((b, i) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                visits={visits}
                health={unverifiableHealth}
                onOpen={onOpen}
                index={i}
                accentColor={col.amber}
                theme={theme}
                colors={col}
                disableFaviconLoad={disableFavicon}
                actions={
                  <>
                    <CardActionButton
                      colors={col}
                      color={col.sage}
                      title="Mark this link as working — it will be removed from Unverified."
                      onClick={() => onMarkWorking(b.url)}
                    >
                      ✓ Working
                    </CardActionButton>
                    <CardActionButton
                      colors={col}
                      color={col.rust}
                      title="Mark this link as broken — it will move to Severed."
                      onClick={() => onMarkBroken(b.url)}
                    >
                      ✕ Broken
                    </CardActionButton>
                    <CardActionButton
                      colors={col}
                      color={col.dim}
                      title="Delete this bookmark permanently."
                      onClick={() => {
                        if (confirm(`Delete "${b.title || b.url}"?`)) onDeleteBookmarks(b.id)
                      }}
                    >
                      ⌫ Delete
                    </CardActionButton>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
//#endregion

//#region ─── Shared BookmarkCard ──────────────────────────────────────────────
// NOTE: This is a *local* compact card used only by ForgottenView / BrokenView.
// The interactive card with the lock button lives in `components/BookmarkCard.tsx`
// and is rendered by `CollapsibleCategory`. This one intentionally has no toggle.

const BookmarkCard = React.memo(function BookmarkCard({
  bookmark: b, visits, health, onOpen, accentColor, index = 0, theme, colors,
  actions, disableFaviconLoad
}: {
  bookmark: any; visits: VisitStore; health: HealthStore
  onOpen: (id: string, url: string) => void
  accentColor: string; index?: number; theme?: string; colors?: any
  actions?: React.ReactNode
  disableFaviconLoad?: boolean
}) {
  const col = colors || getThemeColors(theme || 'light')
  const [hovered, setHovered] = useState(false)
  const [favicon, setFavicon] = useState<string | null>(null)
  const lastVisit = visits[b.id]
  const addedAgo = b.date ? relativeTime(b.date) : null
  const dot = statusDot(health[b.url]?.status)
  const domain = (() => { try { return new URL(b.url).hostname.replace("www.", "") } catch { return "" } })()

  useEffect(() => {
    if (disableFaviconLoad || !domain) {
      setFavicon(null)
      return
    }
    let cancelled = false
    Promise.resolve(loadFavicon(domain))
      .then((url) => { if (!cancelled) setFavicon(url || null) })
      .catch(() => { if (!cancelled) setFavicon(null) })
    return () => { cancelled = true }
  }, [domain, disableFaviconLoad])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(b.id, b.url)}
      title={b.url}
      style={{
        background: col.bg,
        border: `1px solid ${col.lineFaint}`,
        borderLeft: `2px solid ${accentColor}`,
        padding: "14px 16px", cursor: "pointer",
        display: "flex", flexDirection: "column", gap: "8px",
        fontFamily: col.mono,
        transition: "transform 0.2s ease, box-shadow 0.2s ease, background-color 0.3s, border-color 0.3s",
        position: "relative",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? "2px 2px 0 rgba(22,21,17,0.08)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        {favicon && <img src={favicon} width={16} height={16}
          style={{ marginTop: "2px", flexShrink: 0, filter: "grayscale(0.4)" }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />}
        <span style={{
          color: col.ink,
          fontSize: "12.5px", fontWeight: 600, lineHeight: "1.4",
          wordBreak: "break-word", flex: 1,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          transition: "color 0.3s",
        }}>{b.title || domain}</span>
        <span title={dot.label} style={{
          width: "7px", height: "7px", borderRadius: "50%", background: dot.color,
          flexShrink: 0, marginTop: "4px",
        }} />
      </div>
      <span style={{
        color: col.dim,
        fontSize: "10.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        letterSpacing: "0.02em",
        transition: "color 0.3s",
      }}>{domain}</span>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
        {addedAgo && (
          <span style={{
            border: `1px solid ${accentColor}55`,
            color: accentColor,
            padding: "2px 8px", fontSize: "10px",
            transition: "color 0.3s, border-color 0.3s",
          }}>
            ◷ {addedAgo}
          </span>
        )}
        <span style={{
          border: `1px solid ${lastVisit ? col.line : col.lineFaint}`,
          color: lastVisit ? col.ink : col.dimmer,
          padding: "2px 8px", fontSize: "10px",
          transition: "color 0.3s, border-color 0.3s",
        }}>
          {lastVisit ? `◉ ${relativeTime(lastVisit)}` : "◉ never opened"}
        </span>
      </div>

      {actions && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            display: "flex", gap: "6px", flexWrap: "wrap",
            marginTop: "6px", paddingTop: "8px",
            borderTop: `1px solid ${col.lineFaint}`,
            transition: "border-color 0.3s",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  )
})
//#endregion