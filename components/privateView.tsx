// components/PrivateView.tsx
import React, { useState, useEffect, useMemo } from 'react'
import browserApi from '../scripts/storage'
import type { BannerPayload } from './customNotificationBanner'
import {
  isVaultUnlocked,
  unlockVault,
  lockVault,
  touchVaultSession,
  hasPrivatePassword,
  clearPrivatePassword,
  getDecryptedVault,
  hideBookmarksToVault,
  restoreBookmarkFromVault,
  removeFromVaultPermanently,
  initializeVaultWithRecovery,
  unlockVaultWithRecoveryKey,
  resetPasswordWithRecoveryKey,
  resetPasswordWithCurrentPassword,
  exportEncryptedBackup,
  exportPlaintextBackup,
  restoreEncryptedBackup,
  restorePlaintextBackup,
  describeBackup,
  suggestedBackupFilename,
  type BackupCredential,
  type PrivateBookmark
} from '../scripts/bookmarkPrivacy'

//#region ─── Type definitions ───────
interface ThemeColors {
  bg: string
  bgPanel: string
  ink: string
  dim: string
  dimmer: string
  line: string
  lineFaint: string
  rust: string
  sage: string
  amber: string
  mono: string
}

interface PrivateViewProps {
  onUnlock: () => void
  onLock: () => void
  isUnlocked: boolean
  theme?: string
  colors?: ThemeColors
  onNotify?: (payload: BannerPayload) => void
}

interface SimpleBookmark {
  id: string
  title: string
  url: string
  domain: string
}

interface RawBookmarkNode {
  id: string
  title: string
  url?: string
  children?: RawBookmarkNode[]
}

interface PendingRestoreHint {
  hint: string
  savedAt: number
}

// Shape stored in the pendingConfirm state. Callbacks are stored alongside the
// labels so the ConfirmModal can be a dumb presenter.
type PendingConfirm = {
  title: string
  subtitle?: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant?: 'default' | 'warning' | 'danger'
  extraAction?: {
    label: string
    onClick: () => Promise<void> | void
  }
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}
//#endregion

//#region ─── Constants ────────

// Storage key for the hint that came from a freshly restored backup. Lives in
// browser storage so it survives a tab close before the user remembers the
// password. Cleared on any successful unlock (the hint has done its job).
const WISP_RESTORE_HINT_KEY = 'wisp_pending_restore_hint'

// Export-side cap. Enforced on the raw string length (not trimmed length) so a
// 200-space hint still fails the check. Read-side uses a more generous cap.
const HINT_MAX_LENGTH = 200
const HINT_READ_MAX_LENGTH = 500

// Backup-staleness tracking keys. `last_change_at` is bumped whenever the
// vault gains content (additions only — deletions are not "loss"). `last_backup`
// records what the user's last export contained so we can tell whether the vault
// has drifted, and by roughly how much.
const VAULT_LAST_CHANGE_KEY        = 'wisp_vault_last_change_at'
const VAULT_LAST_BACKUP_AT_KEY     = 'wisp_vault_last_backup_at'
const VAULT_LAST_BACKUP_COUNT_KEY  = 'wisp_vault_last_backup_count'
const VAULT_LAST_BACKUP_KIND_KEY   = 'wisp_vault_last_backup_kind'

// Banner thresholds. Small additions need time to accumulate before they're
// worth mentioning; big ones are worth mentioning immediately because they
// represent a lot of content at risk.
const SMALL_ADDED_THRESHOLD   = 5
const LARGE_ADDED_THRESHOLD   = 20
const STALE_AFTER_MS          = 7  * 24 * 60 * 60 * 1000
const VERY_STALE_AFTER_MS     = 30 * 24 * 60 * 60 * 1000

// Idle auto-lock. The settings panel promises "5 minutes after last interaction".
const AUTO_LOCK_IDLE_MS = 5 * 60 * 1000

//#endregion

//#region ───  Icons ───

const LockIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
)

const UnlockIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
    <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
  </svg>
)

const ShieldIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
)

const SettingsIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
)

const EyeOffIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
)

const RefreshIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"></polyline>
    <polyline points="23 20 23 14 17 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
)

const TrashIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
)

const TimerIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
)

const AlertTriangleIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
)

const PlusIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
)

const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
)

const KeyIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="15" r="4"></circle>
    <line x1="10.85" y1="12.15" x2="19" y2="4"></line>
    <line x1="18" y1="5" x2="20" y2="7"></line>
    <line x1="15" y1="8" x2="17" y2="10"></line>
  </svg>
)

const DownloadIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
)

const UploadIcon = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>
)

// #endregion

//#region ─── Download / upload helpers ────

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke on next tick — revoking synchronously can cancel the download in Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error('No file selected')); return }
      const reader = new FileReader()
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))) }
        catch { reject(new Error('File is not valid JSON')) }
      }
      reader.onerror = () => reject(new Error('Could not read file'))
      reader.readAsText(file)
    }
    input.click()
  })
}

// #endregion

//#region ─── Recovery Key Modal ────

interface RecoveryKeyModalProps {
  recoveryKey: string | null
  onAcknowledge: () => void
  colors: ThemeColors
  theme?: string
  variant?: 'setup' | 'change'
}

