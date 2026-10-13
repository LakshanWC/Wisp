// FullView.tsx
//#region ─── Imports ──────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react"
import { useFullViewLogic, FORGOTTEN_OPTIONS, PILLS_PREVIEW, groupModeLabel, healthRefreshMessage, getCategoryIcon } from "./scripts/FullViewLogic"
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

//#region ─── Bracket ───────────────────────────────────────────────────────────
const Bracket = React.memo(function Bracket({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="wisp-bracket" style={style}>
      [ {children} ]
    </span>
  )
})
//#endregion

//#region ─── Memoized sub-components ───────────────────────────────────────────

const HeaderStats = React.memo(function HeaderStats({
  allBookmarks, categories, groupMode,
  forgottenCount, brokenCount, unverifiableCount, duplicateCount,
}: {
  allBookmarks: any[]
  categories: string[]
  groupMode: GroupMode
  forgottenCount: number
  brokenCount: number
  unverifiableCount: number
  duplicateCount: number
}) {
  return (
    <div className="wisp-stats">
      <span>
        {allBookmarks.length} ENTRIES · {categories.length} {groupModeLabel(groupMode).toUpperCase()}
        {forgottenCount > 0 && (
          <span className="amber">· {forgottenCount} DORMANT</span>
        )}
        {(brokenCount > 0 || unverifiableCount > 0) && (
          <span className="rust">· {brokenCount} SEVERED{unverifiableCount > 0 ? ` · ${unverifiableCount} UNVERIFIED` : ""}</span>
        )}
        {duplicateCount > 0 && (
          <span className="amber">· {duplicateCount} DUPLICATE{duplicateCount !== 1 ? "S" : ""}</span>
        )}
      </span>
    </div>
  )
})

