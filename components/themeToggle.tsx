// components/themeToggle.tsx
import React from 'react'
import { useTheme } from '../scripts/themeProvider'
import browserApi from '~scripts/storage'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const themeConfigs = [
    { id: 'dark',               label: 'Dark',          icon: '🌙' },
    { id: 'light',              label: 'Light',         icon: '☀️' },
    { id: 'high-contrast-dark', label: 'High Contrast', icon: '🔆' },
  ]

  const currentIndex = themeConfigs.findIndex(t => t.id === theme)

  const getStyles = () => {
    switch (theme) {
      case 'light':
        return { toggleBg: '#d4d4d8', isDark: false, knobPosition: 'calc(50% - 11px)', labelColor: 'var(--text-secondary)', glowColor: 'rgba(251,191,36,0.08)' }
      case 'high-contrast-dark':
        return { toggleBg: 'var(--accent-secondary)', isDark: true, knobPosition: 'calc(100% - 24px)', labelColor: 'var(--accent-primary)', glowColor: 'rgba(139,92,246,0.15)' }
      default: // dark
        return { toggleBg: 'var(--accent-secondary)', isDark: true, knobPosition: '2px', labelColor: 'var(--accent-primary)', glowColor: 'rgba(124,58,237,0.1)' }
    }
  }

  const styles = getStyles()
  const currentConfig = themeConfigs[currentIndex] ?? themeConfigs[0]

  const handleDotClick = (e: React.MouseEvent, targetTheme: string) => {
    e.stopPropagation()
    setTheme(targetTheme as any)
    document.documentElement.setAttribute('data-theme', targetTheme)
    browserApi.storage.local.set({ theme: targetTheme })
  }

  const cycleTheme = () => {
    const next = themeConfigs[(currentIndex + 1) % themeConfigs.length]
    setTheme(next.id as any)
    document.documentElement.setAttribute('data-theme', next.id)
    browserApi.storage.local.set({ theme: next.id })
  }

  return (
    <button
      onClick={cycleTheme}
      title={`Current: ${currentConfig.label} — click to cycle`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px 5px 8px',
        borderRadius: '10px',
        border: '1px solid var(--border-primary)',
        background: 'var(--bg-tertiary, var(--bg-secondary))',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        // No minWidth — let it be as small as needed
      }}
    >
      {/* Icon dots toggle track */}
      <div style={{
        width: '64px',
        height: '24px',
        borderRadius: '12px',
        background: styles.toggleBg,
        position: 'relative',
        flexShrink: 0,
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
      }}>
        {/* Dot buttons */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-around', padding: '0 2px',
          zIndex: 3,
        }}>
          {themeConfigs.map((config, index) => {
            const isActive = index === currentIndex
            return (
              <div
                key={config.id}
                onClick={e => handleDotClick(e, config.id)}
                style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                  transform: isActive ? 'scale(1.1)' : 'scale(0.85)',
                  fontSize: '9px',
                }}
              >
                <span style={{ opacity: isActive ? 1 : 0.4 }}>{config.icon}</span>
              </div>
            )
          })}
        </div>

        {/* Knob */}
        <div style={{
          position: 'absolute', top: '2px',
          left: styles.knobPosition,
          width: '20px', height: '20px', borderRadius: '50%',
          background: 'white',
          transition: 'left 0.35s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          zIndex: 2,
        }} />
      </div>

      {/* Label */}
      <span style={{
        fontSize: '11px', fontWeight: 500,
        color: styles.labelColor,
        transition: 'color 0.2s',
        whiteSpace: 'nowrap',
      }}>
        {currentConfig.label}
      </span>
    </button>
  )
}