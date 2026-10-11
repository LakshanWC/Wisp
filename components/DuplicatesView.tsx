import React, { useState } from "react"
import { type DuplicateGroup, type DuplicateResult, totalDuplicateCount } from "../scripts/bookmarkDuplicates"
import { relativeTime } from "../scripts/bookmarkVisits"

interface Props {
  result: DuplicateResult
  onDelete: (ids: string[]) => void
}

//#region ─── DuplicatesView ───

export default function DuplicatesView({ result, onDelete }: Props) {
  const total = totalDuplicateCount(result)

  if (total === 0) return (
    <div style={{ textAlign: "center", color: "#52525b", marginTop: "80px" }}>
      <div style={{ fontSize: "40px", marginBottom: "12px" }}></div>
      <p style={{ fontSize: "15px" }}>No duplicate bookmarks found!</p>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

      {/* ── Exact duplicates ── */}
      {result.exact.length > 0 && (
        <Section
          emoji="🔴"
          title={`${result.exact.length} exact duplicate group${result.exact.length !== 1 ? "s" : ""}`}
          subtitle="These bookmarks point to the identical URL."
          accentColor="#ef4444"
          accentBg="rgba(239,68,68,0.08)"
          accentBorder="rgba(239,68,68,0.2)"
          groups={result.exact}
          onDelete={onDelete}
        />
      )}

      {/* ── Similar duplicates ── */}
      {result.similar.length > 0 && (
        <Section
          emoji="🟡"
          title={`${result.similar.length} similar duplicate group${result.similar.length !== 1 ? "s" : ""}`}
          subtitle="Same page, different URL — stripped of www, http/https differences, trailing slashes, and tracking parameters."
          accentColor="#eab308"
          accentBg="rgba(234,179,8,0.08)"
          accentBorder="rgba(234,179,8,0.2)"
          groups={result.similar}
          onDelete={onDelete}
        />
      )}

    </div>
  )
}
//#endregion

//#region ─── Section ────────

