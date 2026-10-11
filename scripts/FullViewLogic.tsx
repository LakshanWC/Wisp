// FullViewLogic.ts
import { useState, useEffect, useRef, useCallback } from "react"
import { getCategoryes, getCategoryIcon, type GroupMode } from "scripts/bookmarkseparator"
import {
  loadMeta, updateMeta, loadCustomCategories, addCustomCategory, deleteCustomCategory,
  loadCategoryAliases, renameCategory, revertCategoryAlias,
  type MetaStore, type CustomCategory, type CategoryAliases,
} from "scripts/bookmarkMeta"
import {
  loadVisits, recordVisit, filterForgotten, relativeTime,
  type VisitStore,
} from "scripts/bookmarkVisits"
import {
  loadHealth, checkAllUrls, filterDead, filterUnverifiable, statusDot,
  getHealthRefreshInfo,
  type HealthStore,
} from "scripts/bookmarkHealth"
import type {HealthRecord,HealthStatus} from "scripts/bookmarkHealth"
import {
  exportStandardHtml, exportWispBackup, importWispBackup,
  type RestoreResult,
} from "scripts/bookmarkExport"
import type { HtmlImportResult } from "scripts/bookmarkExport"
import { findDuplicates, type DuplicateResult, totalDuplicateCount } from "scripts/bookmarkDuplicates"
import {
  isVaultUnlocked,
  unlockVault,
  lockVault,
  getDecryptedVault,
  hideBookmarksToVault,
  restoreBookmarkFromVault,
  removeFromVaultPermanently,
  hasPrivatePassword,
  touchVaultSession,
  type PrivateBookmark,
} from 'scripts/bookmarkPrivacy'
import { getCatagorized } from "~scripts/catagorizeHelper"
import browserApi from "./storage"

// ─── Constants ───────────────────────────────────────────────────────────────

export const FORGOTTEN_OPTIONS = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "1 year",   value: 12 },
  { label: "2 years",  value: 24 },
]

export const PILLS_PREVIEW = 12

export { getCategoryIcon }

//#region ─── Custom Hook ───────────

export function useFullViewLogic() {
  const [allBookmarks, setAllBookmarks]         = useState<any[]>([])
  const [search, setSearch]                     = useState("")
  const [groupMode, setGroupMode]               = useState<GroupMode>("topic")
  const [selectedCategory, setSelectedCategory] = useState("")
  const [meta, setMeta]                         = useState<MetaStore>({})
  const [customCats, setCustomCats]             = useState<CustomCategory[]>([])

  const [showNewCatForm, setShowNewCatForm] = useState(false)
  const [newCatName, setNewCatName]         = useState("")
  const [newCatIcon, setNewCatIcon]         = useState("🗂️")
  const newCatInputRef                      = useRef<HTMLInputElement>(null)

  const [aliases, setAliases]         = useState<CategoryAliases>({})
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef                = useRef<HTMLInputElement>(null)

  // ── Forgotten ─────────────────────────────────────────────────────────────
  const [visits, setVisits]                       = useState<VisitStore>({})
  const [showForgotten, setShowForgotten]         = useState(false)
  const [forgottenMonths, setForgottenMonths]     = useState(6)
  const [showThresholdMenu, setShowThresholdMenu] = useState(false)
  const thresholdMenuRef                          = useRef<HTMLDivElement>(null)

  // ── Health check ──────────────────────────────────────────────────────────
  const [health, setHealth]               = useState<HealthStore>({})
  const [healthLoaded, setHealthLoaded]   = useState(false)
  const [healthBannerDismissed, setHealthBannerDismissed] = useState(false)
  const [showBroken, setShowBroken]         = useState(false)
  const [showUnverifiable, setShowUnverifiable] = useState(false)
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null)
  const isChecking = checkProgress !== null && checkProgress.done < checkProgress.total
  const checkingRef = useRef(false)

  // ── Duplicates ────────────────────────────────────────────────────────────
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [duplicateResult, setDuplicateResult] = useState<DuplicateResult | null>(null)
  const [duplicateCount, setDuplicateCount] = useState(0)

  // ── Export / Import ───────────────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu]   = useState(false)
  const [importStatus, setImportStatus]       = useState<"idle" | "importing" | "done" | "error">("idle")
  const [importResult, setImportResult]       = useState<RestoreResult | HtmlImportResult | null>(null)
  const [importError, setImportError]         = useState<string | null>(null)
  const exportMenuRef                         = useRef<HTMLDivElement>(null)
  const importInputRef                        = useRef<HTMLInputElement>(null)

  // ── Private vault ─────────────────────────────────────────────────────────
  const [privateBookmarks, setPrivateBookmarks] = useState<PrivateBookmark[]>([])
  const [showPrivate, setShowPrivate]           = useState(false)
  const [isPrivateUnlocked, setIsPrivateUnlocked] = useState(isVaultUnlocked())
  const [hasVaultPassword, setHasVaultPassword] = useState(false)

  // ── Auto-categorization ──────────────────────────────────────────────────
  const [autoCategories, setAutoCategories] = useState<Record<string, any[]>>({})
  const [isAutoCategorizing, setIsAutoCategorizing] = useState(false)
  const [useAutoCategorization, setUseAutoCategorization] = useState(false)

