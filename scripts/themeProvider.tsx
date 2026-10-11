// scripts/themeProvider.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import browserApi from './storage'
import type { StorageChanges } from './storage'

export type Theme = 'dark' | 'light' | 'high-contrast-dark'

const ThemeContext = createContext(null as any)

const STORAGE_KEY = 'recall_theme'

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  // ── Load theme on mount ────────────────────────────────────────────────────
  // Runs exactly once. The storage listener is registered here too, using a
  // functional state update so we don't need `theme` in the closure — that's
  // what lets the effect have an empty dep array without going stale.
  useEffect(() => {
    let cancelled = false

    async function loadTheme() {
      try {
        const result = await browserApi.storage.local.get([STORAGE_KEY])
        if (cancelled) return

        if (result?.[STORAGE_KEY]) {
          setTheme(result[STORAGE_KEY])
          document.documentElement.setAttribute('data-theme', result[STORAGE_KEY])
        } else {
          // Default to system preference
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          const defaultTheme: Theme = prefersDark ? 'dark' : 'light'
          setTheme(defaultTheme)
          document.documentElement.setAttribute('data-theme', defaultTheme)
          // fire-and-forget; a failure here shouldn't block the UI
          browserApi.storage.local.set({ [STORAGE_KEY]: defaultTheme }).catch(err => {
            console.error('[Wisp] Failed to persist default theme:', err)
          })
        }
        setMounted(true)
      } catch (err) {
        console.error('[Wisp] Failed to load theme:', err)
        if (!cancelled) setMounted(true)
      }
    }

    loadTheme()

    // ── Listen for storage changes (cross-tab / cross-context sync) ─────────
    //  Now goes through browserApi — no `chrome.*` at the call site.
    // The `addListener` wrapper returns an unsubscribe function, so cleanup
    // is a single call instead of holding onto the callback reference.
    const unsubscribe = browserApi.storage.onChanged.addListener(
      (changes: StorageChanges, areaName: string) => {
        if (areaName !== 'local') return
        if (!changes[STORAGE_KEY]) return

        const newTheme = changes[STORAGE_KEY].newValue as Theme | undefined
        if (!newTheme) return

        setTheme(prev => {
          if (prev === newTheme) return prev
          document.documentElement.setAttribute('data-theme', newTheme)
          return newTheme
        })
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const toggleTheme = useCallback(() => {
    const cycle: Theme[] = ['dark', 'light', 'high-contrast-dark']
    setTheme(prev => {
      const next = cycle[(cycle.indexOf(prev) + 1) % cycle.length]
      document.documentElement.setAttribute('data-theme', next)
      browserApi.storage.local.set({ [STORAGE_KEY]: next }).catch(err => {
        console.error('[Wisp] Failed to persist theme toggle:', err)
      })
      return next
    })
  }, [])

  const setThemeDirectly = useCallback((newTheme: Theme) => {
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    browserApi.storage.local.set({ [STORAGE_KEY]: newTheme }).catch(err => {
      console.error('[Wisp] Failed to persist theme:', err)
    })
  }, [])

  if (!mounted) return null

  return (
    <ThemeContext.Provider value={{
      theme,
      toggleTheme,
      setTheme: setThemeDirectly
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}