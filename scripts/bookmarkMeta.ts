// bookmarkMeta.ts
import browserApi from "./storage"

export type BookmarkMeta = {
  description?: string
  customCategory?: string
}

export type MetaStore = Record<string, BookmarkMeta>  // keyed by bookmark id

export type CustomCategory = {
  id: string    // e.g. "cat_1720000000000"
  name: string
  icon: string
}

// Maps auto-generated category names → user-chosen display names.
// e.g. { "Github": "My OSS", "Vercel": "Hosting" }
export type CategoryAliases = Record<string, string>

//#region ─── Storage abstraction ─────────

async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const result = await browserApi.storage.local.get(key)
  return (result?.[key] as T) ?? fallback
}

async function storageSet(key: string, value: unknown): Promise<void> {
  await browserApi.storage.local.set({ [key]: value })
}
//#endregion

//TODO: TO-BE-REMOVED
// function isExtensionContext(): boolean {
//   return (
//     typeof chrome !== "undefined" &&
//     browserApi.storage != null &&
//     browserApi.storage.local != null
//   )
// }

// async function storageGet<T>(key: string, fallback: T): Promise<T> {
//   if (isExtensionContext()) {
//     return new Promise((resolve, reject) => {
//       browserApi.storage.local.get(key, result => {
//         if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
//         else resolve((result[key] as T) ?? fallback)
//       })
//     })
//   }
//   try {
//     const raw = localStorage.getItem(key)
//     return raw ? (JSON.parse(raw) as T) : fallback
//   } catch {
//     return fallback
//   }
// }

// async function storageSet(key: string, value: unknown): Promise<void> {
//   if (isExtensionContext()) {
//     return new Promise((resolve, reject) => {
//       browserApi.storage.local.set({ [key]: value }, () => {
//         if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
//         else resolve()
//       })
//     })
//   }
//   localStorage.setItem(key, JSON.stringify(value))
// }

//#region ─── Bookmark meta ──────────

export async function loadMeta(): Promise<MetaStore> {
  return storageGet<MetaStore>("bookmarkMeta", {})
}

export async function saveMeta(store: MetaStore): Promise<void> {
  return storageSet("bookmarkMeta", store)
}

export async function updateMeta(id: string, patch: Partial<BookmarkMeta>): Promise<void> {
  const store = await loadMeta()
  store[id] = { ...store[id], ...patch }
  if (!store[id].description && !store[id].customCategory) delete store[id]
  await saveMeta(store)
}
//#endregion

//#region ─── Custom categories ─────────

export async function loadCustomCategories(): Promise<CustomCategory[]> {
  return storageGet<CustomCategory[]>("customCategories", [])
}

export async function saveCustomCategories(cats: CustomCategory[]): Promise<void> {
  return storageSet("customCategories", cats)
}

export async function addCustomCategory(name: string, icon = "🗂️"): Promise<CustomCategory> {
  const cats = await loadCustomCategories()
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Category name cannot be empty")
  if (cats.some(c => c.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error(`Category "${trimmed}" already exists`)
  const newCat: CustomCategory = { id: `cat_${Date.now()}`, name: trimmed, icon }
  await saveCustomCategories([...cats, newCat])
  return newCat
}

/** Removes a custom category and clears it from any bookmarks that had it assigned. */
export async function deleteCustomCategory(id: string): Promise<void> {
  const [cats, meta] = await Promise.all([loadCustomCategories(), loadMeta()])
  const targetCat = cats.find(c => c.id === id)
  const filtered = cats.filter(c => c.id !== id)
  if (targetCat) {
    for (const bmId of Object.keys(meta)) {
      if (meta[bmId].customCategory === targetCat.name) {
        delete meta[bmId].customCategory
        if (!meta[bmId].description) delete meta[bmId]
      }
    }
  }
  await Promise.all([saveCustomCategories(filtered), saveMeta(meta)])
}
//#endregion

//#region ─── Category aliases (rename auto-generated categories) ─────────────────────

export async function loadCategoryAliases(): Promise<CategoryAliases> {
  return storageGet<CategoryAliases>("categoryAliases", {})
}

export async function saveCategoryAliases(aliases: CategoryAliases): Promise<void> {
  return storageSet("categoryAliases", aliases)
}

/**
 * Renames an auto-generated category.
 *
 * Two things happen atomically:
 *   1. An alias entry is stored: oldName → newName (so the display layer can
 *      translate the computed name to the user's preferred label).
 *   2. Every bookmark whose customCategory still equals oldName (or any prior
 *      alias that pointed to oldName) is updated to newName, so future lookups
 *      don't need to chase a chain of aliases.
 */
export async function renameCategory(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error("Category name cannot be empty")
  if (trimmed === oldName) return

  const [aliases, meta] = await Promise.all([loadCategoryAliases(), loadMeta()])

  // Find the canonical original name — if "Github" was already aliased to
  // "Open Source", oldName here might be "Open Source", so we need to find
  // the root key to update the alias map correctly.
  const canonical = Object.entries(aliases).find(([, v]) => v === oldName)?.[0] ?? oldName

  // Update/add alias: canonical → newName
  aliases[canonical] = trimmed

  // Cascade: update all bookmarks that were pinned to oldName or canonical
  for (const bmId of Object.keys(meta)) {
    const cur = meta[bmId].customCategory
    if (cur === oldName || cur === canonical) {
      meta[bmId].customCategory = trimmed
    }
  }

  await Promise.all([saveCategoryAliases(aliases), saveMeta(meta)])
}

/**
 * Removes a rename, reverting the category back to its auto-generated name.
 * Also clears the customCategory from any bookmarks that had it set to the alias.
 */
export async function revertCategoryAlias(originalName: string): Promise<void> {
  const [aliases, meta] = await Promise.all([loadCategoryAliases(), loadMeta()])
  const aliasedName = aliases[originalName]
  delete aliases[originalName]

  if (aliasedName) {
    for (const bmId of Object.keys(meta)) {
      if (meta[bmId].customCategory === aliasedName) {
        delete meta[bmId].customCategory
        if (!meta[bmId].description) delete meta[bmId]
      }
    }
  }

  await Promise.all([saveCategoryAliases(aliases), saveMeta(meta)])
}

//#endregion