function RecoveryKeyModal({
  recoveryKey,
  onAcknowledge,
  colors,
  theme,
  variant = 'setup',
}: RecoveryKeyModalProps) {
  const [confirmText, setConfirmText] = useState('')
  const [copied, setCopied] = useState(false)
  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  useEffect(() => {
    if (recoveryKey) {
      setConfirmText('')
      setCopied(false)
    }
  }, [recoveryKey])

  if (!recoveryKey) return null

  const isChange = variant === 'change'
  const title = isChange ? 'Your New Recovery Key' : 'Save Your Recovery Key'
  const subtitle = isChange
    ? 'Your previous recovery key is no longer valid.'
    : 'Shown once. Cannot be retrieved later.'
  const warningHeader = isChange
    ? '⚠ Your old recovery key has been replaced'
    : '⚠ If you lose this key, your encrypted bookmarks are gone forever'
  const warningBody = isChange
    ? 'The recovery key you used before has been invalidated. This new key is the only one that will work going forward. Save it now — it will never be shown again.'
    : 'This is the only time the recovery key will be shown. Write it down or store it in a password manager. If you forget both your password and this key, there is no way to recover your private bookmarks.'

  const CONFIRM_PHRASE = 'I have saved this recovery key securely'
  const canConfirm = confirmText.trim().toLowerCase() === CONFIRM_PHRASE.toLowerCase()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      setCopied(true)
    } catch {
      // Clipboard API may fail in some contexts; user can select manually
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(22,21,17,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        style={{
          background: colors.bg,
          border: `2px solid ${colors.rust}`,
          width: '560px', maxWidth: '100%',
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark ? '10px 10px 0 rgba(0,0,0,0.6)' : '10px 10px 0 rgba(184,52,31,0.25)',
        }}
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', gap: '14px',
        }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            border: `1px solid ${colors.rust}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.rust,
          }}>
            <AlertTriangleIcon size={22} />
          </div>
          <div>
            <h3 style={{
              margin: 0, fontSize: '15px', fontWeight: 700,
              color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {title}
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
              {subtitle}
            </p>
          </div>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            padding: '12px 14px',
            border: `1px solid ${colors.rust}`,
            background: isDark ? 'rgba(184,52,31,0.08)' : 'rgba(184,52,31,0.05)',
            marginBottom: '20px',
          }}>
            <div style={{
              fontSize: '11px', color: colors.rust, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px',
            }}>
              {warningHeader}
            </div>
            <p style={{
              margin: 0, fontSize: '11px', color: colors.dim,
              lineHeight: 1.6, letterSpacing: '0.02em',
            }}>
              {warningBody}
            </p>
          </div>

          <label style={{
            display: 'block', fontSize: '10px', color: colors.dim,
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px',
          }}>
            Recovery Key
          </label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              readOnly
              value={recoveryKey}
              onFocus={e => e.currentTarget.select()}
              style={{
                flex: 1,
                padding: '12px 14px',
                border: `1px solid ${colors.line}`,
                background: colors.bgPanel,
                color: colors.ink,
                fontSize: '13px',
                fontFamily: colors.mono,
                letterSpacing: '0.08em',
                outline: 'none',
                fontWeight: 700,
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                padding: '12px 16px',
                border: `1px solid ${copied ? colors.sage : colors.ink}`,
                background: copied ? colors.sage : colors.ink,
                color: colors.bg,
                fontSize: '10px', fontWeight: 700,
                cursor: 'pointer',
                fontFamily: colors.mono,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p style={{
            margin: '0 0 20px 0', fontSize: '10px', color: colors.dimmer,
            letterSpacing: '0.02em', lineHeight: 1.5,
          }}>
            Tip: store it somewhere different from where you keep your password — e.g. a printed copy
            in a safe or a separate password manager entry.
          </p>

          <label style={{
            display: 'block', fontSize: '10px', color: colors.dim,
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px',
          }}>
            Type to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            style={{
              width: '100%',
              padding: '11px 14px',
              border: `1px solid ${canConfirm ? colors.sage : colors.line}`,
              background: colors.bg,
              color: colors.ink,
              fontSize: '12px',
              fontFamily: colors.mono,
              letterSpacing: '0.02em',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <p style={{
            margin: '6px 0 0', fontSize: '10px',
            color: canConfirm ? colors.sage : colors.dimmer,
            letterSpacing: '0.02em',
          }}>
            {canConfirm ? '✓ Confirmed' : `Type exactly: "${CONFIRM_PHRASE}"`}
          </p>
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            onClick={onAcknowledge}
            disabled={!canConfirm}
            style={{
              padding: '11px 24px',
              border: `1px solid ${canConfirm ? colors.ink : colors.dimmer}`,
              background: canConfirm ? colors.ink : colors.dimmer,
              color: colors.bg,
              fontSize: '11px', fontWeight: 700,
              cursor: canConfirm ? 'pointer' : 'default',
              fontFamily: colors.mono,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            I've Saved It — Continue
          </button>
        </div>
      </div>
    </div>
  )
}

//#endregion

//#region ── Helpers ─────

function calculatePasswordStrength(pw: string) {
  if (pw.length === 0) return 0
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[A-Z]/.test(pw)) score += 1
  if (/[0-9]/.test(pw)) score += 1
  if (/[^A-Za-z0-9]/.test(pw)) score += 1
  return Math.min(score, 4)
}

//#endregion

//#region ─── Bookmark Picker Modal ───

interface PickerModalProps {
  isOpen: boolean
  bookmarks: SimpleBookmark[]
  onClose: () => void
  onConfirm: (ids: string[]) => Promise<void>
  theme?: string
  colors: ThemeColors
}

function BookmarkPickerModal({ isOpen, bookmarks, onClose, onConfirm, theme, colors }: PickerModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelected(new Set())
      setIsSubmitting(false)
    }
  }, [isOpen])

  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return bookmarks
    return bookmarks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      b.domain.toLowerCase().includes(q)
    )
  }, [bookmarks, query])

  if (!isOpen) return null

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => setSelected(new Set(filtered.map(b => b.id)))
  const clearSelection = () => setSelected(new Set())

  const handleConfirm = async () => {
    if (selected.size === 0) return
    setIsSubmitting(true)
    try {
      await onConfirm(Array.from(selected))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(22,21,17,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          width: '720px', maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark ? '8px 8px 0 rgba(0,0,0,0.5)' : '8px 8px 0 rgba(22,21,17,0.15)',
        }}
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: 36, height: 36,
              border: `1px solid ${colors.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: colors.ink,
            }}>
              <PlusIcon size={18} />
            </div>
            <div>
              <h3 style={{
                margin: 0, fontSize: '14px', fontWeight: 700,
                color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>
                Add to Vault
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
                {bookmarks.length} available · {selected.size} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            style={{
              background: 'none', border: 'none',
              color: colors.dim, cursor: isSubmitting ? 'default' : 'pointer',
              padding: '4px', display: 'flex',
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{
          padding: '14px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', gap: '10px', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{
              position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
              color: colors.dim, fontSize: '12px', pointerEvents: 'none',
            }}>▸</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search bookmarks..."
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 12px 9px 28px',
                background: colors.bg,
                border: `1px solid ${colors.line}`,
                color: colors.ink,
                fontSize: '12px', outline: 'none',
                fontFamily: colors.mono, letterSpacing: '0.02em',
              }}
            />
          </div>
          <button
            onClick={selectAllFiltered}
            disabled={filtered.length === 0}
            style={{
              padding: '8px 12px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: filtered.length === 0 ? colors.dimmer : colors.ink,
              fontSize: '10px', cursor: filtered.length === 0 ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.06em', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            Select all
          </button>
          <button
            onClick={clearSelection}
            disabled={selected.size === 0}
            style={{
              padding: '8px 12px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: selected.size === 0 ? colors.dimmer : colors.ink,
              fontSize: '10px', cursor: selected.size === 0 ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.06em', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            Clear
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: '48px 20px', textAlign: 'center',
              color: colors.dimmer, fontSize: '12px', letterSpacing: '0.04em',
            }}>
              {query ? 'No bookmarks match your search.' : 'No bookmarks available to hide.'}
            </div>
          ) : (
            filtered.map(b => {
              const isSelected = selected.has(b.id)
              return (
                <label
                  key={b.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    border: `1px solid ${isSelected ? colors.ink : 'transparent'}`,
                    background: isSelected
                      ? (isDark ? 'rgba(232,228,216,0.05)' : 'rgba(22,21,17,0.04)')
                      : 'transparent',
                    marginBottom: '2px',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = isDark ? 'rgba(232,228,216,0.03)' : 'rgba(22,21,17,0.02)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{
                    width: '18px', height: '18px', flexShrink: 0,
                    border: `2px solid ${isSelected ? colors.ink : colors.dimmer}`,
                    background: isSelected ? colors.ink : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}>
                    {isSelected && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke={colors.bg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(b.id)}
                    style={{ display: 'none' }}
                  />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: '12.5px', fontWeight: 600,
                      color: colors.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      letterSpacing: '0.02em',
                    }}>
                      {b.title || b.domain}
                    </div>
                    <div style={{
                      fontSize: '10.5px', color: colors.dim, marginTop: '2px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      letterSpacing: '0.02em',
                    }}>
                      {b.domain || b.url}
                    </div>
                  </div>
                </label>
              )
            })
          )}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', flexShrink: 0,
        }}>
          <span style={{ fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
            {selected.size > 0
              ? `${selected.size} bookmark${selected.size === 1 ? '' : 's'} will be moved to the vault`
              : 'Select bookmarks to move'}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '9px 18px',
                border: `1px solid ${colors.lineFaint}`,
                background: 'transparent',
                color: colors.dim,
                fontSize: '11px', fontWeight: 600, cursor: isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0 || isSubmitting}
              style={{
                padding: '9px 18px',
                border: `1px solid ${selected.size === 0 ? colors.dimmer : colors.ink}`,
                background: selected.size === 0 ? colors.dimmer : colors.ink,
                color: colors.bg,
                fontSize: '11px', fontWeight: 700,
                cursor: selected.size === 0 || isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: selected.size === 0 || isSubmitting ? 0.5 : 1,
              }}
            >
              {isSubmitting ? 'Moving…' : `Move ${selected.size || ''} to vault`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

//#endregion

//#region ─── Confirm Delete Modal ────

interface ConfirmDeleteModalProps {
  isOpen: boolean
  bookmarkTitle: string
  bookmarkUrl: string
  onClose: () => void
  onConfirm: () => Promise<void>
  theme?: string
  colors: ThemeColors
}

function ConfirmDeleteModal({
  isOpen,
  bookmarkTitle,
  bookmarkUrl,
  onClose,
  onConfirm,
  theme,
  colors,
}: ConfirmDeleteModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  useEffect(() => {
    if (isOpen) {
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleConfirm = async () => {
    setIsSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      onClick={isSubmitting ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1600,
        background: isDark ? 'rgba(0,0,0,0.78)' : 'rgba(22,21,17,0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape' && !isSubmitting) onClose()
          if (e.key === 'Enter' && !isSubmitting) handleConfirm()
        }}
        tabIndex={-1}
        ref={el => { if (el && isOpen) el.focus() }}
        style={{
          background: colors.bg,
          border: `2px solid ${colors.rust}`,
          width: '480px', maxWidth: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark ? '8px 8px 0 rgba(0,0,0,0.5)' : '8px 8px 0 rgba(184,52,31,0.22)',
          outline: 'none',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', gap: '14px',
        }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            border: `1px solid ${colors.rust}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.rust,
          }}>
            <TrashIcon size={22} />
          </div>
          <div>
            <h3 style={{
              margin: 0, fontSize: '15px', fontWeight: 700,
              color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Delete Permanently?
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
              This cannot be undone.
            </p>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{
            padding: '12px 14px',
            border: `1px solid ${colors.rust}`,
            background: isDark ? 'rgba(184,52,31,0.08)' : 'rgba(184,52,31,0.05)',
            marginBottom: '20px',
          }}>
            <div style={{
              fontSize: '11px', color: colors.rust, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px',
            }}>
              ⚠ The bookmark will be gone forever
            </div>
            <p style={{
              margin: 0, fontSize: '11px', color: colors.dim,
              lineHeight: 1.6, letterSpacing: '0.02em',
            }}>
              Deleting this removes it from the vault permanently. It will not be added back to your
              browser bookmarks, and there is no trash or undo. If you only want it out of the vault,
              use <strong style={{ color: colors.ink }}>Restore</strong> instead.
            </p>
          </div>

          {/* Bookmark preview */}
          <label style={{
            display: 'block', fontSize: '10px', color: colors.dim,
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px',
          }}>
            Bookmark
          </label>
          <div style={{
            padding: '10px 12px',
            border: `1px solid ${colors.lineFaint}`,
            background: colors.bgPanel,
          }}>
            <div style={{
              fontSize: '12.5px', fontWeight: 700, color: colors.ink,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              letterSpacing: '0.02em', marginBottom: '3px',
            }}>
              {bookmarkTitle || '(untitled)'}
            </div>
            <div style={{
              fontSize: '10.5px', color: colors.dim,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              letterSpacing: '0.02em',
            }}>
              {bookmarkUrl}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: colors.dim,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${isSubmitting ? colors.dimmer : colors.rust}`,
              background: isSubmitting ? colors.dimmer : colors.rust,
              color: colors.bg,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'Deleting…' : 'Delete Forever'}
          </button>
        </div>
      </div>
    </div>
  )
}

//#endregion

//#region ─── Backup Hint Modal ───────

interface BackupHintModalProps {
  isOpen: boolean
  mode: 'encrypted' | 'plaintext'
  onCancel: () => void
  onConfirm: (hint: string | undefined) => Promise<void>
  theme?: string
  colors: ThemeColors
}

function BackupHintModal({
  isOpen,
  mode,
  onCancel,
  onConfirm,
  theme,
  colors,
}: BackupHintModalProps) {
  const [hint, setHint] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  useEffect(() => {
    if (isOpen) {
      setHint('')
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const trimmed = hint.trim()
  const hasHint = trimmed.length > 0
  const tooLong = hint.length > HINT_MAX_LENGTH

  const handleSubmit = async (includeHint: boolean) => {
    if (includeHint && (!hasHint || tooLong)) return
    setIsSubmitting(true)
    try {
      await onConfirm(includeHint ? hint : undefined)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      onClick={isSubmitting ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(22,21,17,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `1px solid ${colors.line}`,
          width: '520px', maxWidth: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark ? '8px 8px 0 rgba(0,0,0,0.5)' : '8px 8px 0 rgba(22,21,17,0.15)',
        }}
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', gap: '14px',
        }}>
          <div style={{
            width: 40, height: 40, flexShrink: 0,
            border: `1px solid ${colors.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.ink,
          }}>
            <KeyIcon size={20} />
          </div>
          <div>
            <h3 style={{
              margin: 0, fontSize: '14px', fontWeight: 700,
              color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Add a Hint?
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
              {mode === 'encrypted'
                ? 'Stored in the backup file in plain text.'
                : 'Stored in the plaintext backup file.'}
            </p>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{
            padding: '12px 14px',
            border: `1px solid ${colors.amber}`,
            background: isDark ? 'rgba(163,116,47,0.10)' : 'rgba(163,116,47,0.06)',
            marginBottom: '18px',
          }}>
            <div style={{
              fontSize: '11px', color: colors.amber, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px',
            }}>
              ⚠ This is not a secret
            </div>
            <p style={{
              margin: 0, fontSize: '11px', color: colors.dim,
              lineHeight: 1.6, letterSpacing: '0.02em',
            }}>
              Anyone who opens this backup file will read the hint. Use a reminder only you
              would understand — <strong style={{ color: colors.ink }}>not</strong> the
              password itself, and not a variation anyone could guess.
            </p>
          </div>

          <label style={{
            display: 'block', fontSize: '10px', color: colors.dim,
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px',
          }}>
            Hint (optional)
          </label>
          <input
            type="text"
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder="e.g. the one from the blue notebook"
            autoFocus
            disabled={isSubmitting}
            maxLength={HINT_MAX_LENGTH + 50 /* let them overshoot so the error is a real state */}
            style={{
              width: '100%',
              padding: '11px 14px',
              border: `1px solid ${tooLong ? colors.rust : colors.line}`,
              background: colors.bg,
              color: colors.ink,
              fontSize: '12px',
              fontFamily: colors.mono,
              letterSpacing: '0.02em',
              outline: 'none',
              boxSizing: 'border-box',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          />
          <p style={{
            margin: '6px 0 0', fontSize: '10px',
            color: tooLong ? colors.rust : colors.dimmer,
            letterSpacing: '0.02em',
          }}>
            {tooLong
              ? `Too long — max ${HINT_MAX_LENGTH} characters`
              : `${hint.length} / ${HINT_MAX_LENGTH}`}
          </p>
          <p style={{
            margin: '12px 0 0', fontSize: '10px', color: colors.dimmer,
            letterSpacing: '0.02em', lineHeight: 1.5,
          }}>
            Next time you open this file and can't remember the password, this hint will be
            shown on the unlock screen to jog your memory.
          </p>
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', justifyContent: 'space-between', gap: '8px',
          flexShrink: 0,
        }}>
          <button
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting}
            style={{
              padding: '10px 16px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: colors.dim,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            Skip Hint
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onCancel}
              disabled={isSubmitting}
              style={{
                padding: '10px 16px',
                border: `1px solid ${colors.lineFaint}`,
                background: 'transparent',
                color: colors.dim,
                fontSize: '10px', fontWeight: 700,
                cursor: isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting || !hasHint || tooLong}
              style={{
                padding: '10px 18px',
                border: `1px solid ${(!hasHint || tooLong || isSubmitting) ? colors.dimmer : colors.ink}`,
                background: (!hasHint || tooLong || isSubmitting) ? colors.dimmer : colors.ink,
                color: colors.bg,
                fontSize: '10px', fontWeight: 700,
                cursor: (!hasHint || tooLong || isSubmitting) ? 'default' : 'pointer',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: (!hasHint || tooLong || isSubmitting) ? 0.5 : 1,
              }}
            >
              {isSubmitting ? 'Exporting…' : 'Save Hint & Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── Restore Credential Modal ───────
//
// Shown after the user confirms they want to restore an encrypted backup. The
// backup layer (restoreEncryptedBackup) requires proof that the user can open
// the backup — either its password or its recovery key — and refuses to touch
// live storage until that proof succeeds. This modal collects the credential
// and, on a wrong answer, shows the specific error from the vault layer without
// closing, so the user can try again.

interface RestoreCredentialModalProps {
  isOpen: boolean
  hint?: string
  exportedAt: number
  onCancel: () => void
  onSubmit: (credential: BackupCredential) => Promise<void>
  theme?: string
  colors: ThemeColors
}

function RestoreCredentialModal({
  isOpen,
  hint,
  exportedAt,
  onCancel,
  onSubmit,
  theme,
  colors,
}: RestoreCredentialModalProps) {
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  useEffect(() => {
    if (isOpen) {
      setMode('password')
      setPassword('')
      setRecoveryKey('')
      setIsSubmitting(false)
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = async () => {
    setError('')
    if (mode === 'password' && !password) {
      setError('Enter the password for this backup')
      return
    }
    if (mode === 'recovery' && !recoveryKey.trim()) {
      setError('Enter the recovery key for this backup')
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(
        mode === 'password'
          ? { password }
          : { recoveryKey: recoveryKey.trim() }
      )
    } catch (e: any) {
      // Restore errors from the vault layer already name the failing party
      // ("Incorrect password for this backup", etc.), so surface them verbatim.
      setError(typeof e?.message === 'string' ? e.message : 'Could not restore this backup')
      setIsSubmitting(false)
    }
  }

  return (
    <div
      onClick={isSubmitting ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1800,
        background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(22,21,17,0.5)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `2px solid ${colors.line}`,
          width: '480px', maxWidth: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark ? '8px 8px 0 rgba(0,0,0,0.5)' : '8px 8px 0 rgba(22,21,17,0.15)',
        }}
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', gap: '14px',
          flexShrink: 0,
        }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            border: `1px solid ${colors.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.ink,
          }}>
            <KeyIcon size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{
              margin: 0, fontSize: '15px', fontWeight: 700,
              color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Unlock Backup
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: colors.dim, letterSpacing: '0.02em' }}>
              Exported {new Date(exportedAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <p style={{
            margin: '0 0 16px', fontSize: '11px', color: colors.dim,
            lineHeight: 1.6, letterSpacing: '0.02em',
          }}>
            Enter the password this backup was made with — or its recovery key. Nothing is
            changed until the backup is proven to open, so a wrong entry here leaves your
            current vault untouched.
          </p>

          {hint && (
            <div style={{
              padding: '12px 14px',
              border: `1px solid ${colors.amber}`,
              background: isDark ? 'rgba(163,116,47,0.10)' : 'rgba(163,116,47,0.06)',
              marginBottom: '16px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px',
              }}>
                <KeyIcon size={12} />
                <span style={{
                  fontSize: '10px', fontWeight: 700, color: colors.amber,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  Hint stored in this backup
                </span>
              </div>
              <p style={{
                margin: 0, fontSize: '12px', color: colors.ink,
                lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {hint}
              </p>
            </div>
          )}

          <div style={{
            display: 'flex',
            border: `1px solid ${colors.line}`,
            marginBottom: '14px',
          }}>
            <button
              onClick={() => { setMode('password'); setRecoveryKey(''); setError('') }}
              disabled={isSubmitting}
              style={{
                flex: 1, padding: '8px 12px',
                border: 'none', borderRight: `1px solid ${colors.line}`,
                background: mode === 'password' ? colors.ink : 'transparent',
                color: mode === 'password' ? colors.bg : colors.dim,
                fontSize: '10px', fontWeight: 700,
                cursor: isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Password
            </button>
            <button
              onClick={() => { setMode('recovery'); setPassword(''); setError('') }}
              disabled={isSubmitting}
              style={{
                flex: 1, padding: '8px 12px',
                border: 'none',
                background: mode === 'recovery' ? colors.ink : 'transparent',
                color: mode === 'recovery' ? colors.bg : colors.dim,
                fontSize: '10px', fontWeight: 700,
                cursor: isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Recovery Key
            </button>
          </div>

          {mode === 'password' ? (
            <input
              type="password"
              placeholder="Backup password"
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
              disabled={isSubmitting}
              autoFocus
              style={{
                width: '100%', padding: '11px 14px',
                border: `1px solid ${colors.line}`,
                background: colors.bg, color: colors.ink,
                fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                fontFamily: colors.mono, letterSpacing: '0.02em',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            />
          ) : (
            <input
              type="text"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX"
              value={recoveryKey}
              onChange={e => { setRecoveryKey(e.target.value); if (error) setError('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
              disabled={isSubmitting}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', padding: '11px 14px',
                border: `1px solid ${colors.line}`,
                background: colors.bg, color: colors.ink,
                fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            />
          )}

          {error && (
            <div style={{
              marginTop: '12px', padding: '10px 12px',
              border: `1px solid ${colors.rust}`,
              background: isDark ? 'rgba(184,52,31,0.08)' : 'rgba(184,52,31,0.05)',
              color: colors.rust, fontSize: '11px',
              letterSpacing: '0.02em', lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          flexShrink: 0,
        }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: colors.dim,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${isSubmitting ? colors.dimmer : colors.ink}`,
              background: isSubmitting ? colors.dimmer : colors.ink,
              color: colors.bg,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'Restoring…' : 'Unlock & Restore'}
          </button>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── Generic Confirm Modal ───────

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  subtitle?: string
  children?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  extraAction?: {
    label: string
    onClick: () => Promise<void> | void
  }
  variant?: 'default' | 'warning' | 'danger'
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  theme?: string
  colors: ThemeColors
}

function ConfirmModal({
  isOpen,
  title,
  subtitle,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  extraAction,
  variant = 'default',
  onConfirm,
  onCancel,
  theme,
  colors,
}: ConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDark = theme === 'dark' || theme === 'high-contrast-dark'

  useEffect(() => {
    if (isOpen) setIsSubmitting(false)
  }, [isOpen])

  if (!isOpen) return null

  const accent =
    variant === 'danger' ? colors.rust :
    variant === 'warning' ? colors.amber :
    colors.ink

  const accentIcon =
    variant === 'danger' ? <TrashIcon size={22} /> :
    variant === 'warning' ? <AlertTriangleIcon size={22} /> :
    <ShieldIcon size={22} />

  const handleConfirm = async () => {
    setIsSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleExtra = async () => {
    if (!extraAction) return
    setIsSubmitting(true)
    try {
      await extraAction.onClick()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      onClick={isSubmitting ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1700,
        background: isDark ? 'rgba(0,0,0,0.78)' : 'rgba(22,21,17,0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        fontFamily: colors.mono,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.bg,
          border: `2px solid ${accent}`,
          width: '520px', maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: isDark
            ? '8px 8px 0 rgba(0,0,0,0.5)'
            : `8px 8px 0 ${variant === 'danger' ? 'rgba(184,52,31,0.22)' : variant === 'warning' ? 'rgba(163,116,47,0.22)' : 'rgba(22,21,17,0.15)'}`,
        }}
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.lineFaint}`,
          display: 'flex', alignItems: 'center', gap: '14px',
          flexShrink: 0,
        }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            border: `1px solid ${accent}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent,
          }}>
            {accentIcon}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{
              margin: 0, fontSize: '15px', fontWeight: 700,
              color: colors.ink, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {title}
            </h3>
            {subtitle && (
              <p style={{
                margin: '3px 0 0', fontSize: '11px', color: colors.dim,
                letterSpacing: '0.02em',
              }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div style={{
          padding: '20px 24px',
          overflowY: 'auto',
          flex: 1,
          fontSize: '11px',
          color: colors.dim,
          lineHeight: 1.6,
          letterSpacing: '0.02em',
        }}>
          {children}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.lineFaint}`,
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${colors.lineFaint}`,
              background: 'transparent',
              color: colors.dim,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>

          {extraAction && (
            <button
              onClick={handleExtra}
              disabled={isSubmitting}
              style={{
                padding: '10px 18px',
                border: `1px solid ${colors.ink}`,
                background: 'transparent',
                color: colors.ink,
                fontSize: '10px', fontWeight: 700,
                cursor: isSubmitting ? 'default' : 'pointer',
                fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              {extraAction.label}
            </button>
          )}

          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            style={{
              padding: '10px 18px',
              border: `1px solid ${isSubmitting ? colors.dimmer : accent}`,
              background: isSubmitting ? colors.dimmer : accent,
              color: colors.bg,
              fontSize: '10px', fontWeight: 700,
              cursor: isSubmitting ? 'default' : 'pointer',
              fontFamily: colors.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
//#endregion

//#region ─── Main Component/Content ───────

export function PrivateView({ onUnlock, onLock, isUnlocked, theme, colors, onNotify }: PrivateViewProps) {
  const YORHA = colors || {
    bg: "#e8e4d8",
    bgPanel: "#ddd8c8",
    ink: "#161511",
    dim: "#8a8578",
    dimmer: "#a8a396",
    line: "#161511",
    lineFaint: "rgba(22,21,17,0.18)",
    rust: "#b8341f",
    sage: "#4a5d4f",
    amber: "#a3742f",
    mono: "'JetBrains Mono', 'Courier New', monospace",
  }

  // Passwords & Auth State
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [isSettingUp, setIsSettingUp] = useState(false)

  // Recovery unlock state
  const [unlockMode, setUnlockMode] = useState<'password' | 'recovery'>('password')
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('')
  const [isRecoveryUnlocking, setIsRecoveryUnlocking] = useState(false)

  // Security States
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(5)
  const [lockoutTime, setLockoutTime] = useState<number | null>(null)

  // Data
  const [privateBookmarks, setPrivateBookmarks] = useState<PrivateBookmark[]>([])
  const [allBookmarks, setAllBookmarks] = useState<SimpleBookmark[]>([])

  // UI & Feedback
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showPasswordSettings, setShowPasswordSettings] = useState(false)

  // Picker modal
  const [showPicker, setShowPicker] = useState(false)

  // Recovery key modal — holds the key string while the modal is open
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [recoveryKeyVariant, setRecoveryKeyVariant] = useState<'setup' | 'change'>('setup')

  // Pending permanent-delete confirmation — the bookmark waiting to be deleted
  const [pendingDelete, setPendingDelete] = useState<PrivateBookmark | null>(null)

  // Backup hint modal — which mode it was opened for (null = closed)
  const [hintModalMode, setHintModalMode] = useState<'encrypted' | 'plaintext' | null>(null)

  // Generic confirm dialog — replaces all window.confirm() calls. Can be opened
  // from any branch (locked, setup, or unlocked), so its JSX is hoisted below
  // and rendered in EVERY branch rather than only in the unlocked return.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  // Hint that came from a freshly-restored encrypted backup. Shown on the
  // locked screen until the user successfully unlocks (or dismisses it).
  const [restoreHint, setRestoreHint] = useState<PendingRestoreHint | null>(null)

  // Encrypted backup awaiting a credential. The confirm modal stages the parsed
  // envelope here; the credential modal consumes it on success. Keeping the
  // envelope (not the credential) in state means a cancelled attempt can be
  // re-opened without re-reading the file from disk.
  const [pendingRestoreEnvelope, setPendingRestoreEnvelope] = useState<{
    envelope: unknown
    hint?: string
    exportedAt: number
  } | null>(null)

  // Settings values
  const [autoLockOnBlur, setAutoLockOnBlur] = useState(true)
  const [blurDomains, setBlurDomains] = useState(true)

  // Domain auto-add
  const [domainAutoAdd, setDomainAutoAdd] = useState(false)
  const [domainAutoAddList, setDomainAutoAddList] = useState<string[]>([])
  const [newDomainInput, setNewDomainInput] = useState('')

  // Change-password flow state
  const [changeAuthMode, setChangeAuthMode] = useState<'password' | 'recovery'>('password')
  const [changeCurrentPassword, setChangeCurrentPassword] = useState('')
  const [changeRecoveryKey, setChangeRecoveryKey] = useState('')
  const [changeNewPassword, setChangeNewPassword] = useState('')
  const [changeConfirmPassword, setChangeConfirmPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const STRENGTH_COLORS = [YORHA.rust, YORHA.amber, YORHA.amber, YORHA.sage, YORHA.sage]
  const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong']

  useEffect(() => {
    checkPasswordStatus()
    loadSettings()
    loadAllBookmarks()
    loadPendingRestoreHint()
  }, [])

  useEffect(() => {
    if (isUnlocked) {
      loadPrivateBookmarks()
    } else {
      setPrivateBookmarks([])
    }
  }, [isUnlocked])

  useEffect(() => {
    if (lockoutTime && Date.now() > lockoutTime) {
      setLockoutTime(null)
      setLoginAttempts(0)
    }
  }, [password])

  // Shared teardown used by manual lock, Escape, tab-blur, and idle auto-lock.
  // Defined before any effect that references it so the `const` is initialised
  // by the time those effects run.
  const lockEverything = () => {
    lockVault()
    onLock()
    setPassword('')
    setRecoveryKeyInput('')
    setUnlockMode('password')
    setChangeCurrentPassword('')
    setChangeRecoveryKey('')
    setChangeNewPassword('')
    setChangeConfirmPassword('')
    setChangeAuthMode('password')
    setPendingDelete(null)
    setHintModalMode(null)
    setPendingConfirm(null)
    setPendingRestoreEnvelope(null)
    setPrivateBookmarks([])
  }

  useEffect(() => {
    if (!autoLockOnBlur || !isUnlocked) return
    const handleVisibilityChange = () => {
      if (document.hidden) lockEverything()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked, autoLockOnBlur])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        isUnlocked &&
        !showPicker &&
        !recoveryKey &&
        !pendingDelete &&
        !hintModalMode &&
        !pendingConfirm &&
        !pendingRestoreEnvelope
      ) {
        lockEverything()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked, showPicker, recoveryKey, pendingDelete, hintModalMode, pendingConfirm, pendingRestoreEnvelope])

  // ─── Idle auto-lock ─────────────────────────────────────────────────────
  // Locks the vault after AUTO_LOCK_IDLE_MS of no user interaction. Without
  // this effect, nothing ever fires the timer — the vault would only lock on
  // manual lock, Escape, or (if enabled) tab switch.
  //
  // The teardown is inlined rather than calling lockEverything() so the effect
  // has no dependency on a function that is re-created on every render. That
  // keeps the timer from being reset every keystroke.
  useEffect(() => {
    if (!isUnlocked) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const reset = () => {
      clear()
      timer = setTimeout(() => {
        lockVault()
        onLock()
        setPassword('')
        setRecoveryKeyInput('')
        setUnlockMode('password')
        setChangeCurrentPassword('')
        setChangeRecoveryKey('')
        setChangeNewPassword('')
        setChangeConfirmPassword('')
        setChangeAuthMode('password')
        setPendingDelete(null)
        setHintModalMode(null)
        setPendingConfirm(null)
        setPendingRestoreEnvelope(null)
        setPrivateBookmarks([])
      }, AUTO_LOCK_IDLE_MS)
      // Keep the backend session timestamp in sync.
      touchVaultSession()
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'touchstart',
      'scroll',
      'focus',
    ]

    events.forEach(evt => window.addEventListener(evt, reset, { passive: true }))

    // Start the clock as soon as the vault unlocks.
    reset()

    return () => {
      clear()
      events.forEach(evt => window.removeEventListener(evt, reset))
    }
  }, [isUnlocked, onLock])

  // ─── Backup staleness evaluation ─────────────────────────────────────────
  //
  // Runs whenever the vault contents change and whenever the vault is unlocked.
  // Uses a threshold model:
  //   * small additions (<5)    → banner only after 7 days, warning after 30
  //   * medium additions (5–19) → same, but the age threshold is applied
  //                               against the first unbacked-up change
  //   * large additions (20+)   → banner immediately
  //
  // Deletions never trigger the banner. The count is `currentCount - backupCount`
  // which naturally accounts for deletions reducing the "at risk" total.
  useEffect(() => {
    if (!isUnlocked || !onNotify) return

    let cancelled = false

    const evaluate = async () => {
      try {
        const stored = await browserApi.storage.local.get([
          VAULT_LAST_CHANGE_KEY,
          VAULT_LAST_BACKUP_AT_KEY,
          VAULT_LAST_BACKUP_COUNT_KEY,
        ])
        if (cancelled) return

        const lastChangeAt  = stored[VAULT_LAST_CHANGE_KEY]       ?? 0
        const lastBackupAt  = stored[VAULT_LAST_BACKUP_AT_KEY]    ?? 0
        const lastBackupN   = stored[VAULT_LAST_BACKUP_COUNT_KEY] ?? 0

        // Nothing changed since the last backup — silence.
        if (lastChangeAt <= lastBackupAt) return

        const addedSinceBackup = Math.max(0, privateBookmarks.length - lastBackupN)
        if (addedSinceBackup <= 0) return

        const ageMs = Date.now() - lastChangeAt

        let variant: BannerPayload['variant'] = 'info'
        let title = 'Vault changes not backed up'
        let message = ''

        if (addedSinceBackup >= LARGE_ADDED_THRESHOLD) {
          variant = 'warning'
          message =
            `You've added ${addedSinceBackup} bookmark${addedSinceBackup === 1 ? '' : 's'} to the vault ` +
            `since the last backup. Export a fresh copy so you don't lose them.`
        } else if (ageMs >= VERY_STALE_AFTER_MS) {
          variant = 'warning'
          message =
            `Your vault has ${addedSinceBackup} unbacked-up bookmark${addedSinceBackup === 1 ? '' : 's'} ` +
            `and the last change was over a month ago. Export a fresh copy.`
        } else if (ageMs >= STALE_AFTER_MS && addedSinceBackup >= 1) {
          variant = 'info'
          message =
            `Your vault has ${addedSinceBackup} bookmark${addedSinceBackup === 1 ? '' : 's'} ` +
            `added since your last backup. Consider exporting a fresh copy.`
        } else {
          // Fresh changes below threshold — stay quiet for now.
          return
        }

        onNotify({
          title,
          message,
          variant,
          icon: '⛨',
          actionLabel: 'Back up now',
          onAction: () => setHintModalMode('encrypted'),
        })
      } catch (e) {
        // Non-fatal — the banner is a nicety, not required for the vault.
        console.warn('Backup status evaluation failed:', e)
      }
    }

    evaluate()
    return () => { cancelled = true }
    // Re-evaluate whenever the vault contents change.
  }, [isUnlocked, privateBookmarks.length, onNotify])

  const checkPasswordStatus = async () => {
    const exists = await hasPrivatePassword()
    setHasPassword(exists)
    setIsLoading(false)
  }

  const loadPendingRestoreHint = async () => {
    try {
      const result = await browserApi.storage.local.get([WISP_RESTORE_HINT_KEY])
      const stored = result[WISP_RESTORE_HINT_KEY]
      if (
        stored &&
        typeof stored === 'object' &&
        typeof stored.hint === 'string' &&
        stored.hint.length > 0 &&
        stored.hint.length <= HINT_READ_MAX_LENGTH
      ) {
        setRestoreHint({
          hint: stored.hint,
          savedAt: typeof stored.savedAt === 'number' ? stored.savedAt : Date.now(),
        })
      }
    } catch (e) {
      console.warn('Failed to load restore hint:', e)
    }
  }

  const clearRestoreHint = async () => {
    setRestoreHint(null)
    try {
      await browserApi.storage.local.remove([WISP_RESTORE_HINT_KEY])
    } catch (e) {
      console.warn('Failed to clear restore hint from storage:', e)
    }
  }

  const loadPrivateBookmarks = async () => {
    try {
      const bookmarks = await getDecryptedVault()
      setPrivateBookmarks(bookmarks)
    } catch (e) {
      setPrivateBookmarks([])
      onLock()
    }
  }

  const getDomain = (url: string): string => {
    try { return new URL(url).hostname.replace('www.', '') }
    catch { return '' }
  }

  const loadAllBookmarks = async () => {
    const bookmarkTreeData = await browserApi.bookmarks.getTree()

    const flatten = (nodes: RawBookmarkNode[]): SimpleBookmark[] => {
      const result: SimpleBookmark[] = []
      for (const node of nodes) {
        if (node.url) {
          result.push({
            id: node.id,
            title: node.title || '',
            url: node.url,
            domain: getDomain(node.url),
          })
        }
        if (node.children) result.push(...flatten(node.children))
      }
      return result
    }

    setAllBookmarks(flatten(bookmarkTreeData))
  }

  const loadSettings = async () => {
    const result = await browserApi.storage.local.get([
      'wisp_private_auto_lock_blur',
      'wisp_private_blur_domains',
      'wisp_private_domain_auto_add',
      'wisp_private_domain_auto_add_list',
      'wisp_private_max_attempts',
    ])
    if (result.wisp_private_auto_lock_blur !== undefined) setAutoLockOnBlur(result.wisp_private_auto_lock_blur)
    if (result.wisp_private_blur_domains !== undefined) setBlurDomains(result.wisp_private_blur_domains)
    if (result.wisp_private_domain_auto_add !== undefined) setDomainAutoAdd(result.wisp_private_domain_auto_add)
    if (result.wisp_private_domain_auto_add_list) setDomainAutoAddList(result.wisp_private_domain_auto_add_list)
    if (result.wisp_private_max_attempts) setMaxLoginAttempts(result.wisp_private_max_attempts)
  }

  const showFeedback = (msg: string, isError = false) => {
    if (isError) {
      setError(msg)
      setTimeout(() => setError(''), 4000)
    } else {
      setSuccess(msg)
      setTimeout(() => setSuccess(''), 4000)
    }
  }

  // ─── Unlock / Lock ────────────────────────────────────────────────────────

  const handleUnlock = async () => {
    if (lockoutTime && Date.now() < lockoutTime) {
      const waitMinutes = Math.ceil((lockoutTime - Date.now()) / 60000)
      showFeedback(`Too many attempts. Try again in ${waitMinutes}m`, true)
      return
    }

    if (!password) {
      showFeedback('Please enter your password', true)
      return
    }

    try {
      const bookmarks = await unlockVault(password)
      setPrivateBookmarks(bookmarks)
      setPassword('')
      setLoginAttempts(0)
      onUnlock()
      touchVaultSession()
      await clearRestoreHint()
    } catch (e: any) {
      if (e?.message === 'Incorrect password') {
        const newAttempts = loginAttempts + 1
        setLoginAttempts(newAttempts)
        if (newAttempts >= maxLoginAttempts) {
          setLockoutTime(Date.now() + 5 * 60 * 1000)
          showFeedback(`Too many attempts. Locked out for 5 minutes.`, true)
        } else {
          showFeedback(`Incorrect password (${maxLoginAttempts - newAttempts} attempts left)`, true)
        }
      } else {
        showFeedback('Vault data could not be decrypted (corrupted or tampered).', true)
      }
    }
  }

  const handleRecoveryUnlock = async () => {
    const key = recoveryKeyInput.trim()
    if (!key) {
      showFeedback('Please enter your recovery key', true)
      return
    }

    setIsRecoveryUnlocking(true)
    try {
      const bookmarks = await unlockVaultWithRecoveryKey(key)
      setPrivateBookmarks(bookmarks)
      setRecoveryKeyInput('')
      setUnlockMode('password')
      setLoginAttempts(0)
      onUnlock()
      touchVaultSession()
      showFeedback('Vault unlocked with recovery key')
      await clearRestoreHint()
    } catch (e: any) {
      if (e?.message === 'Incorrect recovery key') {
        showFeedback('Incorrect recovery key', true)
      } else if (typeof e?.message === 'string' && e.message.includes('No recovery key')) {
        showFeedback('This vault was created without a recovery key.', true)
      } else {
        showFeedback('Could not unlock with recovery key.', true)
      }
    } finally {
      setIsRecoveryUnlocking(false)
    }
  }

  const handleLock = () => {
    lockEverything()
  }

//#endregion

//#region ── Password setup / change ─────

  const handleSetupPassword = async () => {
    if (newPassword.length < 8) return showFeedback('Password must be at least 8 characters', true)
    if (newPassword !== confirmPassword) return showFeedback('Passwords do not match', true)

    try {
      const generatedRecoveryKey = await initializeVaultWithRecovery(newPassword)
      // A freshly-created empty vault counts as "backed up" so the banner
      // doesn't nag the user about a vault that has nothing in it yet.
      const now = Date.now()
      await browserApi.storage.local.set({
        [VAULT_LAST_CHANGE_KEY]: now,
        [VAULT_LAST_BACKUP_AT_KEY]: now,
        [VAULT_LAST_BACKUP_COUNT_KEY]: 0,
        [VAULT_LAST_BACKUP_KIND_KEY]: 'encrypted',
      })
      setRecoveryKeyVariant('setup')
      setRecoveryKey(generatedRecoveryKey)
      setHasPassword(true)
      setIsSettingUp(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      console.error('Vault initialization failed:', e)
      showFeedback('Failed to initialize vault. See console for details.', true)
    }
  }

  const handleRecoveryKeyAcknowledged = () => {
    const wasPasswordChange = recoveryKeyVariant === 'change'
    setRecoveryKey(null)
    showFeedback(
      wasPasswordChange
        ? 'Password updated. Recovery key rotated.'
        : 'Vault created. Store your recovery key somewhere safe.'
    )

    // Password rotation invalidates every backup the user has made so far:
    // those files are still encrypted under the OLD password. This is worth
    // a banner immediately (no waiting) because if the user forgets the old
    // password before making a fresh backup, those backups become unopenable.
    if (wasPasswordChange && onNotify) {
      onNotify({
        title: 'Existing backups use the old password',
        message:
          'Your vault password and recovery key were just rotated. Backup files you exported before now still use the old password — export a fresh copy while it\'s fresh in your mind.',
        variant: 'warning',
        icon: '⚠',
        actionLabel: 'Back up now',
        onAction: () => setHintModalMode('encrypted'),
      })
    }
  }

  const handleChangePassword = async () => {
    if (changeNewPassword.length < 8) {
      return showFeedback('New password must be at least 8 characters', true)
    }
    if (changeNewPassword !== changeConfirmPassword) {
      return showFeedback('New passwords do not match', true)
    }

    if (changeAuthMode === 'password' && !changeCurrentPassword) {
      return showFeedback('Enter your current password', true)
    }
    if (changeAuthMode === 'recovery' && !changeRecoveryKey.trim()) {
      return showFeedback('Enter your recovery key', true)
    }

    setIsChangingPassword(true)
    try {
      let newRecoveryKey: string

      if (changeAuthMode === 'password') {
        newRecoveryKey = await resetPasswordWithCurrentPassword(
          changeCurrentPassword,
          changeNewPassword
        )
      } else {
        newRecoveryKey = await resetPasswordWithRecoveryKey(
          changeRecoveryKey.trim(),
          changeNewPassword
        )
      }

      setChangeCurrentPassword('')
      setChangeRecoveryKey('')
      setChangeNewPassword('')
      setChangeConfirmPassword('')

      setRecoveryKeyVariant('change')
      setRecoveryKey(newRecoveryKey)

      touchVaultSession()
    } catch (e: any) {
      if (e?.message === 'Incorrect current password') {
        showFeedback('Current password is incorrect', true)
      } else if (e?.message === 'Incorrect recovery key') {
        showFeedback('Recovery key is incorrect', true)
      } else if (typeof e?.message === 'string' && e.message.includes('No recovery key')) {
        showFeedback('This vault was created without a recovery key.', true)
      } else {
        console.error('Password change failed:', e)
        showFeedback('Failed to change password. See console for details.', true)
      }
    } finally {
      setIsChangingPassword(false)
    }
  }
//#endregion

//#region ─── Backup / restore ─────

  const handleExportEncrypted = () => {
    setHintModalMode('encrypted')
  }

  const handleExportPlaintext = () => {
    if (!isUnlocked) {
      showFeedback('Unlock the vault before exporting a plaintext backup', true)
      return
    }

    setPendingConfirm({
      title: 'Export Plaintext Backup?',
      subtitle: 'The file will contain every private bookmark in clear text',
      variant: 'danger',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{
            padding: '12px 14px',
            border: `1px solid ${YORHA.rust}`,
            background: YORHA.bgPanel,
          }}>
            <div style={{
              fontSize: '11px', color: YORHA.rust, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px',
            }}>
              ⚠ Anyone who opens this file can read every bookmark
            </div>
            <p style={{ margin: 0, color: YORHA.dim }}>
              This is a deliberate escape hatch from the vault. It defeats the entire point of
              encryption if the file leaks. Only proceed if you understand the risk and will
              store the file somewhere secure (e.g. an encrypted disk image).
            </p>
          </div>
        </div>
      ),
      confirmLabel: 'Export Anyway',
      onConfirm: () => {
        setPendingConfirm(null)
        setHintModalMode('plaintext')
      },
      onCancel: () => setPendingConfirm(null),
    })
  }

  const handleBackupHintConfirm = async (hint: string | undefined) => {
    const mode = hintModalMode
    if (!mode) return
    try {
      if (mode === 'encrypted') {
        const envelope = await exportEncryptedBackup(hint)
        downloadJson(suggestedBackupFilename('encrypted'), envelope)
        showFeedback(hint ? 'Encrypted backup downloaded (with hint)' : 'Encrypted backup downloaded')
      } else {
        const envelope = await exportPlaintextBackup(hint)
        downloadJson(suggestedBackupFilename('plaintext'), envelope)
        showFeedback('Plaintext backup downloaded — store it securely')
      }

      // Record what the user just backed up so the staleness check can see it.
      await browserApi.storage.local.set({
        [VAULT_LAST_BACKUP_AT_KEY]:    Date.now(),
        [VAULT_LAST_BACKUP_COUNT_KEY]: privateBookmarks.length,
        [VAULT_LAST_BACKUP_KIND_KEY]:  mode,
      })

      setHintModalMode(null)
    } catch (e: any) {
      console.error('Backup failed:', e)
      showFeedback(e?.message || 'Failed to export backup', true)
    }
  }

  /**
   * Apply a parsed encrypted-backup envelope under a credential the vault layer
   * will re-verify. Called by the credential modal on submit; a wrong password
   * or recovery key makes restoreEncryptedBackup throw before anything in
   * storage is touched, and we surface that error in the modal so the user can
   * try again.
   *
   * The hint persisted here mirrors what `describeBackup` reported for the file:
   * it lives in browser storage so a still-locked user sees it on the unlock
   * screen after the restore swaps in a vault whose password they may not have
   * typed recently.
   */
  const applyEncryptedRestore = async (credential: BackupCredential) => {
    if (!pendingRestoreEnvelope) throw new Error('No backup is staged for restore')
    const { envelope, hint } = pendingRestoreEnvelope

    await restoreEncryptedBackup(envelope, credential)

    // Only now that the swap succeeded do we persist the hint (if any).
    if (hint) {
      const savedAt = Date.now()
      await browserApi.storage.local.set({
        [WISP_RESTORE_HINT_KEY]: { hint, savedAt },
      })
      setRestoreHint({ hint, savedAt })
    } else {
      await clearRestoreHint()
    }

    setPendingRestoreEnvelope(null)
    setPrivateBookmarks([])
    setHasPassword(await hasPrivatePassword())
    onLock()
    showFeedback('Encrypted backup restored. Unlock with the backup\'s password.')
  }

  const handleRestoreBackup = async () => {
    let parsed: unknown
    try {
      parsed = await pickJsonFile()
    } catch (e: any) {
      showFeedback(e?.message || 'Could not read backup file', true)
      return
    }

    const info = describeBackup(parsed)
    if (info.kind === 'unknown') {
      showFeedback('That file is not a Recall vault backup', true)
      return
    }

    if (info.kind === 'encrypted') {
      const when = new Date(info.exportedAt).toLocaleString()

      setPendingConfirm({
        title: 'Restore Encrypted Backup?',
        subtitle: `Exported ${when}`,
        variant: 'warning',
        body: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0 }}>
              This will <strong style={{ color: YORHA.ink }}>REPLACE</strong> the current vault
              storage. The current vault password and recovery key will be overwritten by the
              ones in the backup.
            </p>
            <p style={{ margin: 0 }}>
              You'll be asked for <strong style={{ color: YORHA.ink }}>this backup's</strong> password
              or its recovery key before anything is replaced — 
              so a backup you can't open can't overwrite a vault you can
            </p>

            {info.hint && (
              <div style={{
                padding: '12px 14px',
                border: `1px solid ${YORHA.amber}`,
                background: YORHA.bgPanel,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px',
                }}>
                  <KeyIcon size={12} />
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: YORHA.amber,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    Hint stored in this backup
                  </span>
                </div>
                <p style={{
                  margin: 0, fontSize: '13px', color: YORHA.ink,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {info.hint}
                </p>
              </div>
            )}
          </div>
        ),
        confirmLabel: 'Continue',
        onConfirm: () => {
          setPendingConfirm(null)
          setPendingRestoreEnvelope({
            envelope: parsed,
            hint: info.hint,
            exportedAt: info.exportedAt,
          })
        },
        onCancel: () => setPendingConfirm(null),
      })
      return
    }

    if (!isUnlocked) {
      showFeedback('Unlock the vault before restoring a plaintext backup', true)
      return
    }

    const when = new Date(info.exportedAt).toLocaleString()

    const doRestore = async (replace: boolean) => {
      setPendingConfirm(null)
      try {
        const { added, skipped } = await restorePlaintextBackup(parsed, { replace })
        await loadPrivateBookmarks()
        await loadAllBookmarks()
        touchVaultSession()
        // A restore is an addition to the vault's content — it counts as change.
        await browserApi.storage.local.set({ [VAULT_LAST_CHANGE_KEY]: Date.now() })
        showFeedback(`Restored ${added} entries${skipped ? ` (${skipped} skipped)` : ''}`)
      } catch (e: any) {
        console.error('Plaintext restore failed:', e)
        showFeedback(e?.message || 'Failed to restore plaintext backup', true)
      }
    }

    setPendingConfirm({
      title: 'Restore Plaintext Backup?',
      subtitle: `Exported ${when} · ${info.count} entr${info.count === 1 ? 'y' : 'ies'}`,
      variant: 'warning',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {info.hint && (
            <div style={{
              padding: '12px 14px',
              border: `1px solid ${YORHA.amber}`,
              background: YORHA.bgPanel,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px',
              }}>
                <KeyIcon size={12} />
                <span style={{
                  fontSize: '10px', fontWeight: 700, color: YORHA.amber,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  Hint stored in this backup
                </span>
              </div>
              <p style={{
                margin: 0, fontSize: '13px', color: YORHA.ink,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {info.hint}
              </p>
            </div>
          )}

          <p style={{ margin: 0 }}>
            Choose what to do with the entries in this backup:
          </p>

          <ul style={{
            margin: 0, paddingLeft: '18px',
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            <li>
              <strong style={{ color: YORHA.ink }}>Replace</strong> — discard the current vault
              contents and use only the backup.
            </li>
            <li>
              <strong style={{ color: YORHA.ink }}>Append</strong> — merge the backup into the
              current vault. Entries with a URL that already exists are skipped.
            </li>
          </ul>
        </div>
      ),
      confirmLabel: 'Replace',
      extraAction: {
        label: 'Append',
        onClick: () => doRestore(false),
      },
      onConfirm: () => doRestore(true),
      onCancel: () => setPendingConfirm(null),
    })
  }

//#endregion

//#region ─── Settings handlers ──────

  const handleMaxAttemptsChange = async (attempts: number) => {
    setMaxLoginAttempts(attempts)
    await browserApi.storage.local.set({ wisp_private_max_attempts: attempts })
    showFeedback(`Max attempts set to ${attempts}`)
  }

  const toggleAutoLockBlur = async () => {
    const val = !autoLockOnBlur
    setAutoLockOnBlur(val)
    await browserApi.storage.local.set({ wisp_private_auto_lock_blur: val })
  }

  const toggleBlurDomains = async () => {
    const val = !blurDomains
    setBlurDomains(val)
    await browserApi.storage.local.set({ wisp_private_blur_domains: val })
  }

  const toggleDomainAutoAdd = async () => {
    const val = !domainAutoAdd
    setDomainAutoAdd(val)
    await browserApi.storage.local.set({ wisp_private_domain_auto_add: val })
    showFeedback(val ? 'Domain auto-add enabled' : 'Domain auto-add disabled')
  }

  const addDomainToAutoAdd = async () => {
    const domain = newDomainInput.trim().toLowerCase()
    if (!domain) return showFeedback('Please enter a domain', true)
    if (domainAutoAddList.includes(domain)) return showFeedback('Domain already in list', true)
    const newList = [...domainAutoAddList, domain]
    setDomainAutoAddList(newList)
    setNewDomainInput('')
    await browserApi.storage.local.set({ wisp_private_domain_auto_add_list: newList })
    showFeedback(`Added ${domain} to auto-add list`)
  }

  const removeDomainFromAutoAdd = async (domain: string) => {
    const newList = domainAutoAddList.filter(d => d !== domain)
    setDomainAutoAddList(newList)
    await browserApi.storage.local.set({ wisp_private_domain_auto_add_list: newList })
  }

  const autoAddDomainsToVault = async () => {
    if (domainAutoAddList.length === 0) return showFeedback('No domains in auto-add list', true)
    if (!isUnlocked) return showFeedback('Please unlock the vault first', true)

    const privateIds = new Set(privateBookmarks.map(b => b.id))
    const toHide: { id: string; url: string; title: string; dateAdded?: number }[] = []

    for (const bookmark of allBookmarks) {
      if (privateIds.has(bookmark.id)) continue
      const domain = bookmark.domain || (() => { try { return new URL(bookmark.url).hostname.replace('www.', '') } catch { return '' } })()
      if (domainAutoAddList.some(d => domain.includes(d) || d.includes(domain))) {
        toHide.push({ id: bookmark.id, url: bookmark.url, title: bookmark.title, dateAdded: undefined })
      }
    }

    if (toHide.length === 0) return showFeedback('No matching bookmarks found')

    await hideBookmarksToVault(toHide)
    await loadPrivateBookmarks()
    await loadAllBookmarks()
    touchVaultSession()
    // Additions to the vault — bump the change timestamp so the banner can fire.
    await browserApi.storage.local.set({ [VAULT_LAST_CHANGE_KEY]: Date.now() })
    showFeedback(`Hid ${toHide.length} bookmarks to vault`)
  }

  // ─── Picker: move selected to vault ────────────────────────────────────────

  const handlePickerConfirm = async (ids: string[]) => {
    const idSet = new Set(ids)
    const toHide = allBookmarks
      .filter(b => idSet.has(b.id))
      .map(b => ({ id: b.id, url: b.url, title: b.title, dateAdded: undefined }))

    if (toHide.length === 0) {
      showFeedback('No matching bookmarks found', true)
      setShowPicker(false)
      return
    }

    try {
      await hideBookmarksToVault(toHide)
      await loadPrivateBookmarks()
      await loadAllBookmarks()
      touchVaultSession()
      // Additions — record the change time for the backup banner.
      await browserApi.storage.local.set({ [VAULT_LAST_CHANGE_KEY]: Date.now() })
      showFeedback(`Moved ${toHide.length} bookmark${toHide.length === 1 ? '' : 's'} to vault`)
      setShowPicker(false)
    } catch (err) {
      console.error('Failed to move bookmarks to vault:', err)
      showFeedback('Failed to move bookmarks. See console for details.', true)
    }
  }

  // ─── Restore / permanently delete ─────────────────────────────────────────

  const restoreBookmark = async (id: string) => {
    await restoreBookmarkFromVault(id)
    await loadPrivateBookmarks()
    await loadAllBookmarks()
    touchVaultSession()
    // Restoring OUT of the vault is a deletion from the vault's perspective —
    // the backup still contains it, so we do NOT bump the change timestamp.
    showFeedback('Bookmark restored to browser tree')
  }

  const removeBookmark = (id: string) => {
    const b = privateBookmarks.find(x => x.id === id)
    if (!b) return
    setPendingDelete(b)
  }

  const confirmRemoveBookmark = async () => {
    if (!pendingDelete) return
    try {
      await removeFromVaultPermanently(pendingDelete.id)
      await loadPrivateBookmarks()
      touchVaultSession()
      // Deletion — the backup is a superset of what remains, so nothing is at
      // risk from the backup's perspective. Don't bump the change timestamp.
      showFeedback('Removed from vault permanently')
    } catch (e) {
      console.error('Failed to delete bookmark:', e)
      showFeedback('Failed to delete bookmark. See console for details.', true)
    } finally {
      setPendingDelete(null)
    }
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  const handleResetVault = () => {
    setPendingConfirm({
      title: 'Reset Vault?',
      subtitle: 'This cannot be undone',
      variant: 'danger',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: 0 }}>
            This removes the vault password, the recovery key, and
            {' '}<strong style={{ color: YORHA.ink }}>deletes ALL encrypted private bookmarks</strong>.
          </p>
          <p style={{ margin: 0 }}>
            There is no backup, no trash, and no undo. The bookmarks are not returned to the
            browser tree — they are gone.
          </p>
        </div>
      ),
      confirmLabel: 'Reset & Delete All',
      onConfirm: async () => {
        setPendingConfirm(null)
        await clearPrivatePassword()
        await browserApi.storage.local.remove([
          'wisp_vault_ciphertext',
          'wisp_vault_iv',
          'wisp_private_salt',
          'wisp_vault_wrapped_key_password',
          'wisp_vault_wrapped_key_password_iv',
          'wisp_vault_wrapped_key_recovery',
          'wisp_vault_wrapped_key_recovery_iv',
          'wisp_recovery_salt',
          // Clear backup-tracking so a new vault starts with a clean slate.
          VAULT_LAST_CHANGE_KEY,
          VAULT_LAST_BACKUP_AT_KEY,
          VAULT_LAST_BACKUP_COUNT_KEY,
          VAULT_LAST_BACKUP_KIND_KEY,
        ])
        await clearRestoreHint()
        lockVault()
        setHasPassword(false)
        setPrivateBookmarks([])
        onLock()
        showFeedback('Vault reset. All private bookmarks deleted.')
      },
      onCancel: () => setPendingConfirm(null),
    })
  }

 //#endregion

//#region ─── Compute picker candidates (available bookmarks) ──────

  const pickerCandidates = useMemo(() => {
    const privateIds = new Set(privateBookmarks.map(b => b.id))
    const privateUrls = new Set(privateBookmarks.map(b => b.url))
    return allBookmarks.filter(b =>
      !privateIds.has(b.id) && !privateUrls.has(b.url)
    )
  }, [allBookmarks, privateBookmarks])

  const recoveryModal = (
    <RecoveryKeyModal
      recoveryKey={recoveryKey}
      onAcknowledge={handleRecoveryKeyAcknowledged}
      colors={YORHA}
      theme={theme}
      variant={recoveryKeyVariant}
    />
  )

  const confirmModal = (
    <ConfirmModal
      isOpen={pendingConfirm !== null}
      title={pendingConfirm?.title ?? ''}
      subtitle={pendingConfirm?.subtitle}
      confirmLabel={pendingConfirm?.confirmLabel ?? ''}
      cancelLabel={pendingConfirm?.cancelLabel}
      variant={pendingConfirm?.variant}
      extraAction={pendingConfirm?.extraAction}
      onConfirm={() => pendingConfirm?.onConfirm()}
      onCancel={() => pendingConfirm?.onCancel() ?? setPendingConfirm(null)}
      theme={theme}
      colors={YORHA}
    >
      {pendingConfirm?.body}
    </ConfirmModal>
  )

  // The credential prompt for restoring an encrypted backup. Rendered in every
  // branch (like the confirm and recovery modals) so it can't be dismissed by a
  // branch switch mid-restore.
  const restoreCredentialModal = (
    <RestoreCredentialModal
      isOpen={pendingRestoreEnvelope !== null}
      hint={pendingRestoreEnvelope?.hint}
      exportedAt={pendingRestoreEnvelope?.exportedAt ?? Date.now()}
      onCancel={() => setPendingRestoreEnvelope(null)}
      onSubmit={applyEncryptedRestore}
      theme={theme}
      colors={YORHA}
    />
  )

  if (isLoading) {
    return (
      <>
        {recoveryModal}
        {confirmModal}
        {restoreCredentialModal}
        <div style={{ textAlign: 'center', padding: '40px', color: YORHA.dim, fontFamily: YORHA.mono }}>LOADING...</div>
      </>
    )
  }

//#endregion

//#region ─── Setup Mode ──────
  if (!hasPassword) {
    return (
      <>
        {recoveryModal}
        {confirmModal}
        {restoreCredentialModal}
        <div style={{
          maxWidth: '440px', margin: '60px auto', padding: '40px',
          background: YORHA.bg, border: `1px solid ${YORHA.line}`,
          textAlign: 'center', fontFamily: YORHA.mono,
          boxShadow: "8px 8px 0 rgba(22,21,17,0.08)",
          position: "relative", overflow: "hidden"
        }}>
          <div style={{ position: "absolute", top: -50, left: "50%", transform: "translateX(-50%)", width: 200, height: 200, background: YORHA.ink, filter: "blur(80px)", opacity: 0.06, zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 20px", border: `1px solid ${YORHA.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: YORHA.ink }}>
              <ShieldIcon size={32} />
            </div>
            <h2 style={{ color: YORHA.ink, marginBottom: '8px', fontSize: "18px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Secure Your Bookmarks</h2>
            <p style={{ color: YORHA.dim, fontSize: '12px', marginBottom: '32px', lineHeight: 1.6, letterSpacing: "0.02em" }}>
              Set a master password. Private bookmarks are removed from the browser tree and encrypted with AES-256-GCM.
              You'll be shown a <strong style={{ color: YORHA.ink }}>recovery key</strong> once — save it somewhere safe. If you
              lose both the password and the recovery key, the data is gone.
            </p>

            {!isSettingUp ? (
              <button onClick={() => setIsSettingUp(true)} style={{
                width: "100%", padding: '12px',
                border: `1px solid ${YORHA.ink}`,
                background: YORHA.ink, color: YORHA.bg,
                fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                Create Password
              </button>
            ) : (
              <div style={{ textAlign: "left" }}>
                <input
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: `1px solid ${YORHA.line}`,
                    background: YORHA.bg, color: YORHA.ink,
                    fontSize: '13px', outline: 'none', boxSizing: 'border-box', marginBottom: '8px',
                    fontFamily: YORHA.mono, letterSpacing: "0.02em",
                  }}
                />
                {newPassword && (
                  <div style={{ display: "flex", gap: "4px", marginBottom: "16px", alignItems: "center" }}>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} style={{
                        height: 3, flex: 1,
                        background: i < calculatePasswordStrength(newPassword) ? STRENGTH_COLORS[calculatePasswordStrength(newPassword)] : YORHA.lineFaint,
                        transition: "all 0.3s"
                      }} />
                    ))}
                    <span style={{ fontSize: "10px", marginLeft: "8px", width: "60px", color: STRENGTH_COLORS[calculatePasswordStrength(newPassword)], fontFamily: YORHA.mono, letterSpacing: "0.02em" }}>
                      {STRENGTH_LABELS[calculatePasswordStrength(newPassword)]}
                    </span>
                  </div>
                )}
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: `1px solid ${YORHA.line}`,
                    background: YORHA.bg, color: YORHA.ink,
                    fontSize: '13px', outline: 'none', boxSizing: 'border-box', marginBottom: '24px',
                    fontFamily: YORHA.mono, letterSpacing: "0.02em",
                  }}
                />
                {error && <div style={{ color: YORHA.rust, fontSize: '12px', marginBottom: '16px', textAlign: "center", fontFamily: YORHA.mono, letterSpacing: "0.02em" }}>{error}</div>}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setIsSettingUp(false)} style={{
                    flex: 1, padding: '10px',
                    border: `1px solid ${YORHA.lineFaint}`,
                    background: 'transparent', color: YORHA.dim,
                    fontSize: '10px', cursor: 'pointer',
                    fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>Cancel</button>
                  <button onClick={handleSetupPassword} style={{
                    flex: 2, padding: '10px',
                    border: `1px solid ${YORHA.ink}`,
                    background: YORHA.ink, color: YORHA.bg,
                    fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                    fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>Save Password</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }
//#endregion

//#region ─── Locked State ───────
  if (!isUnlocked) {
    return (
      <>
        {recoveryModal}
        {confirmModal}
        {restoreCredentialModal}
        <div style={{
          maxWidth: '400px', margin: '60px auto', padding: '40px',
          background: YORHA.bg, border: `1px solid ${YORHA.line}`,
          textAlign: 'center', fontFamily: YORHA.mono,
          boxShadow: "8px 8px 0 rgba(22,21,17,0.08)",
        }}>
          <div style={{ width: 64, height: 64, margin: "0 auto 20px", border: `1px solid ${YORHA.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: YORHA.ink }}>
            <LockIcon size={32} />
          </div>
          <h2 style={{ color: YORHA.ink, marginBottom: '8px', fontSize: "18px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Vault Locked</h2>
          <p style={{ color: YORHA.dim, fontSize: '12px', marginBottom: '20px', letterSpacing: "0.02em" }}>
            {unlockMode === 'password'
              ? 'Enter your master password to decrypt bookmarks.'
              : 'Enter the recovery key you saved during setup.'}
          </p>

          <div style={{
            display: 'flex',
            border: `1px solid ${YORHA.line}`,
            marginBottom: '20px',
          }}>
            <button
              onClick={() => { setUnlockMode('password'); setRecoveryKeyInput('') }}
              disabled={lockoutTime !== null}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: 'none',
                borderRight: `1px solid ${YORHA.line}`,
                background: unlockMode === 'password' ? YORHA.ink : 'transparent',
                color: unlockMode === 'password' ? YORHA.bg : YORHA.dim,
                fontSize: '10px', fontWeight: 700,
                cursor: lockoutTime !== null ? 'default' : 'pointer',
                fontFamily: YORHA.mono,
                letterSpacing: "0.08em", textTransform: "uppercase",
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                opacity: lockoutTime !== null ? 0.5 : 1,
              }}
            >
              <LockIcon size={11} /> Password
            </button>
            <button
              onClick={() => { setUnlockMode('recovery'); setPassword('') }}
              disabled={lockoutTime !== null}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: 'none',
                background: unlockMode === 'recovery' ? YORHA.ink : 'transparent',
                color: unlockMode === 'recovery' ? YORHA.bg : YORHA.dim,
                fontSize: '10px', fontWeight: 700,
                cursor: lockoutTime !== null ? 'default' : 'pointer',
                fontFamily: YORHA.mono,
                letterSpacing: "0.08em", textTransform: "uppercase",
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                opacity: lockoutTime !== null ? 0.5 : 1,
              }}
            >
              <KeyIcon size={11} /> Recovery Key
            </button>
          </div>

          {unlockMode === 'password' ? (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              disabled={lockoutTime !== null}
              style={{
                width: '100%', padding: '12px 16px',
                border: `1px solid ${YORHA.line}`,
                background: YORHA.bg, color: YORHA.ink,
                fontSize: '13px', outline: 'none', marginBottom: '16px', boxSizing: 'border-box',
                fontFamily: YORHA.mono, letterSpacing: "0.02em",
                opacity: lockoutTime ? 0.5 : 1
              }}
            />
          ) : (
            <input
              type="text"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX"
              value={recoveryKeyInput}
              onChange={e => setRecoveryKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRecoveryUnlock()}
              disabled={isRecoveryUnlocking || lockoutTime !== null}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', padding: '12px 16px',
                border: `1px solid ${YORHA.line}`,
                background: YORHA.bg, color: YORHA.ink,
                fontSize: '12px', outline: 'none', marginBottom: '16px', boxSizing: 'border-box',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                opacity: (isRecoveryUnlocking || lockoutTime) ? 0.5 : 1
              }}
            />
          )}

          {error && <div style={{ color: YORHA.rust, fontSize: '12px', marginBottom: '16px', fontFamily: YORHA.mono, letterSpacing: "0.02em" }}>{error}</div>}

          {unlockMode === 'password' ? (
            <button
              onClick={handleUnlock}
              disabled={lockoutTime !== null}
              style={{
                width: '100%', padding: '12px',
                border: `1px solid ${lockoutTime ? YORHA.dim : YORHA.ink}`,
                background: lockoutTime ? YORHA.dim : YORHA.ink,
                color: YORHA.bg,
                fontSize: '11px', fontWeight: 700, cursor: lockoutTime ? 'not-allowed' : 'pointer',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              }}
            >
              {lockoutTime ? "Temporarily Locked" : "Unlock Vault"}
            </button>
          ) : (
            <button
              onClick={handleRecoveryUnlock}
              disabled={isRecoveryUnlocking || lockoutTime !== null}
              style={{
                width: '100%', padding: '12px',
                border: `1px solid ${(isRecoveryUnlocking || lockoutTime) ? YORHA.dim : YORHA.ink}`,
                background: (isRecoveryUnlocking || lockoutTime) ? YORHA.dim : YORHA.ink,
                color: YORHA.bg,
                fontSize: '11px', fontWeight: 700,
                cursor: (isRecoveryUnlocking || lockoutTime) ? 'not-allowed' : 'pointer',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              }}
            >
              {isRecoveryUnlocking
                ? "Unlocking…"
                : lockoutTime
                  ? "Temporarily Locked"
                  : "Unlock with Recovery Key"}
            </button>
          )}

          {restoreHint && (
            <div style={{
              marginTop: "20px",
              padding: "14px",
              border: `1px solid ${YORHA.amber}`,
              background: YORHA.bgPanel,
              textAlign: "left",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <KeyIcon size={12} />
                <span style={{
                  fontSize: "10px", fontWeight: 700, color: YORHA.amber,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  Hint from your restored backup
                </span>
              </div>
              <p style={{
                margin: 0, fontSize: "13px", color: YORHA.ink,
                lineHeight: 1.5, letterSpacing: "0.02em",
                fontFamily: YORHA.mono,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {restoreHint.hint}
              </p>
              <p style={{
                margin: "8px 0 0", fontSize: "10px", color: YORHA.dimmer,
                letterSpacing: "0.02em", lineHeight: 1.5,
              }}>
                You saved this when you created the backup. It will disappear once you unlock the vault.
              </p>
              <button
                onClick={clearRestoreHint}
                style={{
                  marginTop: "10px",
                  background: "none", border: "none", padding: 0,
                  color: YORHA.dimmer, fontSize: "10px",
                  fontFamily: YORHA.mono, letterSpacing: "0.06em",
                  textTransform: "uppercase", cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Dismiss hint
              </button>
            </div>
          )}

          {unlockMode === 'password' && (
            <div style={{ marginTop: "24px", padding: "14px", border: `1px solid ${YORHA.lineFaint}`, background: YORHA.bgPanel, textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <AlertTriangleIcon size={12} />
                <span style={{ fontSize: "10px", fontWeight: 700, color: YORHA.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>Forgot your password?</span>
              </div>
              <p style={{ margin: 0, fontSize: "10px", color: YORHA.dim, lineHeight: 1.5, letterSpacing: "0.02em" }}>
                Switch to <strong style={{ color: YORHA.ink }}>Recovery Key</strong> above and paste the key you saved
                during setup. If you've lost both, the encrypted bookmarks cannot be recovered.
              </p>
              <button onClick={handleResetVault} style={{
                marginTop: "10px", width: "100%", padding: "8px",
                border: `1px solid ${YORHA.rust}`,
                background: 'transparent', color: YORHA.rust,
                fontSize: '10px', cursor: 'pointer',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                Reset Vault (Delete All)
              </button>
            </div>
          )}

          {unlockMode === 'recovery' && (
            <div style={{ marginTop: "24px", padding: "14px", border: `1px solid ${YORHA.lineFaint}`, background: YORHA.bgPanel, textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <KeyIcon size={12} />
                <span style={{ fontSize: "10px", fontWeight: 700, color: YORHA.dim, letterSpacing: "0.06em", textTransform: "uppercase" }}>About the recovery key</span>
              </div>
              <p style={{ margin: 0, fontSize: "10px", color: YORHA.dim, lineHeight: 1.5, letterSpacing: "0.02em" }}>
                Format is groups of 5 characters separated by dashes. Case-insensitive — paste it exactly as shown.
                It was displayed once when you first set up the vault.
              </p>
            </div>
          )}
        </div>
      </>
    )
  }
//#endregion

//#region ─── Unlocked State ────────
  return (
    <>
      {recoveryModal}
      {confirmModal}
      {restoreCredentialModal}
      <div style={{ fontFamily: YORHA.mono }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '24px', padding: '18px 24px',
          background: YORHA.bgPanel, border: `1px solid ${YORHA.line}`,
          boxShadow: "4px 4px 0 rgba(22,21,17,0.06)",
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ width: 40, height: 40, border: `1px solid ${YORHA.line}`, color: YORHA.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <UnlockIcon size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, color: YORHA.ink, fontSize: "15px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Private Vault</h2>
              <p style={{ margin: "2px 0 0", color: YORHA.dim, fontSize: "10px", letterSpacing: "0.04em" }}>
                {privateBookmarks.length} HIDDEN ITEM{privateBookmarks.length === 1 ? '' : 'S'}
                {domainAutoAdd && domainAutoAddList.length > 0 && ` • ${domainAutoAddList.length} DOMAINS TRACKED`}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setShowPicker(true)} style={{
              padding: '8px 16px', border: `1px solid ${YORHA.ink}`,
              background: YORHA.ink, color: YORHA.bg,
              fontSize: '10px', fontWeight: 700, cursor: 'pointer',
              fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              <PlusIcon size={13} /> Add Bookmarks
            </button>
            <button onClick={() => setShowPasswordSettings(!showPasswordSettings)} style={{
              padding: '8px 16px', border: `1px solid ${YORHA.line}`,
              background: showPasswordSettings ? YORHA.bg : 'transparent',
              color: YORHA.ink, fontSize: '10px', cursor: 'pointer',
              fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              <SettingsIcon size={14} /> Settings
            </button>
            <button onClick={handleLock} style={{
              padding: '8px 16px', border: `1px solid ${YORHA.ink}`,
              background: 'transparent', color: YORHA.ink,
              fontSize: '10px', fontWeight: 700, cursor: 'pointer',
              fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              <LockIcon size={14} /> Lock (Esc)
            </button>
          </div>
        </div>

        {success && <div style={{
          padding: "12px 16px",
          border: `1px solid ${YORHA.sage}`,
          background: YORHA.bgPanel,
          color: YORHA.sage, marginBottom: "20px", fontSize: "12px",
          display: "flex", alignItems: "center", fontFamily: YORHA.mono, letterSpacing: "0.02em"
        }}>✓ {success}</div>}
        {error && <div style={{
          padding: "12px 16px",
          border: `1px solid ${YORHA.rust}`,
          background: YORHA.bgPanel,
          color: YORHA.rust, marginBottom: "20px", fontSize: "12px",
          display: "flex", alignItems: "center", fontFamily: YORHA.mono, letterSpacing: "0.02em"
        }}>✕ {error}</div>}

        {/* ─── SETTINGS PANEL ──────────────────────────────────────────────────── */}
        {showPasswordSettings && (
          <div style={{
            marginBottom: '24px', padding: '24px',
            background: YORHA.bg, border: `1px solid ${YORHA.line}`,
          }}>
            <h3 style={{
              color: YORHA.ink,
              margin: '0 0 24px 0',
              fontSize: '15px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingBottom: '16px',
              borderBottom: `1px solid ${YORHA.lineFaint}`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              <SettingsIcon size={20} /> Settings
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>

              {/* SECURITY FEATURES */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <ShieldIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Security Features</h4>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', padding: '8px', fontFamily: YORHA.mono }}>
                    <input type="checkbox" checked={autoLockOnBlur} onChange={toggleAutoLockBlur} style={{ marginTop: '2px' }} />
                    <div>
                      <div style={{ fontSize: '12px', color: YORHA.ink, fontWeight: 600, letterSpacing: "0.02em" }}>Lock on tab switch</div>
                      <div style={{ fontSize: '10px', color: YORHA.dim, letterSpacing: "0.02em" }}>Instantly lock vault when you leave the page</div>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', padding: '8px', fontFamily: YORHA.mono }}>
                    <input type="checkbox" checked={blurDomains} onChange={toggleBlurDomains} style={{ marginTop: '2px' }} />
                    <div>
                      <div style={{ fontSize: '12px', color: YORHA.ink, fontWeight: 600, letterSpacing: "0.02em" }}>Blur URLs</div>
                      <div style={{ fontSize: '10px', color: YORHA.dim, letterSpacing: "0.02em" }}>Hide URLs until hovered</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* AUTO-LOCK */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <TimerIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Auto-Lock</h4>
                </div>
                <div style={{ fontSize: '11px', color: YORHA.dim, lineHeight: 1.5, letterSpacing: "0.02em" }}>
                  The vault automatically locks <strong style={{ color: YORHA.ink }}>5 minutes</strong> after your last interaction.
                  The timer resets on every unlock and every action inside the vault.
                </div>
              </div>

              {/* MAX ATTEMPTS */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <AlertTriangleIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Failed Attempts</h4>
                </div>

                <div style={{ fontSize: '10px', color: YORHA.dim, marginBottom: '12px', letterSpacing: "0.02em" }}>
                  Lock out after this many failed password attempts
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[3, 5, 10, 15].map(a => (
                    <button
                      key={a}
                      onClick={() => handleMaxAttemptsChange(a)}
                      style={{
                        padding: '6px 14px',
                        border: `2px solid ${maxLoginAttempts === a ? YORHA.ink : YORHA.lineFaint}`,
                        background: maxLoginAttempts === a ? YORHA.ink : 'transparent',
                        color: maxLoginAttempts === a ? YORHA.bg : YORHA.dim,
                        fontSize: '10px', fontWeight: maxLoginAttempts === a ? 700 : 400,
                        cursor: 'pointer',
                        fontFamily: YORHA.mono, letterSpacing: "0.04em",
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* CHANGE PASSWORD */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <LockIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Change Password</h4>
                </div>

                <div style={{ fontSize: '10px', color: YORHA.dim, marginBottom: '12px', letterSpacing: "0.02em", lineHeight: 1.5 }}>
                  Re-authenticate with your current password <em>or</em> recovery key, then set a new password.
                  A fresh recovery key will be issued — your old one becomes invalid.
                </div>

                <div style={{ display: 'flex', border: `1px solid ${YORHA.line}`, marginBottom: '12px' }}>
                  <button
                    onClick={() => { setChangeAuthMode('password'); setChangeRecoveryKey('') }}
                    disabled={isChangingPassword}
                    style={{
                      flex: 1, padding: '7px 10px', border: 'none',
                      borderRight: `1px solid ${YORHA.line}`,
                      background: changeAuthMode === 'password' ? YORHA.ink : 'transparent',
                      color: changeAuthMode === 'password' ? YORHA.bg : YORHA.dim,
                      fontSize: '10px', fontWeight: 700,
                      cursor: isChangingPassword ? 'default' : 'pointer',
                      fontFamily: YORHA.mono,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      opacity: isChangingPassword ? 0.5 : 1,
                    }}
                  >
                    Current Password
                  </button>
                  <button
                    onClick={() => { setChangeAuthMode('recovery'); setChangeCurrentPassword('') }}
                    disabled={isChangingPassword}
                    style={{
                      flex: 1, padding: '7px 10px', border: 'none',
                      background: changeAuthMode === 'recovery' ? YORHA.ink : 'transparent',
                      color: changeAuthMode === 'recovery' ? YORHA.bg : YORHA.dim,
                      fontSize: '10px', fontWeight: 700,
                      cursor: isChangingPassword ? 'default' : 'pointer',
                      fontFamily: YORHA.mono,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      opacity: isChangingPassword ? 0.5 : 1,
                    }}
                  >
                    Recovery Key
                  </button>
                </div>

                {changeAuthMode === 'password' ? (
                  <input
                    type="password"
                    placeholder="Current password"
                    value={changeCurrentPassword}
                    onChange={e => setChangeCurrentPassword(e.target.value)}
                    disabled={isChangingPassword}
                    style={{
                      width: '100%', padding: '9px 12px',
                      border: `1px solid ${YORHA.line}`,
                      background: YORHA.bg, color: YORHA.ink,
                      fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                      fontFamily: YORHA.mono, letterSpacing: "0.02em",
                      marginBottom: '8px',
                      opacity: isChangingPassword ? 0.5 : 1,
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX"
                    value={changeRecoveryKey}
                    onChange={e => setChangeRecoveryKey(e.target.value)}
                    disabled={isChangingPassword}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{
                      width: '100%', padding: '9px 12px',
                      border: `1px solid ${YORHA.line}`,
                      background: YORHA.bg, color: YORHA.ink,
                      fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                      fontFamily: YORHA.mono, letterSpacing: "0.06em", textTransform: "uppercase",
                      marginBottom: '8px',
                      opacity: isChangingPassword ? 0.5 : 1,
                    }}
                  />
                )}

                <input
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={changeNewPassword}
                  onChange={e => setChangeNewPassword(e.target.value)}
                  disabled={isChangingPassword}
                  style={{
                    width: '100%', padding: '9px 12px',
                    border: `1px solid ${YORHA.line}`,
                    background: YORHA.bg, color: YORHA.ink,
                    fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                    fontFamily: YORHA.mono, letterSpacing: "0.02em",
                    marginBottom: '8px',
                    opacity: isChangingPassword ? 0.5 : 1,
                  }}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={changeConfirmPassword}
                  onChange={e => setChangeConfirmPassword(e.target.value)}
                  disabled={isChangingPassword}
                  style={{
                    width: '100%', padding: '9px 12px',
                    border: `1px solid ${YORHA.line}`,
                    background: YORHA.bg, color: YORHA.ink,
                    fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                    fontFamily: YORHA.mono, letterSpacing: "0.02em",
                    marginBottom: '10px',
                    opacity: isChangingPassword ? 0.5 : 1,
                  }}
                />

                <button
                  onClick={handleChangePassword}
                  disabled={isChangingPassword}
                  style={{
                    width: '100%', padding: '10px',
                    border: `1px solid ${isChangingPassword ? YORHA.dimmer : YORHA.ink}`,
                    background: isChangingPassword ? YORHA.dimmer : YORHA.ink,
                    color: YORHA.bg,
                    fontSize: '10px', fontWeight: 700,
                    cursor: isChangingPassword ? 'default' : 'pointer',
                    fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                    opacity: isChangingPassword ? 0.5 : 1,
                  }}
                >
                  {isChangingPassword ? 'Updating…' : 'Update Password & Rotate Recovery Key'}
                </button>
              </div>

              {/* BACKUP & RESTORE */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <DownloadIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Backup & Restore</h4>
                </div>

                <div style={{ fontSize: '10px', color: YORHA.dim, marginBottom: '12px', letterSpacing: "0.02em", lineHeight: 1.5 }}>
                  Encrypted backups contain only ciphertext and salts — safe to store anywhere.
                  Plaintext backups are readable by anyone who opens the file.
                </div>

                <button onClick={handleExportEncrypted} style={{
                  width: '100%', padding: '9px', marginBottom: '6px',
                  border: `1px solid ${YORHA.ink}`, background: YORHA.ink, color: YORHA.bg,
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <DownloadIcon size={12} /> Export Encrypted Backup
                </button>

                <button onClick={handleExportPlaintext} disabled={!isUnlocked} style={{
                  width: '100%', padding: '9px', marginBottom: '6px',
                  border: `1px solid ${YORHA.amber}`,
                  background: 'transparent', color: YORHA.amber,
                  fontSize: '10px', fontWeight: 700,
                  cursor: isUnlocked ? 'pointer' : 'default',
                  opacity: isUnlocked ? 1 : 0.5,
                  fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <AlertTriangleIcon size={12} /> Export Plaintext Backup…
                </button>

                <button onClick={handleRestoreBackup} style={{
                  width: '100%', padding: '9px',
                  border: `1px solid ${YORHA.line}`,
                  background: 'transparent', color: YORHA.ink,
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <UploadIcon size={12} /> Restore From Backup File…
                </button>
              </div>

              {/* DANGER ZONE */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.rust}55` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <TrashIcon size={16} />
                  <h4 style={{ color: YORHA.rust, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Danger Zone</h4>
                </div>
                <div style={{ fontSize: '10px', color: YORHA.dim, marginBottom: '12px', letterSpacing: "0.02em", lineHeight: 1.5 }}>
                  Wipe the password, the recovery key, and ALL encrypted private bookmarks. This cannot be undone and there is no backup.
                </div>
                <button onClick={handleResetVault} style={{
                  width: '100%', padding: '10px',
                  border: `1px solid ${YORHA.rust}`,
                  background: 'transparent', color: YORHA.rust,
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                }}>
                  Reset Vault & Delete All
                </button>
              </div>

              {/* DOMAIN AUTO-ADD */}
              <div style={{ padding: '16px', background: YORHA.bgPanel, border: `1px solid ${YORHA.lineFaint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <ShieldIcon size={16} />
                  <h4 style={{ color: YORHA.ink, margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Domain Hide List</h4>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', cursor: 'pointer', fontFamily: YORHA.mono }}>
                  <input type="checkbox" checked={domainAutoAdd} onChange={toggleDomainAutoAdd} />
                  <span style={{ fontSize: '12px', color: YORHA.ink, fontWeight: 600, letterSpacing: "0.02em" }}>Enable domain list</span>
                </label>

                {domainAutoAdd && (
                  <>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                      <input
                        type="text"
                        placeholder="e.g., facebook.com"
                        value={newDomainInput}
                        onChange={e => setNewDomainInput(e.target.value)}
                        style={{
                          flex: 1, padding: '8px 12px',
                          border: `1px solid ${YORHA.line}`,
                          background: YORHA.bg, color: YORHA.ink,
                          fontSize: '12px', outline: 'none',
                          fontFamily: YORHA.mono, letterSpacing: "0.02em",
                        }}
                      />
                      <button onClick={addDomainToAutoAdd} style={{
                        padding: '8px 16px', border: `1px solid ${YORHA.ink}`,
                        background: YORHA.ink, color: YORHA.bg,
                        fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                        fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                        whiteSpace: 'nowrap'
                      }}>Add</button>
                    </div>

                    <button onClick={autoAddDomainsToVault} style={{
                      width: '100%', padding: '8px',
                      border: `2px solid ${YORHA.ink}`,
                      background: 'transparent', color: YORHA.ink,
                      fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                      fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                      marginBottom: '12px',
                    }}>
                      Hide all matching bookmarks
                    </button>

                    {domainAutoAddList.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {domainAutoAddList.map(d => (
                          <span key={d} style={{
                            background: YORHA.bg, padding: '4px 10px', fontSize: '10px',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            border: `1px solid ${YORHA.lineFaint}`,
                            fontFamily: YORHA.mono, letterSpacing: "0.02em",
                          }}>
                            {d}
                            <button onClick={() => removeDomainFromAutoAdd(d)} style={{
                              background: 'none', border: 'none',
                              color: YORHA.rust, cursor: 'pointer',
                              fontSize: '12px', padding: '0 4px'
                            }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ─── GRID VIEW ─────────────────────────────────────────────────────────── */}
        {privateBookmarks.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            background: YORHA.bg, border: `1px solid ${YORHA.lineFaint}`,
          }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 16px", border: `1px solid ${YORHA.lineFaint}`, display: "flex", alignItems: "center", justifyContent: "center", color: YORHA.dimmer }}>
              <LockIcon size={24} />
            </div>
            <h3 style={{ color: YORHA.dim, fontSize: "14px", margin: "0 0 8px 0", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Vault is Empty</h3>
            <p style={{ fontSize: '11px', color: YORHA.dimmer, maxWidth: "320px", margin: "0 auto 20px", letterSpacing: "0.02em" }}>
              Click "Add Bookmarks" to select which items to move into the vault, or use the auto-add domains list.
            </p>
            <button
              onClick={() => setShowPicker(true)}
              disabled={pickerCandidates.length === 0}
              style={{
                padding: '10px 22px',
                border: `1px solid ${pickerCandidates.length === 0 ? YORHA.dimmer : YORHA.ink}`,
                background: pickerCandidates.length === 0 ? YORHA.dimmer : YORHA.ink,
                color: YORHA.bg,
                fontSize: '11px', fontWeight: 700,
                cursor: pickerCandidates.length === 0 ? 'default' : 'pointer',
                fontFamily: YORHA.mono, letterSpacing: "0.08em", textTransform: "uppercase",
                opacity: pickerCandidates.length === 0 ? 0.5 : 1,
              }}
            >
              {pickerCandidates.length === 0 ? 'No bookmarks available' : 'Add bookmarks to vault'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {privateBookmarks.map(b => (
              <div key={b.id} style={{
                background: YORHA.bg,
                border: `1px solid ${YORHA.lineFaint}`,
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                position: "relative",
                overflow: "hidden",
                fontFamily: YORHA.mono,
                transition: "transform 0.2s, box-shadow 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "4px 4px 0 rgba(22,21,17,0.06)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none"
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0,
                  width: "2px", height: "100%",
                  background: YORHA.ink, opacity: 0.3,
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{
                    color: YORHA.ink, fontSize: '13px', fontWeight: 700,
                    wordBreak: 'break-word', flex: 1, paddingRight: '12px',
                    lineHeight: 1.4, letterSpacing: "0.02em", textTransform: "uppercase",
                  }}>
                    {b.title || b.domain}
                  </span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => restoreBookmark(b.id)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${YORHA.lineFaint}`,
                        color: YORHA.dim, cursor: 'pointer', padding: '6px',
                        display: "flex", transition: "all 0.2s"
                      }}
                      title="Restore to browser tree"
                      onMouseEnter={e => {
                        e.currentTarget.style.color = YORHA.sage;
                        e.currentTarget.style.borderColor = YORHA.sage;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = YORHA.dim;
                        e.currentTarget.style.borderColor = YORHA.lineFaint;
                      }}
                    >
                      <RefreshIcon size={14} />
                    </button>
                    <button
                      onClick={() => removeBookmark(b.id)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${YORHA.lineFaint}`,
                        color: YORHA.dim, cursor: 'pointer', padding: '6px',
                        display: "flex", transition: "all 0.2s"
                      }}
                      title="Delete permanently"
                      onMouseEnter={e => {
                        e.currentTarget.style.color = YORHA.rust;
                        e.currentTarget.style.borderColor = YORHA.rust;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = YORHA.dim;
                        e.currentTarget.style.borderColor = YORHA.lineFaint;
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>

                <div style={{
                  color: YORHA.dim, fontSize: '11px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  filter: blurDomains ? "blur(4px)" : "none",
                  transition: "filter 0.3s", cursor: "default",
                  letterSpacing: "0.02em",
                }}
                onClick={e => {window.open(b.url,'_blank','noopener,noreferrer')}}
                onMouseEnter={e => { if (blurDomains) e.currentTarget.style.filter = "none" }}
                onMouseLeave={e => { if (blurDomains) e.currentTarget.style.filter = "blur(4px)" }}
                title={blurDomains ? "Hover to reveal URL" : ""}>
                  {b.url}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: "4px" }}>
                  <span style={{
                    border: `1px solid ${YORHA.lineFaint}`,
                    padding: '3px 8px', fontSize: '9px', fontWeight: 700,
                    letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "4px",
                    color: YORHA.dim, textTransform: "uppercase",
                  }}>
                    <EyeOffIcon size={10} /> Hidden
                  </span>
                  {domainAutoAddList.some(d => b.domain && b.domain.includes(d)) && (
                    <span style={{
                      border: `1px solid ${YORHA.sage}55`,
                      padding: '3px 8px', fontSize: '9px', fontWeight: 700,
                      color: YORHA.sage,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>
                      Auto
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── PICKER MODAL ──────────────────────────────────────────────────────── */}
        <BookmarkPickerModal
          isOpen={showPicker}
          bookmarks={pickerCandidates}
          onClose={() => setShowPicker(false)}
          onConfirm={handlePickerConfirm}
          theme={theme}
          colors={YORHA}
        />

        {/* ─── CONFIRM DELETE MODAL ──────────────────────────────────────────────── */}
        <ConfirmDeleteModal
          isOpen={pendingDelete !== null}
          bookmarkTitle={pendingDelete?.title || pendingDelete?.domain || ''}
          bookmarkUrl={pendingDelete?.url || ''}
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmRemoveBookmark}
          theme={theme}
          colors={YORHA}
        />

        {/* ─── BACKUP HINT MODAL ─────────────────────────────────────────────────── */}
        <BackupHintModal
          isOpen={hintModalMode !== null}
          mode={hintModalMode ?? 'encrypted'}
          onCancel={() => setHintModalMode(null)}
          onConfirm={handleBackupHintConfirm}
          theme={theme}
          colors={YORHA}
        />
      </div>
    </>
  )
}
//#endregion