//#endregion

  // ─── Vault status check on mount ─────────────────────────────────────────
  useEffect(() => {
    hasPrivatePassword().then(setHasVaultPassword)
    if (isVaultUnlocked()) {
      getDecryptedVault().then(setPrivateBookmarks).catch(() => setPrivateBookmarks([]))
    }
  }, [])

//#region ─── Load bookmarks from the real tree ────────────────
  const reloadBookmarksFromTree = useCallback(() => {
    return new Promise<any[]>(resolve => {
      chrome.bookmarks.getTree(tree => {
        const flatten = (nodes: chrome.bookmarks.BookmarkTreeNode[]): any[] => {
          let result: any[] = []
          for (const node of nodes) {
            if (node.url) result.push({
              id: node.id,
              title: node.title,
              url: node.url,
              parentId: node.parentId,
              date: node.dateAdded
            })
            if (node.children) result.push(...flatten(node.children))
          }
          return result
        }
        const bookmarks = flatten(tree)
        setAllBookmarks(bookmarks)

        const result = findDuplicates(bookmarks)
        setDuplicateResult(result)
        setDuplicateCount(totalDuplicateCount(result))

        resolve(bookmarks)
      })
    })
  }, [])

  useEffect(() => {
    reloadBookmarksFromTree()
  }, [reloadBookmarksFromTree])

  // ─── Load stored data ─────────────────────────────────────────────────────
  useEffect(() => {
    loadMeta().then(setMeta)
    loadCustomCategories().then(setCustomCats)
    loadCategoryAliases().then(setAliases)
    loadVisits().then(setVisits)
    loadHealth().then(store => {
      setHealth(store)
      setHealthLoaded(true)
    })
  }, [])
  //#endregion

  //#region ─── Auto-categorization effect ─────────
  useEffect(() => {
    if (groupMode !== "topic" || allBookmarks.length === 0) {
      setAutoCategories({})
      setUseAutoCategorization(false)
      return
    }

    const hasExistingCategories = Object.keys(meta).some(id => meta[id]?.customCategory)
    if (hasExistingCategories && !search) {
      setAutoCategories({})
      setUseAutoCategorization(false)
      return
    }

    if (search || showForgotten || showBroken || showUnverifiable || showDuplicates || showPrivate) {
      setAutoCategories({})
      setUseAutoCategorization(false)
      return
    }

    const runAutoCategorization = async () => {
      setIsAutoCategorizing(true)
      try {
        const entries = allBookmarks.map(b => ({
          title: b.title || b.url,
          domain: new URL(b.url).hostname.replace("www.", "")
        }))

        const result = getCatagorized(entries)
        setAutoCategories(result)

        if (Object.keys(result).length > 0 && !hasExistingCategories) {
          setUseAutoCategorization(true)
        }
      } catch (error) {
        console.error("Auto-categorization failed:", error)
        setAutoCategories({})
        setUseAutoCategorization(false)
      } finally {
        setIsAutoCategorizing(false)
      }
    }

    const timeoutId = setTimeout(runAutoCategorization, 500)
    return () => clearTimeout(timeoutId)
  }, [allBookmarks, groupMode, meta, search, showForgotten, showBroken, showUnverifiable, showDuplicates, showPrivate])

  useEffect(() => {
    setHealthBannerDismissed(false)
  }, [allBookmarks.length])
  //#endregion

  //#region ─── Close menus on outside click ─────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (thresholdMenuRef.current && !thresholdMenuRef.current.contains(e.target as Node))
        setShowThresholdMenu(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (!showExportMenu) return
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showExportMenu])

  useEffect(() => { if (renamingCat) renameInputRef.current?.focus() }, [renamingCat])
  useEffect(() => { if (showNewCatForm) newCatInputRef.current?.focus() }, [showNewCatForm])

  const refreshMeta = () => loadMeta().then(setMeta)
  //#endregion

  //#region ─── Duplicate detection ──────────────────
  const runDuplicateCheck = useCallback(() => {
    const result = findDuplicates(allBookmarks)
    setDuplicateResult(result)
    setDuplicateCount(totalDuplicateCount(result))
    setShowDuplicates(true)
    setShowForgotten(false)
    setShowBroken(false)
    setShowUnverifiable(false)
    setSelectedCategory("")
  }, [allBookmarks])

  const handleDeleteDuplicates = async (ids: string[]) => {
    await Promise.all(ids.map(id => browserApi.bookmarks.remove(id)))
    const remainingBookmarks = allBookmarks.filter(b => !ids.includes(b.id))
    setAllBookmarks(remainingBookmarks)
    const result = findDuplicates(remainingBookmarks)
    setDuplicateResult(result)
    setDuplicateCount(totalDuplicateCount(result))
  }
  //#endregion

  //#region ─── Scoped health check ──────────────────
  // Re-checks only the given URLs
  const runHealthCheckForUrls = useCallback(async (urls: string[]) => {
    if (checkingRef.current) return

    // Fall back to full scan if caller didn't specify a subset
    const pool = urls.length > 0
      ? urls
      : allBookmarks.filter(b => b.url.startsWith("http")).map(b => b.url)

    const eligible = pool.filter(u => u.startsWith("http"))
    if (eligible.length === 0) return

    checkingRef.current = true
    setHealthBannerDismissed(true)
    setCheckProgress({ done: 0, total: eligible.length })

    try {
      const store = await checkAllUrls(
        eligible.map((url, i) => ({ id: `scoped-${i}`, url })),
        (updated, done, total) => {
          setHealth({ ...updated })
          setCheckProgress({ done, total })
        },
        6,
        false,
      )
      setHealth({ ...store })
    } finally {
      setCheckProgress(null)
      checkingRef.current = false
    }
  }, [allBookmarks])
  //#endregion

  //#region ─── Health check ──────────────
  const runHealthCheck = useCallback(async (forceAll = false) => {
    if (checkingRef.current || allBookmarks.length === 0) return
    const eligible = allBookmarks.filter(b => b.url.startsWith("http"))
    const refresh = getHealthRefreshInfo(allBookmarks, health)
    const toCheckCount = forceAll ? eligible.length : refresh.uncheckedCount + refresh.staleCount
    if (toCheckCount === 0) return

    checkingRef.current = true
    setHealthBannerDismissed(true)
    setShowBroken(false)
    setShowUnverifiable(false)
    setCheckProgress({ done: 0, total: toCheckCount })
    const store = await checkAllUrls(
      eligible,
      (updated, done, total) => { setHealth({ ...updated }); setCheckProgress({ done, total }) },
      6,
      !forceAll,
    )
    setHealth({ ...store })
    setCheckProgress(null)
    checkingRef.current = false
  }, [allBookmarks, health])

  // ─── Manual health override ───────────────────────────────────────────────
  // Used by the Severed / Unverified views to let the user hand-mark a link
  // as working or broken. Writes directly into the health store so the
  // derived `brokenBookmarks` / `unverifiableBookmarks` lists re-filter and
  // the card drops out of / moves between those views on the next render.
  const setManualHealth = useCallback((url: string, status: HealthStatus) => {
    setHealth(prev => ({
      ...prev,
      [url]: { status, checkedAt: Date.now() },
    }))
  }, [])
  //#endregion

  // ─── Visit tracking ───────────────────────────────────────────────────────
  const handleOpenBookmark = async (bookmarkId: string, url: string) => {
    await recordVisit(bookmarkId)
    setVisits(await loadVisits())
    window.open(url, "_blank", "noopener")
  }

  //#region ─── Rename ────────────
  const handleRenameStart  = (cat: string) => { setRenamingCat(cat); setRenameValue(cat) }
  const handleRenameCommit = async () => {
    if (!renamingCat || !renameValue.trim()) return
    await renameCategory(renamingCat, renameValue.trim())
    setAliases(await loadCategoryAliases())
    refreshMeta(); setRenamingCat(null)
  }
  const handleRenameRevert = async (cat: string) => {
    const canonical = Object.entries(aliases).find(([, v]) => v === cat)?.[0] ?? cat
    await revertCategoryAlias(canonical)
    setAliases(await loadCategoryAliases()); refreshMeta()
  }
  //#endregion

  //#region ─── Category management ────────────
  const handleAssignCategory = async (bookmarkId: string, categoryName: string) => {
    await updateMeta(bookmarkId, { customCategory: categoryName || undefined }); refreshMeta()
    if (useAutoCategorization) {
      setUseAutoCategorization(false)
      setAutoCategories({})
    }
  }
  const handleAddCategory = async () => {
    const name = newCatName.trim(); if (!name) return
    const created = await addCustomCategory(name, newCatIcon)
    setCustomCats(prev => [...prev, created])
    setNewCatName(""); setNewCatIcon("🗂️"); setShowNewCatForm(false)
    if (useAutoCategorization) {
      setUseAutoCategorization(false)
      setAutoCategories({})
    }
  }
  const handleDeleteCategory = async (id: string) => {
    await deleteCustomCategory(id)
    setCustomCats(prev => prev.filter(c => c.id !== id)); refreshMeta()
    if (selectedCategory === customCats.find(c => c.id === id)?.name) setSelectedCategory("")
  }
  //#endregion

  //#region ─── Bulk bookmark actions ─────────
  const handleDeleteBookmarks = async (ids: string[]) => {
    await Promise.all(ids.map(id => browserApi.bookmarks.remove(id)))
    const remainingBookmarks = allBookmarks.filter(b => !ids.includes(b.id))
    setAllBookmarks(remainingBookmarks)
    const result = findDuplicates(remainingBookmarks)
    setDuplicateResult(result)
    setDuplicateCount(totalDuplicateCount(result))
  }

  const handleUpdateUrl = async (id: string, url: string) => {
    await browserApi.bookmarks.update(id, { url })
    const updatedBookmarks = allBookmarks.map(b => b.id === id ? { ...b, url } : b)
    setAllBookmarks(updatedBookmarks)
    const result = findDuplicates(updatedBookmarks)
    setDuplicateResult(result)
    setDuplicateCount(totalDuplicateCount(result))
  }

  const handleUpdateNote = async (id: string, note: string) => {
    await updateMeta(id, { description: note })
    refreshMeta()
  }
  //#endregion

  //#region ─── Import helpers ──────────────────────────────────────────────

  // Parses a standard browser-exported HTML bookmarks file and recreates
  // the folder structure + bookmarks in the browser.

  const importBrowserHtmlBackup = async (file: File): Promise<HtmlImportResult> => {
    const html = await file.text()
    const doc  = new DOMParser().parseFromString(html, "text/html")

    const result: HtmlImportResult = { bookmarks: 0, folders: 0, skipped: 0 }

    const walk = async (dl: Element, parentId: string): Promise<void> => {
      const children = Array.from(dl.children)
      for (const child of children) {
        if (child.tagName !== "DT") continue
        const h3 = child.querySelector(":scope > H3")
        const a  = child.querySelector(":scope > A")

        if (h3) {
          const folderName = h3.textContent?.trim() || "Untitled folder"
          const nestedDl   = child.querySelector(":scope > DL")
          try {
            const created = await browserApi.bookmarks.create({
              parentId,
              title: folderName,
            })
            result.folders++
            if (nestedDl) await walk(nestedDl, created.id)
          } catch {
            result.skipped++
          }
        } else if (a) {
          const url   = a.getAttribute("href") || ""
          const title = a.textContent?.trim() || url
          if (!url) { result.skipped++; continue }
          try {
            await browserApi.bookmarks.create({ parentId, title, url })
            result.bookmarks++
          } catch {
            result.skipped++
          }
        }
      }
    }

    const rootDl = doc.querySelector("DL")
    if (!rootDl) throw new Error("No bookmark structure found in HTML file.")

    await walk(rootDl, "2") // "Other Bookmarks"
    return result
  }
  //#endregion

  // ─── Import handler ──────────────────────────────────────────────────────
  const handleImport = async (file: File | null) => {
    if (!file) return
    setImportStatus("importing")
    setImportError(null)
    try {
      const isHtml =
        file.name.toLowerCase().endsWith(".html") ||
        file.name.toLowerCase().endsWith(".htm") ||
        file.type === "text/html"

      if (isHtml) {
        const result = await importBrowserHtmlBackup(file)
        setImportResult(result)
      } else {
        const result = await importWispBackup(file)
        setImportResult(result)
      }
      setImportStatus("done")
      loadMeta().then(setMeta)
      loadCustomCategories().then(setCustomCats)
      loadCategoryAliases().then(setAliases)
      await reloadBookmarksFromTree()
      setTimeout(() => setImportStatus("idle"), 6000)
    } catch (err: any) {
      setImportError(err.message ?? "Import failed.")
      setImportStatus("error")
      setTimeout(() => setImportStatus("idle"), 6000)
    }
  }

  //#region ─── View switching ────────
  const handleGroupModeChange = (value: GroupMode) => {
    setGroupMode(value); setSelectedCategory(""); setSearch("")
    setShowForgotten(false); setShowBroken(false); setShowUnverifiable(false)
    setShowDuplicates(false)
    if (value !== "topic") {
      setUseAutoCategorization(false)
      setAutoCategories({})
    }
  }
  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value); setSearch("")
    setShowForgotten(false); setShowBroken(false); setShowUnverifiable(false)
    setShowDuplicates(false)
    if (useAutoCategorization) {
      setUseAutoCategorization(false)
    }
  }

  const toggleDuplicates = () => {
    if (!duplicateResult || duplicateCount === 0) {
      runDuplicateCheck()
    } else {
      setShowDuplicates(!showDuplicates)
      if (!showDuplicates) {
        setShowForgotten(false)
        setShowBroken(false)
        setShowUnverifiable(false)
        setSelectedCategory("")
      }
    }
  }
  //#endregion

  //#region ─── Vault operations ───────────

  const refreshPrivateBookmarks = useCallback(async () => {
    if (!isVaultUnlocked()) {
      setPrivateBookmarks([])
      setIsPrivateUnlocked(false)
      return []
    }
    try {
      const list = await getDecryptedVault()
      setPrivateBookmarks(list)
      return list
    } catch {
      setPrivateBookmarks([])
      setIsPrivateUnlocked(false)
      return []
    }
  }, [])

  // Bulk-hide. Used by the picker inside the vault view.
  // Requires the vault to be unlocked (enforced by the caller's UI).
  const handleHideBookmarks = async (bookmarks: any[]): Promise<number> => {
    if (!isVaultUnlocked()) return 0
    try {
      await hideBookmarksToVault(
        bookmarks.map(b => ({
          id: b.id,
          url: b.url,
          title: b.title,
          dateAdded: typeof b.date === "number" ? b.date : undefined,
        }))
      )
      await refreshPrivateBookmarks()
      await reloadBookmarksFromTree()
      touchVaultSession()
      return bookmarks.length
    } catch (err) {
      console.error("Failed to hide bookmarks:", err)
      return 0
    }
  }

  const handleRestoreFromVault = async (vaultEntryId: string): Promise<void> => {
    if (!isVaultUnlocked()) return
    await restoreBookmarkFromVault(vaultEntryId)
    await refreshPrivateBookmarks()
    await reloadBookmarksFromTree()
    touchVaultSession()
  }

  const handleRemoveFromVault = async (vaultEntryId: string): Promise<void> => {
    if (!isVaultUnlocked()) return
    await removeFromVaultPermanently(vaultEntryId)
    await refreshPrivateBookmarks()
    touchVaultSession()
  }

  // Called by the PrivateView after a successful unlock.
  const handlePrivateUnlock = useCallback(async () => {
    setIsPrivateUnlocked(true)
    setShowPrivate(true)
    setHasVaultPassword(true)
    await refreshPrivateBookmarks()
  }, [refreshPrivateBookmarks])

  const handlePrivateLock = () => {
    lockVault()
    setIsPrivateUnlocked(false)
    setShowPrivate(false)
    setPrivateBookmarks([])
  }

  const togglePrivateView = () => {
    if (!showPrivate) {
      setShowPrivate(true)
      setShowForgotten(false)
      setShowBroken(false)
      setShowUnverifiable(false)
      setShowDuplicates(false)
      setSelectedCategory("")
      if (isVaultUnlocked()) {
        refreshPrivateBookmarks()
      }
    } else {
      handlePrivateLock()
    }
  }
