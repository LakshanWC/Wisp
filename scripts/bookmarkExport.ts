// bookmarkExport.ts
import { browserApi } from "./storage"
import {
  loadMeta, saveMeta, loadCustomCategories, saveCustomCategories,
  loadCategoryAliases, saveCategoryAliases,
  type MetaStore, type CustomCategory, type CategoryAliases, type BookmarkMeta,
} from "./bookmarkMeta"

//#region ─── Types ────────────────

interface BookmarkNode {
  id: string
  title: string
  url?: string
  dateAdded?: number
  dateGroupModified?: number
  parentId?: string
  children?: BookmarkNode[]
}

export interface WispBackup {
  version: 2
  exportedAt: string
  bookmarks: SerializedBookmark[]
  meta: MetaStore
  customCategories: CustomCategory[]
  categoryAliases: CategoryAliases
}

interface SerializedBookmark {
  id: string
  title: string
  url: string
  dateAdded?: number
  parentId?: string
}
//#endregion

//#region ─── Helpers ─────────────

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href     = url
  a.download = filename
  document.body.appendChild(a)   // ← needed on Firefox
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
//#endregion

//#region ─── 1. Netscape HTML Export ────────

function renderNode(node: BookmarkNode, depth: number): string {
  const indent = "    ".repeat(depth)

  if (node.url) {
    const added = node.dateAdded ? Math.floor(node.dateAdded / 1000) : 0
    return `${indent}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${added}">${escapeHtml(node.title ?? "")}</A>`
  }

  const added    = node.dateAdded         ? Math.floor(node.dateAdded / 1000)         : 0
  const modified = node.dateGroupModified ? Math.floor(node.dateGroupModified / 1000) : 0
  const children = (node.children ?? []).map(c => renderNode(c, depth + 1)).join("\n")

  const isToolbar =
    node.parentId === "0" &&
    (node.title === "Bookmarks bar" || node.title === "Bookmarks Bar" || node.title === "toolbar")
  const attr = isToolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ""

  return [
    `${indent}<DT><H3 ADD_DATE="${added}" LAST_MODIFIED="${modified}"${attr}>${escapeHtml(node.title ?? "")}</H3>`,
    `${indent}<DL><p>`,
    children,
    `${indent}</DL><p>`,
  ].join("\n")
}

