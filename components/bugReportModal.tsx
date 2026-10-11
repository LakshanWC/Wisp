// components/BugReportModal.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { BugReportType, sendBugReport } from "../scripts/sendBugReport"

// ─── Shared theme colors ────────────

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

function Bracket({ children, theme, style }: {
  children: React.ReactNode; theme: string; style?: React.CSSProperties
}) {
  const colors = getThemeColors(theme)
  return (
    <span style={{ fontFamily: colors.mono, letterSpacing: "0.08em", ...style }}>
      [ {children} ]
    </span>
  )
}

//#region ─── Types ──────────

export interface BugReportModalProps {
  isOpen: boolean
  onClose: () => void
  theme: string
  colors?: any
}

const TYPE_OPTIONS: { value: BugReportType; label: string; hint: string }[] = [
  { value: BugReportType.BugReport, label: "BUG REPORT",  hint: "Something is broken or misbehaving." },
  { value: BugReportType.Request,   label: "REQUEST",     hint: "Ask for a change to existing behaviour." },
  { value: BugReportType.Update,    label: "UPDATE",      hint: "Note an improvement you'd like to see." },
  { value: BugReportType.Feature,   label: "FEATURE",     hint: "Propose something entirely new." },
  { value: BugReportType.Other,     label: "OTHER",       hint: "Anything that doesn't fit above." },
]
//#endregion

//#region ───BugReport Modal ───────

