export type LocalizedText = { en: string; [k: string]: string }

export type BrowserKey = "firefox" | "chrome" | "edge"

export type LatestVersionMap = Record<BrowserKey, string | null>

export type ChangelogNote = {
  type: "new" | "fixed" | "improved" | string
  appliesTo: string[]
  text: LocalizedText
}

export type ChangelogEntry = {
  releases: Record<string, string> // { free: "3.0.0", paid?: "1.0.0" }
  date: string
  importance: "major" | "minor" | "patch" | string
  showWhatsNew?: boolean
  notes: ChangelogNote[]
  link: string | null
}

export type UpcomingVersion = {
  id: string
  product: string
  version: string
  status: string
  browserStatus?: Record<BrowserKey, string>
  announcedOn?: string
  expectedDate?: string | null
  dateIsEstimate?: boolean
  importance?: string
  message?: LocalizedText
  highlights?: { appliesTo: string[]; text: LocalizedText }[]
  link: string | null
}

export type PaidVersion = {
  status: string
  available: boolean
  name: string
  announcement?: LocalizedText
  expectedDate?: string | null
  dateIsEstimate?: boolean
  waitlistUrl?: string | null
  latestVersion: LatestVersionMap
  minSupportedVersion: string | null
  price?: {
    amount: number
    currency: string
    model: string
    note: string | null
  }
  features?: {
    id: string
    name: LocalizedText
    description: LocalizedText
    status: string
    expectedDate: string | null
  }[]
  links?: Record<string, { url: string; title: LocalizedText }>
}

export type Promotion = {
  id: string
  enabled: boolean
  title: LocalizedText
  message: LocalizedText
  code?: string
  startDate?: string
  endDate?: string
  link: { url: string; label?: LocalizedText } | null
}

export type UpdateDetails = {
  schemaVersion: number
  lastUpdated: string
  supportedLanguage: string[]
  freeVersion: {
    latestVersion: LatestVersionMap
    minSupportedVersion: string
    downloadUrls: Record<string, string>
  }
  upcomingVersions: UpcomingVersion[]
  changelog: ChangelogEntry[]
  paidVersion: PaidVersion
  promotions: Promotion[]
  statusBanner: {
    active: boolean
    level: "info" | "warning" | "error" | string
    message: LocalizedText
    link: string | null
  }
  notifications: any[]
  deprecations: any[]
  featureFlags: {
    showPaidBanner: boolean
    showUpcomingBanner: boolean
    showChangelogButton: boolean
    enableExperimentalFeature: boolean
  }
  remoteValues: Record<string, any>
  links: Record<string, any>
  extra: Record<string, any>
}