//#endregion

  // ─── Toggle auto-categorization ──────────────────────────────────────────
  const toggleAutoCategorization = () => {
    if (useAutoCategorization) {
      setUseAutoCategorization(false)
      setAutoCategories({})
    } else {
      const entries = allBookmarks.map(b => ({
        title: b.title || b.url,
        domain: new URL(b.url).hostname.replace("www.", "")
      }))
      const result = getCatagorized(entries)
      setAutoCategories(result)
      if (Object.keys(result).length > 0) {
        setUseAutoCategorization(true)
      }
    }
  }

  //#region ─── Derived data ─────────
  const grouped    = getCategoryes(allBookmarks, groupMode, meta, aliases)
  const categories = Object.keys(grouped)

  const getFiltered = (cat: string) => {
    if (!search) return grouped[cat] ?? []
    const q = search.toLowerCase()
    return (grouped[cat] ?? []).filter(
      b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    )
  }

  const visibleCategories = (selectedCategory ? [selectedCategory] : categories)
    .filter(cat => getFiltered(cat).length > 0)

  const allCategoryNames = [
    ...Object.keys(getCategoryes(allBookmarks, "topic", {})),
    ...customCats.map(c => c.name),
  ].filter((v, i, a) => a.indexOf(v) === i)

  const forgottenBookmarks    = filterForgotten(allBookmarks, visits, forgottenMonths)
  const brokenBookmarks       = filterDead(allBookmarks, health)
  const unverifiableBookmarks = filterUnverifiable(allBookmarks, health)
  const healthRefresh         = getHealthRefreshInfo(allBookmarks, health)
  const showHealthBanner      = healthLoaded && healthRefresh.needsRefresh && !healthBannerDismissed && !isChecking

  const q = search.toLowerCase()
  const forgottenFiltered = search
    ? forgottenBookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    : forgottenBookmarks
  const brokenFiltered = search
    ? brokenBookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    : brokenBookmarks
  const unverifiableFiltered = search
    ? unverifiableBookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    : unverifiableBookmarks

  const showPills = !search && groupMode !== "date"
  const [pillsExpanded, setPillsExpanded] = useState(false)

  const progressPct = checkProgress
    ? Math.round((checkProgress.done / Math.max(checkProgress.total, 1)) * 100)
    : 0