export default function BugReportModal({
  isOpen,
  onClose,
  theme,
  colors: colorsProp,
}: BugReportModalProps) {
  const colors = colorsProp ?? getThemeColors(theme)
  const isDark = theme === "dark" || theme === "high-contrast-dark"

  const [type, setType] = useState<BugReportType | "">("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // ── Reset form whenever the modal opens ─────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setType("")
      setTitle("")
      setDescription("")
      setError(null)
      setTouched(false)
    }
  }, [isOpen])

  // ── Escape closes ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, onClose])

  // ── Body scroll lock while open ─────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  // ── Validation ──────────────────────────────────────────────────────────
  const titleOk = title.trim().length >= 3
  const descOk  = description.trim().length >= 10
  const typeOk  = type !== ""
  const canSubmit = titleOk && descOk && typeOk

  const validate = useCallback(() => {
    if (!typeOk) return "Select a type."
    if (!title.trim()) return "Title is required."
    if (title.trim().length < 3) return "Title must be at least 3 characters."
    if (!description.trim()) return "Description is required."
    if (description.trim().length < 10) return "Description must be at least 10 characters."
    return null
  }, [typeOk, title, description])

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)

    const err = validate()
    if (err) { setError(err); return }

    sendBugReport({
      type: type as BugReportType,
      title: title.trim(),
      description: description.trim(),
    })

    onClose()
  }, [type, title, description, validate, onClose])

  const activeType = useMemo(
    () => TYPE_OPTIONS.find(o => o.value === type),
    [type]
  )

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="br-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: isDark ? "rgba(0,0,0,0.65)" : "rgba(22,21,17,0.45)",
            backdropFilter: "blur(2px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px",
          }}
        >
          <motion.form
            key="br-panel"
            onSubmit={handleSubmit}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              width: "100%", maxWidth: "620px",
              maxHeight: "calc(100vh - 48px)",
              overflowY: "auto",
              background: colors.bg,
              border: `1px solid ${colors.line}`,
              boxShadow: isDark
                ? "6px 6px 0 rgba(0,0,0,0.5)"
                : "6px 6px 0 rgba(22,21,17,0.18)",
              fontFamily: colors.mono,
              color: colors.ink,
              transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
              position: "relative",
            }}
          >

            {/* ── Header ──────────────────────────────────────────────── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: `1px solid ${colors.line}`,
              transition: "border-color 0.3s",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{
                  fontSize: "14px", fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: colors.ink,
                  transition: "color 0.3s",
                }}>
                  ⚠ REPORT ISSUE
                </span>
                <span style={{
                  fontSize: "10px", color: colors.dim,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  transition: "color 0.3s",
                }}>
                  // OPENS ON GITHUB
                </span>
              </div>
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ y: 0 }}
                onClick={onClose}
                title="Close (Esc)"
                style={{
                  background: "none", border: "none",
                  color: colors.dim, cursor: "pointer",
                  fontSize: "16px", lineHeight: 1, padding: "4px 6px",
                  fontFamily: colors.mono,
                  transition: "color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = colors.ink }}
                onMouseLeave={e => { e.currentTarget.style.color = colors.dim }}
              >
                ✕
              </motion.button>
            </div>

            {/* ── Body ────────────────────────────────────────────────── */}
            <div style={{
              padding: "20px",
              display: "flex", flexDirection: "column", gap: "18px",
            }}>

              <p style={{
                margin: 0, fontSize: "11px",
                color: colors.dim, letterSpacing: "0.03em", lineHeight: 1.6,
                transition: "color 0.3s",
              }}>
                Fill the fields below — Wisp will open a prefilled GitHub issue in a new tab.
                You'll still review & submit it there. No data leaves your browser until you press
                <span style={{ color: colors.ink, fontWeight: 700 }}> Submit new issue </span>
                on GitHub.
              </p>

              {/* ── Type ──────────────────────────────────────────────── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{
                  fontSize: "10px",
                  color: colors.dim,
                  textTransform: "uppercase", letterSpacing: "0.12em",
                  transition: "color 0.3s",
                }}>
                  ▸ TYPE
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {TYPE_OPTIONS.map(opt => {
                    const active = type === opt.value
                    return (
                      <motion.button
                        key={opt.value}
                        type="button"
                        whileHover={{ y: -1 }}
                        whileTap={{ y: 0 }}
                        onClick={() => setType(opt.value)}
                        title={opt.hint}
                        style={{
                          padding: "8px 14px",
                          border: `1px solid ${active ? colors.ink : colors.line}`,
                          background: active ? colors.ink : "transparent",
                          color: active ? colors.bg : colors.ink,
                          fontSize: "11px",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          fontFamily: colors.mono,
                          transition: "background-color 0.2s, color 0.2s, border-color 0.2s",
                        }}
                      >
                        {opt.label}
                      </motion.button>
                    )
                  })}
                </div>
                {activeType && (
                  <span style={{
                    fontSize: "10px", color: colors.dimmer,
                    letterSpacing: "0.03em", marginTop: "2px",
                    transition: "color 0.3s",
                  }}>
                    {activeType.hint}
                  </span>
                )}
              </div>

              {/* ── Title ─────────────────────────────────────────────── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label htmlFor="br-title" style={{
                    fontSize: "10px", color: colors.dim,
                    textTransform: "uppercase", letterSpacing: "0.12em",
                    transition: "color 0.3s",
                  }}>
                    ▸ TITLE
                  </label>
                  <span style={{
                    fontSize: "10px",
                    color: title.length > 100 ? colors.amber : colors.dimmer,
                    letterSpacing: "0.05em",
                    transition: "color 0.3s",
                  }}>
                    {title.length}/120
                  </span>
                </div>
                <input
                  id="br-title"
                  type="text"
                  maxLength={120}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Short summary of the issue"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 12px",
                    background: colors.bg,
                    border: `1px solid ${touched && !titleOk ? colors.rust : colors.line}`,
                    color: colors.ink,
                    fontSize: "12px", outline: "none",
                    letterSpacing: "0.02em",
                    fontFamily: colors.mono,
                    transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = colors.ink }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor =
                      touched && !titleOk ? colors.rust : colors.line
                  }}
                />
              </div>

              {/* ── Description ──────────────────────────────────────── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label htmlFor="br-desc" style={{
                    fontSize: "10px", color: colors.dim,
                    textTransform: "uppercase", letterSpacing: "0.12em",
                    transition: "color 0.3s",
                  }}>
                    ▸ DESCRIPTION
                  </label>
                  <span style={{
                    fontSize: "10px",
                    color: colors.dimmer, letterSpacing: "0.05em",
                    transition: "color 0.3s",
                  }}>
                    {description.length}
                  </span>
                </div>
                <textarea
                  id="br-desc"
                  rows={7}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={
                    "What happened?\nWhat did you expect?\nSteps to reproduce…"
                  }
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 12px",
                    background: colors.bg,
                    border: `1px solid ${touched && !descOk ? colors.rust : colors.line}`,
                    color: colors.ink,
                    fontSize: "12px", outline: "none",
                    letterSpacing: "0.02em", lineHeight: 1.5,
                    fontFamily: colors.mono,
                    resize: "vertical", minHeight: "120px",
                    transition: "background-color 0.3s, color 0.3s, border-color 0.3s",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = colors.ink }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor =
                      touched && !descOk ? colors.rust : colors.line
                  }}
                />
              </div>

              {/* ── Error ─────────────────────────────────────────────── */}
              <AnimatePresence>
                {error && touched && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{
                      overflow: "hidden",
                      border: `1px solid ${colors.rust}55`,
                      background: isDark
                        ? "rgba(184,52,31,0.15)"
                        : "rgba(184,52,31,0.08)",
                      padding: "10px 14px",
                      transition: "background-color 0.3s, border-color 0.3s",
                    }}
                  >
                    <span style={{
                      color: colors.rust, fontSize: "11px",
                      letterSpacing: "0.05em",
                      transition: "color 0.3s",
                    }}>
                      ✕ {error}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: "10px",
              padding: "14px 20px",
              borderTop: `1px solid ${colors.line}`,
              transition: "border-color 0.3s",
              flexWrap: "wrap",
            }}>
              <span style={{
                fontSize: "10px",
                color: colors.dimmer,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                transition: "color 0.3s",
              }}>
                <Bracket theme={theme}>ESC TO CANCEL</Bracket>
              </span>

              <div style={{ display: "flex", gap: "8px" }}>
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0 }}
                  onClick={onClose}
                  style={{
                    padding: "9px 16px",
                    border: `1px solid ${colors.line}`,
                    background: "transparent",
                    color: colors.ink,
                    fontSize: "11px", cursor: "pointer",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    fontFamily: colors.mono,
                    transition: "background-color 0.2s, color 0.2s, border-color 0.2s",
                  }}
                >
                  Cancel
                </motion.button>

                <motion.button
                  type="submit"
                  whileHover={canSubmit ? { y: -1 } : {}}
                  whileTap={canSubmit ? { y: 0 } : {}}
                  disabled={!canSubmit}
                  title={canSubmit ? "Open GitHub issue in new tab" : "Fill all fields first"}
                  style={{
                    padding: "9px 18px",
                    border: `1px solid ${canSubmit ? colors.ink : colors.line}`,
                    background: canSubmit ? colors.ink : "transparent",
                    color: canSubmit ? colors.bg : colors.dimmer,
                    fontSize: "11px",
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    fontFamily: colors.mono,
                    transition: "background-color 0.2s, color 0.2s, border-color 0.2s",
                  }}
                >
                  Open GitHub Issue ↗
                </motion.button>
              </div>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

//#endregion