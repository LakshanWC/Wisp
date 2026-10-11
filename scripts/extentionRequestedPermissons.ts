export type PermEntry = {
  icon: string
  name: string
  why: string
  optional?: boolean
}

export const REQUIRED_PERMISSIONS: PermEntry[] = [
  {
    icon: "◈",
    name: "bookmarks",
    why: "Read and organize your bookmarks",
  },
  {
    icon: "◈",
    name: "storage",
    why: "Save your categories, notes, aliases, and link-check history locally in your browser.",
  },
  {
    icon: "◈",
    name: "http://*/* and https://*/*",
    why: "Check whether links still work, and load site icons. Wisp sends a HEAD request only — it never reads page contents.",
  },
  {
    icon: "◈",
    name: "unlimitedStorage",
    why: "Raise the browser's default storage cap so large bookmark libraries never run out of room. Granted at install",
  },
  {
    icon: "◈",
    name: "alarms",
    why: "Lock the private vault automatically after a period of inactivity, so it doesn't stay unlocked when you walk away.",
  },
]