export async function exportStandardHtml(): Promise<void> {
  const tree = (await browserApi.bookmarks.getTree()) as BookmarkNode[]

  // Chrome: tree[0] is the invisible root, its children are the real roots.
  // Firefox: same shape (a root "root________" node whose children are menu/toolbar/unfiled).
  const roots = tree[0]?.children ?? []

  const body = roots.map(r => renderNode(r, 1)).join("\n")

  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${body}
</DL><p>`

  const date = new Date().toISOString().slice(0, 10)
  downloadFile(html, `bookmarks_${date}.html`, "text/html")
}
//#endregion

//#region ─── 2. Wisp JSON Backup ──────────

export async function exportWispBackup(): Promise<void> {
  const [meta, customCategories, categoryAliases, tree] = await Promise.all([
    loadMeta(),
    loadCustomCategories(),
    loadCategoryAliases(),
    browserApi.bookmarks.getTree() as Promise<BookmarkNode[]>,
  ])

  const flattenAll = (nodes: BookmarkNode[]): SerializedBookmark[] => {
    const result: SerializedBookmark[] = []
    for (const n of nodes) {
      if (n.url) {
        result.push({
          id:        n.id,
          title:     n.title ?? "",
          url:       n.url,
          dateAdded: n.dateAdded,
          parentId:  n.parentId,
        })
      }
      if (n.children) result.push(...flattenAll(n.children))
    }
    return result
  }

  const backup: WispBackup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    bookmarks: flattenAll(tree),
    meta,
    customCategories,
    categoryAliases,
  }

  const date = new Date().toISOString().slice(0, 10)
  downloadFile(
    JSON.stringify(backup, null, 2),
    `wisp_backup_${date}.json`,
    "application/json"
  )
}
//#endregion

//#region ─── 3. Wisp JSON Restore / Html ──────────

export interface HtmlImportResult {
  bookmarks: number
  folders:   number
  skipped:   number
}

export interface RestoreResult {
  metaRestored:       number
  categoriesRestored: number
  aliasesRestored:    number
  unmatched:          number
  createdCount:       number   // ← new: bookmarks created because they were missing
}

export async function importWispBackup(file: File): Promise<RestoreResult> {
  const text = await file.text()
  let backup: WispBackup

  try {
    backup = JSON.parse(text)
  } catch {
    throw new Error("Invalid file — could not parse JSON.")
  }

  if (!backup.version || !backup.bookmarks || !backup.meta) {
    throw new Error("Invalid Wisp backup file — missing required fields.")
  }

  // ── Snapshot the current tree (url → id) ─────────────────────────────
  const currentTree = (await browserApi.bookmarks.getTree()) as BookmarkNode[]

  const flattenCurrent = (
    nodes: BookmarkNode[],
    map = new Map<string, string>()
  ): Map<string, string> => {
    for (const n of nodes) {
      if (n.url) map.set(n.url, n.id)
      if (n.children) flattenCurrent(n.children, map)
    }
    return map
  }
  const urlToCurrentId = flattenCurrent(currentTree)

  // ── Create any bookmarks in the backup that aren't present here ──────
  // Folder structure is NOT recreated — bookmarks land in the browser's
  // default "Other Bookmarks" / "Unfiled" folder.
  let createdCount = 0
  const createFailures: string[] = []

  for (const b of backup.bookmarks) {
    if (!b.url) continue
    if (urlToCurrentId.has(b.url)) continue

    try {
      const created = await browserApi.bookmarks.create({
        title: b.title || b.url,
        url:   b.url,
      })
      const newId = (created as any)?.id
      if (newId) {
        urlToCurrentId.set(b.url, newId)
        createdCount++
      }
    } catch (err) {
      createFailures.push(`${b.url}: ${(err as Error).message}`)
    }
  }

  // ── Re-apply meta, keyed by old id → url → current id ────────────────
  const oldIdToUrl = new Map<string, string>()
  for (const b of backup.bookmarks) oldIdToUrl.set(b.id, b.url)

  let metaRestored = 0
  let unmatched    = 0

  const currentMeta = await loadMeta()

  for (const [oldId, metaEntry] of Object.entries(backup.meta)) {
    const url = oldIdToUrl.get(oldId)
    if (!url) { unmatched++; continue }
    const currentId = urlToCurrentId.get(url)
    if (!currentId) { unmatched++; continue }

    currentMeta[currentId] = {
      ...currentMeta[currentId],
      ...(metaEntry as BookmarkMeta),
    }
    metaRestored++
  }

  await saveMeta(currentMeta)

  // ── Restore custom categories (merge, skip by name) ──────────────────
  const existingCats  = await loadCustomCategories()
  const existingNames = new Set(existingCats.map(c => c.name.toLowerCase()))
  const newCats       = (backup.customCategories ?? []).filter(
    c => !existingNames.has(c.name.toLowerCase())
  )
  await saveCustomCategories([...existingCats, ...newCats])
  const categoriesRestored = newCats.length

  // ── Restore category aliases (existing wins) ─────────────────────────
  const existingAliases = await loadCategoryAliases()
  const backupAliases   = backup.categoryAliases ?? {}
  const mergedAliases   = { ...backupAliases, ...existingAliases }
  await saveCategoryAliases(mergedAliases)
  const aliasesRestored = Object.keys(backupAliases).filter(
    k => !(k in existingAliases)
  ).length

  if (createFailures.length > 0) {
    console.warn("[Wisp import] some bookmarks could not be created:", createFailures)
  }

  return { metaRestored, categoriesRestored, aliasesRestored, unmatched, createdCount }
}
//#endregion