const SkeletonPill = React.memo(function SkeletonPill({ width = 90 }: { width?: number | string }) {
  return (
    <motion.div
      initial={{ opacity: 0.25 }}
      animate={{ opacity: [0.25, 0.55, 0.25] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      style={{
        height: "33px",
        width,
        border: "1px dashed var(--border-primary)",
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
    return <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }} />
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
  const { theme } = useTheme()   // only used for modal/panel props
  const [showSystemModal, setShowSystemModal] = useState(false)
  const [showUpdatesModal, setShowUpdatesModal] = useState(false)
  const [hasNews, setHasNews] = useState(false)
  const [isSearchBarFocused, setIsSearchBarFocused] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSlashHint, setShowSlashHint] = useState(false)
  const slashHintTimerRef = useRef<number | null>(null)
  const [banner, setBanner] = useState<BannerPayload | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  const deferredHealth = useDeferredValue(logic.health)

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
    onScroll()
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const scrollToSearch = useCallback(() => {
    const el = document.getElementById("searchTextBox")
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
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
          <div key={cat} className="wisp-rename">
            <input
              ref={logic.renameInputRef}
              value={logic.renameValue}
              onChange={e => logic.setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") logic.handleRenameCommit(); if (e.key === "Escape") logic.setRenamingCat(null) }}
              className="wisp-rename__input"
            />
            <button
              onClick={logic.handleRenameCommit}
              disabled={!logic.renameValue.trim()}
              className="wisp-rename__save"
            >
              Save
            </button>
            <button onClick={() => logic.setRenamingCat(null)} className="wisp-rename__cancel">✕</button>
            {Object.values(logic.aliases).includes(cat) && (
              <button onClick={() => logic.handleRenameRevert(cat)} className="wisp-rename__revert">↩ revert</button>
            )}
          </div>
        )
      }
      return (
        <div key={cat} className="wisp-pill-group">
          <YorhaPill
            active={!logic.showForgotten && !logic.showBroken && !logic.showUnverifiable && !logic.showDuplicates && logic.selectedCategory === cat}
            count={logic.grouped[cat].length}
            paddingRight={customCat ? "56px" : "36px"}
            onClick={() => logic.handleCategoryChange(logic.selectedCategory === cat ? "" : cat)}
          >
            {getCategoryIcon(cat, logic.groupMode)} {cat.toUpperCase()}
          </YorhaPill>
          <button
            onClick={e => { e.stopPropagation(); logic.handleRenameStart(cat) }}
            className={`wisp-pill-edit wisp-pill-edit--rename${customCat ? " has-delete" : ""}`}
            title="Rename category"
          >✎</button>
          {customCat && (
            <button
              onClick={e => { e.stopPropagation(); logic.handleDeleteCategory(customCat.id) }}
              className="wisp-pill-edit wisp-pill-edit--delete"
              title="Delete category"
            >✕</button>
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
  ])
  //#endregion

  //#region ─── Private bookmark filtering ────────────────────────────────────
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
    const health = deferredHealth

    if (logic.showPrivate) {
      return (
        <PrivateView
          onUnlock={logic.handlePrivateUnlock}
          onLock={logic.handlePrivateLock}
          isUnlocked={logic.isPrivateUnlocked}
          theme={theme}
          onNotify={showBanner}
        />
      )
    }

    if (logic.showDuplicates && logic.duplicateResult) {
      return (
        <DuplicatesView
          result={logic.duplicateResult}
          onDelete={logic.handleDeleteDuplicates}
          theme={theme}
        />
      )
    }

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
        />
      )
    }

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
        />
      )
    }

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
        />
      )
    }

    if (logic.groupMode === "topic" && logic.useAutoCategorization) {
      const autoCategories = logic.autoCategories
      const categoryNames = Object.keys(autoCategories)

      if (logic.isAutoCategorizing && categoryNames.length === 0) {
        return (
          <div className="wisp-placeholder">
            <SpinnerIcon size={22} color="var(--text-dim)" />
            <p className="wisp-placeholder__sub">
              Analyzing {logic.allBookmarks.length} bookmarks…
            </p>
          </div>
        )
      }

      if (categoryNames.length === 0) {
        return (
          <div className="wisp-placeholder">
            <Bracket>NO AUTO-CATEGORIES FOUND</Bracket>
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
          .filter(b => logic.isPrivateUnlocked || !privateIds.has(b.id))
          .map(b => ({
            ...b,
            description: logic.meta[b.id]?.description,
            healthStatus: health[b.url]?.status,
            isPrivate: privateIds.has(b.id)
          }))

        if (matchedBookmarks.length === 0) return null

        return (
          <div key={cat} style={{ opacity: 1, position: "relative", zIndex: 1 }}>
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
          onDeleteBookmarks={logic.handleDeleteBookmarks}
          onUpdateUrl={logic.handleUpdateUrl}
          onUpdateNote={logic.handleUpdateNote}
        />
      )
    }

    if (logic.visibleCategories.length === 0) {
      return (
        <div className="wisp-placeholder">
          <Bracket>NO ENTRIES FOUND</Bracket>
        </div>
      )
    }

    return logic.visibleCategories.map((cat) => {
      const filteredBookmarks = filterPrivateBookmarks(logic.getFiltered(cat))
        .map(b => ({
          ...b,
          description: logic.meta[b.id]?.description,
          healthStatus: health[b.url]?.status,
          isPrivate: privateIds.has(b.id)
        }))

      if (filteredBookmarks.length === 0) return null

      return (
        <div key={cat} style={{ opacity: 1, position: "relative", zIndex: 1 }}>
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
    deferredHealth,
    logic.forgottenMonths, logic.meta,
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
    filterPrivateBookmarks, privateIds, theme,
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
  }), [logic.allBookmarks, logic.categories, logic.groupMode, logic.forgottenBookmarks.length, logic.brokenBookmarks.length, logic.unverifiableBookmarks.length, logic.duplicateCount])
  //#endregion

  //#region ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="wisp-shell">
      <div className="wisp-shell__inner">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="wisp-head">
          <div>
            <div className="wisp-head__brand">
              <h1 className="wisp-head__title">Wisp</h1>
              <span className="wisp-head__subtitle">// ARCHIVE UNIT</span>
            </div>
            <HeaderStats {...headerStatsProps} />
          </div>

          <div className="wisp-head__right">
            <div className="wisp-head__row">
              <ThemeToggle />

              {/* [⛨] About */}
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ y: 0 }}
                onClick={() => setShowSystemModal(true)}
                className="wisp-hbtn"
                title="About Wisp · permissions"
              >
                ⛨ ABOUT
              </motion.button>

              {/* [⇪] Updates */}
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ y: 0 }}
                onClick={() => setShowUpdatesModal(true)}
                className={`wisp-hbtn${hasNews ? " is-news" : ""}`}
                style={{ position: "relative" }}
                title={hasNews ? "New version available" : "Updates · release notes"}
              >
                ⇪ UPDATES
                {hasNews && <span className="wisp-hbtn__dot" />}
              </motion.button>

              {logic.importStatus === "importing" && (
                <span className="wisp-import-status is-importing">
                  <SpinnerIcon size={12} color="var(--text-dim)" /> SYNCING…
                </span>
              )}
              {logic.importStatus === "done" && logic.importResult && (
                <span className="wisp-import-status is-done">
                  {"metaRestored" in logic.importResult ? (
                    <>
                      ✓ RESTORED {logic.importResult.metaRestored}
                      {logic.importResult.createdCount > 0 ? ` · ${logic.importResult.createdCount} CREATED` : ""}
                      {logic.importResult.unmatched > 0 ? ` · ${logic.importResult.unmatched} UNMATCHED` : ""}
                    </>
                  ) : (
                    <>
                      ✓ IMPORTED {logic.importResult.bookmarks}
                      {logic.importResult.folders > 0 ? ` · ${logic.importResult.folders} FOLDERS` : ""}
                      {logic.importResult.skipped > 0 ? ` · ${logic.importResult.skipped} SKIPPED` : ""}
                    </>
                  )}
                </span>
              )}
              {logic.importStatus === "error" && (
                <span className="wisp-import-status is-error" title={logic.importError ?? ""}>
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

              {/* Export / Import menu */}
              <div ref={logic.exportMenuRef} className="wisp-menu-wrap">
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0 }}
                  onClick={() => logic.setShowExportMenu(m => !m)}
                  className={`wisp-hbtn${logic.showExportMenu ? " is-open" : ""}`}
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
                      className="wisp-menu"
                    >
                      <div className="wisp-menu__label">▸ Export</div>
                      <button
                        onClick={() => { exportStandardHtml(); logic.setShowExportMenu(false) }}
                        className="wisp-menu__item"
                      >
                        <div className="wisp-menu__item-title">BROWSER FORMAT</div>
                        <div className="wisp-menu__item-sub">Standard HTML — import into any browser</div>
                      </button>
                      <button
                        onClick={() => { exportWispBackup(); logic.setShowExportMenu(false) }}
                        className="wisp-menu__item"
                      >
                        <div className="wisp-menu__item-title">Wisp BACKUP</div>
                        <div className="wisp-menu__item-sub">JSON — preserves categories, notes & aliases</div>
                      </button>

                      <div className="wisp-menu__label alt">▸ Import</div>
                      <button
                        onClick={() => { logic.importInputRef.current?.click(); logic.setShowExportMenu(false) }}
                        className="wisp-menu__item"
                      >
                        <div className="wisp-menu__item-title">RESTORE BACKUP</div>
                        <div className="wisp-menu__item-sub">Re-applies categories, notes & aliases by URL</div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Check Links */}
              <motion.button
                whileHover={logic.isChecking ? {} : { y: -1 }}
                whileTap={logic.isChecking ? {} : { y: 0 }}
                onClick={() => handleCheckLinks(logic.healthRefresh.needsRefresh ? false : true)}
                disabled={logic.isChecking}
                className={`wisp-hbtn${logic.isChecking ? " is-checking" : ""}`}
                title={
                  logic.isChecking
                    ? `Checking… ${logic.checkProgress?.done ?? 0}/${logic.checkProgress?.total ?? 0}`
                    : logic.healthRefresh.needsRefresh
                      ? "Update cached link check"
                      : "Re-check all links"
                }
              >
                <CheckLinksLabel
                  isChecking={logic.isChecking}
                  progress={logic.checkProgress ?? null}
                  needsRefresh={logic.healthRefresh.needsRefresh}
                  color="var(--text-dim)"
                />
              </motion.button>
            </div>

            {/* Buy me a coffee */}
            <span>
              <a
                href="https://www.buymeacoffee.com/lampmoth"
                target="_blank"
                rel="noopener noreferrer"
                className="wisp-coffee"
              >
                ☕ Buy me a coffee
              </a>
            </span>
          </div>
        </div>

        {/* ── Progress bar ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {logic.isChecking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="wisp-progress"
            >
              <motion.div
                animate={{ width: `${logic.progressPct}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="wisp-progress__fill"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Search + Group mode ───────────────────────────────────────────── */}
        <div className="wisp-searchrow">
          <div className="wisp-search">
            <span className="wisp-search__caret">▸</span>
            <input
              ref={inputRef}
              id="searchTextBox"
              onFocus={() => setIsSearchBarFocused(true)}
              onBlur={() => setIsSearchBarFocused(false)}
              value={logic.search}
              onChange={e => { logic.setSearch(e.target.value); logic.setSelectedCategory(""); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setShowDuplicates(false) }}
              placeholder="SEARCH ARCHIVE..."
              className="wisp-search__input"
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
                className="wisp-search__clear"
              >
                ✕
              </button>
            )}
          </div>
          <div className="wisp-groupwrap">
            <select
              value={logic.groupMode}
              onChange={e => logic.handleGroupModeChange(e.target.value as GroupMode)}
              className="wisp-groupselect"
            >
              <option value="topic">Group: Topic</option>
              <option value="domain">Group: Domain</option>
              <option value="month">Group: Month</option>
              <option value="date">Group: Date</option>
            </select>
            <div className="wisp-groupwrap__caret">▾</div>
          </div>
        </div>

        {/* ── Pills ─────────────────────────────────────────────────────────── */}
        {logic.showPills && (
          <div className="wisp-pills">
            {isLoading ? (
              <div className="wisp-pills__row">
                <SkeletonPill width={54} />
                <SkeletonPill width={94} />
                <SkeletonPill width={112} />
                <SkeletonPill width={98} />
                <SkeletonPill width={104} />
                <SkeletonPill width={88} />
                <SkeletonPill width={122} />
                <SkeletonPill width={78} />
              </div>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="wisp-pills__row"
                >
                  <YorhaPill
                    active={!logic.showForgotten && !logic.showBroken && !logic.showUnverifiable && !logic.showDuplicates && logic.selectedCategory === ""}
                    onClick={() => { logic.setSelectedCategory(""); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setShowDuplicates(false) }}
                  >ALL</YorhaPill>

                  <YorhaPill
                    active={logic.showPrivate}
                    accent="var(--accent-dark)"
                    onClick={logic.togglePrivateView}
                  >
                    {logic.showPrivate ? (logic.isPrivateUnlocked ? "🔓" : "🔒") : "🔒"} PRIVATE
                  </YorhaPill>

                  {hasForgotten && (
                    <div ref={logic.thresholdMenuRef} style={{ position: "relative" }}>
                      <div className="wisp-pill-split">
                        <YorhaPill
                          active={logic.showForgotten}
                          accent="var(--accent-primary)"
                          count={logic.forgottenBookmarks.length}
                          joinRight
                          onClick={() => { logic.setShowForgotten(f => !f); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                        >◷ DORMANT</YorhaPill>
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={e => { e.stopPropagation(); logic.setShowThresholdMenu(m => !m) }}
                          className={`wisp-pill-split__chev${logic.showForgotten ? " is-active" : ""}`}
                        >▾</motion.button>
                      </div>
                      <AnimatePresence>
                        {logic.showThresholdMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15 }}
                            className="wisp-dropdown"
                          >
                            <p className="wisp-dropdown__title">Not visited in…</p>
                            {FORGOTTEN_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => { logic.setForgottenMonths(opt.value); logic.setShowThresholdMenu(false); logic.setShowForgotten(true); logic.setShowBroken(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                                className={`wisp-dropdown__item${logic.forgottenMonths === opt.value ? " is-active" : ""}`}
                              >
                                {logic.forgottenMonths === opt.value && "▸ "}{opt.label}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {hasBroken && (
                    <YorhaPill
                      active={logic.showBroken}
                      accent="var(--status-broken)"
                      count={logic.isChecking ? undefined : logic.brokenBookmarks.length}
                      onClick={() => { logic.setShowBroken(b => !b); logic.setShowForgotten(false); logic.setShowUnverifiable(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                    >
                      {logic.isChecking ? <SpinnerIcon size={11} color="var(--text-dim)" /> : "✕"} SEVERED
                    </YorhaPill>
                  )}

                  {hasUnverifiable && (
                    <YorhaPill
                      active={logic.showUnverifiable}
                      accent="var(--accent-primary)"
                      count={logic.isChecking ? undefined : logic.unverifiableBookmarks.length}
                      onClick={() => { logic.setShowUnverifiable(u => !u); logic.setShowForgotten(false); logic.setShowBroken(false); logic.setSelectedCategory(""); logic.setShowDuplicates(false) }}
                    >
                      {logic.isChecking ? <SpinnerIcon size={11} color="var(--text-dim)" /> : "◐"} UNVERIFIED
                    </YorhaPill>
                  )}

                  {hasDuplicates && (
                    <YorhaPill
                      active={logic.showDuplicates}
                      accent="var(--accent-primary)"
                      count={logic.duplicateCount}
                      onClick={logic.toggleDuplicates}
                    >⧉ DUPLICATES</YorhaPill>
                  )}

                  {logic.groupMode === "topic" && !logic.search && (
                    <YorhaPill
                      active={logic.useAutoCategorization}
                      accent="var(--accent-dark)"
                      onClick={logic.isAutoCategorizing ? undefined : logic.toggleAutoCategorization}
                      disabled={logic.isAutoCategorizing}
                    >
                      {logic.isAutoCategorizing ? (
                        <>
                          <SpinnerIcon
                            size={11}
                            color={logic.useAutoCategorization ? "var(--bg-primary)" : "var(--text-dim)"}
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
                    <motion.button
                      whileHover={{ y: -1 }}
                      onClick={() => logic.setPillsExpanded(p => !p)}
                      className="wisp-pill wisp-pill--dashed"
                    >
                      {logic.pillsExpanded ? "▲ Less" : <>▾ <span className="accent">+{logic.categories.length - PILLS_PREVIEW}</span> more</>}
                    </motion.button>
                  )}

                  {!logic.showNewCatForm ? (
                    <motion.button
                      whileHover={{ y: -1 }}
                      onClick={() => logic.setShowNewCatForm(true)}
                      className="wisp-pill wisp-pill--dashed"
                    >
                      <span style={{ fontSize: "14px", lineHeight: 1 }}>+</span> New category
                    </motion.button>
                  ) : (
                    <div className="wisp-newcat">
                      <input
                        value={logic.newCatIcon}
                        onChange={e => logic.setNewCatIcon(e.target.value)}
                        maxLength={2}
                        className="wisp-newcat__icon"
                      />
                      <input
                        ref={logic.newCatInputRef}
                        value={logic.newCatName}
                        onChange={e => logic.setNewCatName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") logic.handleAddCategory(); if (e.key === "Escape") { logic.setShowNewCatForm(false); logic.setNewCatName("") } }}
                        placeholder="Category name"
                        className="wisp-newcat__name"
                      />
                      <button
                        onClick={logic.handleAddCategory}
                        disabled={!logic.newCatName.trim()}
                        className="wisp-newcat__add"
                      >Add</button>
                      <button
                        onClick={() => { logic.setShowNewCatForm(false); logic.setNewCatName("") }}
                        className="wisp-newcat__cancel"
                      >✕</button>
                    </div>
                  )}
                </motion.div>

                {hasCustomCats && (
                  <p className="wisp-pills__note">
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
        />

        {/* ── Health cache banner ──────────────────────────────────────────── */}
        <AnimatePresence>
          {logic.showHealthBanner && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="wisp-banner"
            >
              <div className="wisp-banner__left">
                <span className="wisp-banner__icon">◈</span>
                <div style={{ minWidth: 0 }}>
                  <p className="wisp-banner__title">Link check may be stale</p>
                  <p className="wisp-banner__msg">
                    {healthRefreshMessage(logic.healthRefresh)}
                    {logic.healthRefresh.lastCheckedAt && (
                      <> · Last checked {relativeTime(logic.healthRefresh.lastCheckedAt)}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="wisp-banner__right">
                <button
                  onClick={() => { handleCheckLinks(false) }}
                  className="wisp-banner__cta"
                >
                  Check links
                </button>
                <button
                  onClick={() => logic.setHealthBannerDismissed(true)}
                  title="Dismiss for now"
                  className="wisp-banner__close"
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

      {/* ── System panel ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSystemModal && (
          <SystemPanel
            isOpen={showSystemModal}
            onClose={() => setShowSystemModal(false)}
            theme={theme}
          />
        )}
      </AnimatePresence>

      {/* ── Updates panel ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showUpdatesModal && (
          <UpdatesPanel
            isOpen={showUpdatesModal}
            onClose={() => setShowUpdatesModal(false)}
            theme={theme}
          />
        )}
      </AnimatePresence>

      {/* ── Slash hint ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSlashHint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="wisp-hint"
          >
            Press <span className="key">/</span> to jump to search
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scroll to top ───────────────────────────────────────────────────── */}
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
            className="wisp-scrolltop"
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
  active, accent, count, joinRight, paddingRight, onClick, children, disabled,
}: {
  active: boolean
  accent?: string
  count?: number
  joinRight?: boolean
  paddingRight?: string
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  const color = accent || "var(--text-primary)"

  // When active we want the "inverted" look: pill takes accent color as bg,
  // and text/border reads as the page bg. We publish accent as a CSS var so
  // the stylesheet can style children (like the count chip) with the same color.
  const styleVars: React.CSSProperties = active
    ? ({
        ["--pill-accent" as any]: color,
        background: color,
        borderColor: color,
        color: "var(--bg-primary)",
      } as React.CSSProperties)
    : accent
      ? ({ ["--pill-accent" as any]: color } as React.CSSProperties)
      : {}

  return (
    <motion.button
      whileHover={disabled ? {} : { y: -1 }}
      whileTap={disabled ? {} : { y: 0 }}
      onClick={onClick}
      disabled={disabled}
      className="wisp-pill"
      style={{
        ...styleVars,
        borderRightWidth: joinRight ? 0 : 1,
        paddingRight: paddingRight || undefined,
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className="wisp-pill__count"
          style={active ? { color: "var(--bg-primary)", borderColor: "var(--bg-primary)" } : undefined}
        >{count}</span>
      )}
    </motion.button>
  )
})
//#endregion

//#region ─── CardActionButton ─────────────────────────────────────────────────

function CardActionButton({
  onClick, variant, children, title,
}: {
  onClick: () => void
  variant: "sage" | "rust" | "dim"
  children: React.ReactNode
  title?: string
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ y: 0 }}
      onClick={e => { e.stopPropagation(); onClick() }}
      title={title}
      className={`wisp-mini__action wisp-mini__action--${variant}`}
    >
      {children}
    </motion.button>
  )
}
//#endregion

//#region ─── ForgottenView ────────────────────────────────────────────────────

const ForgottenView = React.memo(function ForgottenView({ bookmarks, visits, health, months, onOpen }: {
  bookmarks: any[]; visits: VisitStore; health: HealthStore; months: number
  onOpen: (id: string, url: string) => void
  allCategories?: string[]
  onAssignCategory?: (id: string, cat: string) => void
}) {
  if (bookmarks.length === 0) return (
    <div className="wisp-placeholder">
      <div><Bracket>ARCHIVE CLEAN</Bracket></div>
      <p className="wisp-placeholder__sub">No dormant entries older than {months} months.</p>
    </div>
  )

  const label = months >= 12 ? `${months / 12} year${months > 12 ? "s" : ""}` : `${months} months`

  return (
    <div>
      <div className="wisp-viewbanner">
        <span className="wisp-viewbanner__icon">◷</span>
        <div>
          <p className="wisp-viewbanner__title">{bookmarks.length} entries unvisited for {label}</p>
          <p className="wisp-viewbanner__msg">
            Click an entry to open it — it will be cleared from this list.
          </p>
        </div>
      </div>
      <div className="wisp-viewgrid">
        {bookmarks.map((b, i) => (
          <BookmarkCard
            key={b.id}
            bookmark={b}
            visits={visits}
            health={health}
            onOpen={onOpen}
            index={i}
            accent="amber"
          />
        ))}
      </div>
    </div>
  )
})
//#endregion

//#region ─── BrokenView ───────────────────────────────────────────────────────

const BrokenView = React.memo(function BrokenView({
  bookmarks, unverifiable, visits, isChecking, onOpen, onRecheck,
  onMarkWorking, onMarkBroken, onDeleteBookmarks,
  disableFavicon,
}: {
  bookmarks: any[]; unverifiable: any[]; visits: VisitStore; isChecking: boolean
  onOpen: (id: string, url: string) => void; onRecheck: (urls: string[]) => void
  allCategories?: string[]; onAssignCategory?: (id: string, cat: string) => void
  onMarkWorking: (url: string) => void
  onMarkBroken: (url: string) => void
  onDeleteBookmarks: (id: string) => void
  disableFavicon?: boolean
}) {
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
    <div className="wisp-placeholder">
      <SpinnerIcon size={26} color="var(--text-dim)" />
      <p className="wisp-placeholder__sub">
        Scanning links… results will populate shortly.
      </p>
    </div>
  )

  if (bookmarks.length === 0 && unverifiable.length === 0) return (
    <div className="wisp-placeholder">
      <div style={{ color: "var(--status-ok)" }}>
        <Bracket>ALL LINKS VERIFIED</Bracket>
      </div>
      <p className="wisp-placeholder__sub">All checked links appear reachable.</p>
      <motion.button
        whileHover={{ y: -1 }}
        onClick={() => onRecheck(bookmarks.map(b => b.url))}
        className="wisp-viewbtn"
        style={{ marginTop: "14px" }}
      >
        ↻ Re-check now
      </motion.button>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
      {bookmarks.length > 0 && (
        <div>
          <div className="wisp-viewbanner wisp-viewbanner--rust">
            <div className="wisp-viewbanner__head">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span className="wisp-viewbanner__icon">✕</span>
                <div>
                  <p className="wisp-viewbanner__title">
                    {bookmarks.length} severed connection{bookmarks.length !== 1 ? "s" : ""}
                  </p>
                  <p className="wisp-viewbanner__msg">
                    These URLs did not respond — likely down, moved, or removed.
                  </p>
                </div>
              </div>
              <motion.button
                whileHover={{ y: -1 }}
                onClick={() => onRecheck(bookmarks.map(b => b.url))}
                className="wisp-viewbtn"
              >
                ↻ Re-check
              </motion.button>
            </div>
          </div>
          <div className="wisp-viewgrid">
            {bookmarks.map((b, i) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                visits={visits}
                health={deadHealth}
                onOpen={onOpen}
                index={i}
                accent="rust"
                actions={
                  <>
                    <CardActionButton
                      variant="sage"
                      title="Mark this link as working — it will be removed from Severed."
                      onClick={() => onMarkWorking(b.url)}
                    >
                      ✓ Working
                    </CardActionButton>
                    <CardActionButton
                      variant="rust"
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
          <div className="wisp-viewbanner">
            <div className="wisp-viewbanner__head">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span className="wisp-viewbanner__icon">◐</span>
                <div>
                  <p className="wisp-viewbanner__title">
                    {unverifiable.length} unverified connection{unverifiable.length !== 1 ? "s" : ""}
                  </p>
                  <p className="wisp-viewbanner__msg">
                    Timed out during check — likely shielded by Cloudflare or similar. Triage manually below.
                  </p>
                </div>
              </div>
              <motion.button
                whileHover={{ y: -1 }}
                onClick={() => onRecheck(unverifiable.map(b => b.url))}
                className="wisp-viewbtn"
              >
                ↻ Re-check
              </motion.button>
            </div>
          </div>
          <div className="wisp-viewgrid">
            {unverifiable.map((b, i) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                visits={visits}
                health={unverifiableHealth}
                onOpen={onOpen}
                index={i}
                accent="amber"
                disableFaviconLoad={disableFavicon}
                actions={
                  <>
                    <CardActionButton
                      variant="sage"
                      title="Mark this link as working — it will be removed from Unverified."
                      onClick={() => onMarkWorking(b.url)}
                    >
                      ✓ Working
                    </CardActionButton>
                    <CardActionButton
                      variant="rust"
                      title="Mark this link as broken — it will move to Severed."
                      onClick={() => onMarkBroken(b.url)}
                    >
                      ✕ Broken
                    </CardActionButton>
                    <CardActionButton
                      variant="dim"
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

//#region ─── Compact BookmarkCard (ForgottenView / BrokenView) ────────────────

const BookmarkCard = React.memo(function BookmarkCard({
  bookmark: b, visits, health, onOpen, accent = "amber", index = 0,
  actions, disableFaviconLoad,
}: {
  bookmark: any; visits: VisitStore; health: HealthStore
  onOpen: (id: string, url: string) => void
  accent?: "amber" | "rust" | "sage"
  index?: number
  actions?: React.ReactNode
  disableFaviconLoad?: boolean
}) {
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
      onClick={() => onOpen(b.id, b.url)}
      title={b.url}
      className={`wisp-mini accent-${accent}`}
    >
      <div className="wisp-mini__head">
        {favicon && (
          <img
            src={favicon}
            width={16}
            height={16}
            className="wisp-mini__fav"
            onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        )}
        <span className="wisp-mini__title">{b.title || domain}</span>
        <span
          title={dot.label}
          className="wisp-mini__dot"
          style={{ background: dot.color }}
        />
      </div>
      <span className="wisp-mini__domain">{domain}</span>
      <div className="wisp-mini__chips">
        {addedAgo && (
          <span className="wisp-mini__chip">◷ {addedAgo}</span>
        )}
        <span className={`wisp-mini__chip${lastVisit ? "" : " wisp-mini__chip--muted"}`}>
          {lastVisit ? `◉ ${relativeTime(lastVisit)}` : "◉ never opened"}
        </span>
      </div>

      {actions && (
        <div className="wisp-mini__actions" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
})
//#endregion