function Section({ emoji, title, subtitle, accentColor, accentBg, accentBorder, groups, onDelete }: {
  emoji: string
  title: string
  subtitle: string
  accentColor: string
  accentBg: string
  accentBorder: string
  groups: DuplicateGroup[]
  onDelete: (ids: string[]) => void
}) {
  return (
    <div>
      {/* Banner */}
      <div style={{
        background: accentBg, border: `1px solid ${accentBorder}`,
        borderRadius: "12px", padding: "14px 18px", marginBottom: "16px",
        display: "flex", alignItems: "flex-start", gap: "12px",
      }}>
        <span style={{ fontSize: "22px", flexShrink: 0 }}>{emoji}</span>
        <div>
          <p style={{ margin: 0, color: accentColor, fontWeight: 600, fontSize: "14px" }}>{title}</p>
          <p style={{ margin: "3px 0 0", color: "#71717a", fontSize: "12px" }}>{subtitle}</p>
        </div>
      </div>

      {/* Groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {groups.map(group => (
          <DuplicateGroupCard
            key={group.key}
            group={group}
            accentColor={accentColor}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}
//#endregion

//#region ─── DuplicateGroupCard ─────────

function DuplicateGroupCard({ group, accentColor, onDelete }: {
  group: DuplicateGroup
  accentColor: string
  onDelete: (ids: string[]) => void
}) {
  // Which IDs are marked for deletion (all except the first/oldest by default)
  const [toDelete, setToDelete] = useState<Set<string>>(
    new Set(group.bookmarks.slice(1).map(b => b.id))
  )
  const [confirmed, setConfirmed] = useState(false)

  const toggleDelete = (id: string) => {
    setToDelete(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDelete = () => {
    if (toDelete.size === 0) return
    onDelete(Array.from(toDelete))
    setConfirmed(true)
  }

  // Derive domain for display
  const domain = (() => { try { return new URL(group.key).hostname.replace("www.", "") } catch { return group.key } })()

  return (
    <div style={{
      background: "#18181b", border: "1px solid #27272a",
      borderRadius: "14px", overflow: "hidden",
    }}>
      {/* Group header */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #27272a",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: "12px", color: "#52525b", fontFamily: "monospace",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {domain}
          </span>
          <span style={{ fontSize: "11px", color: "#3f3f46" }}>
            {group.bookmarks.length} copies — keep the ones you want, delete the rest
          </span>
        </div>

        {!confirmed && (
          <button
            onClick={handleDelete}
            disabled={toDelete.size === 0}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
              border: "none", cursor: toDelete.size === 0 ? "default" : "pointer",
              background: toDelete.size === 0 ? "#27272a" : "#ef4444",
              color: toDelete.size === 0 ? "#52525b" : "white",
              flexShrink: 0, transition: "all 0.15s",
            }}
          >
            Delete {toDelete.size > 0 ? `${toDelete.size} selected` : "selected"}
          </button>
        )}

        {confirmed && (
          <span style={{ fontSize: "12px", color: "#22c55e", flexShrink: 0 }}>✓ Done</span>
        )}
      </div>

      {/* Bookmark rows */}
      <div>
        {group.bookmarks.map((b, i) => {
          const isMarked  = toDelete.has(b.id)
          const isFirst   = i === 0
          const favicon   = (() => { try { return `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32` } catch { return null } })()
          const addedAgo  = b.date ? relativeTime(b.date) : null

          return (
            <div
              key={b.id}
              onClick={() => !confirmed && toggleDelete(b.id)}
              style={{
                padding: "12px 16px",
                borderBottom: i < group.bookmarks.length - 1 ? "1px solid #1f1f23" : "none",
                display: "flex", alignItems: "flex-start", gap: "12px",
                cursor: confirmed ? "default" : "pointer",
                background: isMarked ? "rgba(239,68,68,0.06)" : "transparent",
                transition: "background 0.15s",
                opacity: confirmed && isMarked ? 0.4 : 1,
              }}
            >
              {/* Checkbox */}
              {!confirmed && (
                <div style={{
                  width: 18, height: 18, borderRadius: "5px", flexShrink: 0, marginTop: "1px",
                  background: isMarked ? "#ef4444" : "transparent",
                  border: `1.5px solid ${isMarked ? "#ef4444" : "#3f3f46"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  {isMarked && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              )}

              {/* Favicon */}
              {favicon && (
                <img src={favicon} width={14} height={14}
                  style={{ borderRadius: "3px", flexShrink: 0, marginTop: "2px" }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              )}

              {/* Content */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "13px", fontWeight: 500,
                    color: isMarked ? "#71717a" : "#e4e4e7",
                    textDecoration: isMarked ? "line-through" : "none",
                    transition: "all 0.15s",
                  }}>
                    {b.title || b.url}
                  </span>
                  {isFirst && !confirmed && (
                    <span style={{
                      fontSize: "10px", padding: "1px 7px", borderRadius: "999px",
                      background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 600,
                    }}>
                      oldest
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "4px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11px", color: "#3f3f46",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    maxWidth: "360px" }}>
                    {b.url}
                  </span>
                  {addedAgo && (
                    <span style={{ fontSize: "11px", color: "#52525b", flexShrink: 0 }}>
                      📅 {addedAgo}
                    </span>
                  )}
                </div>
              </div>

              {/* Open link */}
              <a
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  fontSize: "11px", color: "#52525b", flexShrink: 0,
                  textDecoration: "none", padding: "4px 8px",
                  borderRadius: "6px", border: "1px solid #27272a",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#a78bfa"; e.currentTarget.style.borderColor = "#7c3aed" }}
                onMouseLeave={e => { e.currentTarget.style.color = "#52525b"; e.currentTarget.style.borderColor = "#27272a" }}
              >
                ↗
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
//#endregion