//#endregion
  
  return {
    // State
    allBookmarks,
    search, setSearch,
    groupMode,
    selectedCategory, setSelectedCategory,
    meta,
    customCats,
    showNewCatForm, setShowNewCatForm,
    newCatName, setNewCatName,
    newCatIcon, setNewCatIcon,
    newCatInputRef,
    aliases,
    renamingCat, setRenamingCat,
    renameValue, setRenameValue,
    renameInputRef,
    visits,
    showForgotten, setShowForgotten,
    forgottenMonths, setForgottenMonths,
    showThresholdMenu, setShowThresholdMenu,
    thresholdMenuRef,
    health,
    healthLoaded,
    healthBannerDismissed, setHealthBannerDismissed,
    showBroken, setShowBroken,
    showUnverifiable, setShowUnverifiable,
    checkProgress,
    isChecking,
    showDuplicates, setShowDuplicates,
    duplicateResult,
    duplicateCount,
    showExportMenu, setShowExportMenu,
    importStatus,
    importResult,
    importError,
    exportMenuRef,
    importInputRef,
    privateBookmarks,
    showPrivate, setShowPrivate,
    isPrivateUnlocked,
    hasVaultPassword,
    pillsExpanded, setPillsExpanded,
    progressPct,
    // Auto-categorization
    autoCategories,
    isAutoCategorizing,
    useAutoCategorization,
    toggleAutoCategorization,
    // Handlers
    runDuplicateCheck,
    handleDeleteDuplicates,
    runHealthCheck,
    runHealthCheckForUrls,
    setManualHealth,
    handleOpenBookmark,
    handleRenameStart,
    handleRenameCommit,
    handleRenameRevert,
    handleAssignCategory,
    handleAddCategory,
    handleDeleteCategory,
    handleDeleteBookmarks,
    handleUpdateUrl,
    handleUpdateNote,
    handleImport,
    handleGroupModeChange,
    handleCategoryChange,
    toggleDuplicates,
    // Vault
    handleHideBookmarks,
    handleRestoreFromVault,
    handleRemoveFromVault,
    handlePrivateUnlock,
    handlePrivateLock,
    togglePrivateView,
    refreshPrivateBookmarks,
    // Derived data
    grouped,
    categories,
    getFiltered,
    visibleCategories,
    allCategoryNames,
    forgottenBookmarks,
    brokenBookmarks,
    unverifiableBookmarks,
    healthRefresh,
    showHealthBanner,
    forgottenFiltered,
    brokenFiltered,
    unverifiableFiltered,
    showPills,
  }
}

