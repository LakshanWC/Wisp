// scripts/themeProvider.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import browserApi from './storage'
import type { StorageChanges } from './storage'

export type Theme = 'dark' | 'light' | 'high-contrast-dark'

// ── Color palettes ───────────────────────────────────────────────────────────

export type Colors = {
  bg: string
  bgPanel: string      
  ink: string
  dim: string
  dimmer: string
  line: string
  lineFaint: string
  amber: string
  sage: string
  rust: string 
  mono: string
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const PALETTES: Record<Theme, Colors> = {
  dark: {
    bg: '#16150f',
    bgPanel: '#1e1c16',
    ink: '#e8e4d8',
    dim: '#8a8577',
    dimmer: '#5a5548',
    line: '#2a2820',
    lineFaint: '#1e1c16',
    amber: '#c8a03c',
    sage: '#4a5d4f',
    rust: '#b8341f', 
    mono: MONO,
  },
  light: {
    bg: '#e8e4d8',
    bgPanel: '#ddd8c8',
    ink: '#161511',
    dim: '#8a8578',
    dimmer: '#a8a396',
    line: '#161511',
    lineFaint: 'rgba(22,21,17,0.18)',
    amber: '#a3742f',
    sage: '#4a5d4f',
    rust: '#b8341f',
    mono: MONO,
  },
  'high-contrast-dark': {
    bg: '#000000',
    bgPanel: '#111111',
    ink: '#ffffff',
    dim: '#c8c4b8',
    dimmer: '#8a8577',
    line: '#3a3830',
    lineFaint: '#1e1c16',
    amber: '#ffd166',
    sage: '#7bc47f',
    rust: '#ff5544',
    mono: MONO,
  },
}

// ── Context ──────────────────────────────────────────────────────────────────
type ThemeContextValue = {
  theme: Theme
  colors: Colors
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'wisp_theme'

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

  // ✦ Derive colors from the active theme. Falls back to dark if unknown.
  const colors = useMemo<Colors>(() => PALETTES[theme] ?? PALETTES.dark, [theme])

  // ✦ Memoize the context value so consumers don't re-render on every parent tick.
  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    colors,
    toggleTheme,
    setTheme: setThemeDirectly,
  }), [theme, colors, toggleTheme, setThemeDirectly])

  if (!mounted) return null

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}