//#region ─── Helper Functions ──────────

export function groupModeLabel(mode: GroupMode): string {
  switch (mode) {
    case "topic":  return "categories"
    case "domain": return "domains"
    case "month":  return "months"
    case "date":   return "days"
  }
}

export function healthRefreshMessage(info: ReturnType<typeof getHealthRefreshInfo>): string {
  const parts: string[] = []
  if (info.uncheckedCount > 0) {
    parts.push(`${info.uncheckedCount} link${info.uncheckedCount !== 1 ? "s" : ""} never checked`)
  }
  if (info.staleCount > 0) {
    parts.push(`${info.staleCount} check${info.staleCount !== 1 ? "s" : ""} older than 24 hours`)
  }
  return parts.join(" · ") || "Run a link check to refresh cached results"
}

export const exportMenuItemStyle: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left",
  padding: "10px 14px", background: "none", border: "none",
  cursor: "pointer", transition: "background 0.1s",
  color: 'var(--text-secondary)',
}

export function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: "999px",
    border: `1px solid ${active ? 'var(--border-active)' : 'var(--border-primary)'}`,
    background: active ? 'var(--bg-pill-active)' : 'var(--bg-pill)',
    color: active ? 'var(--accent-primary)' : 'var(--text-dim)',
    fontSize: "13px", cursor: "pointer", transition: "all 0.15s",
    display: "flex", alignItems: "center", gap: "4px",
  }
}
//#endregion