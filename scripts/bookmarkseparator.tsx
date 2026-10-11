import { type MetaStore, type CategoryAliases } from "../scripts/bookmarkMeta"

export type Bookmark = {
  id: string
  title: string
  url: string
  parentId?: string
  date?: number
}

export type GroupedBookmarks = Record<string, Bookmark[]>
export type GroupMode = "topic" | "domain" | "month" | "date"

// ─── Category icon map ────────────────────────────────────────────────────────
// Covers all labels that generateAutoCategory can return.

const CATEGORY_ICONS: Record<string, string> = {
  "AI & ML":              "🤖",
  "Dev & Code":           "💻",
  "Docs & References":    "📖",
  "Design":               "🎨",
  "Video & Media":        "🎬",
  "News & Blogs":         "📰",
  "Research & Learning":  "📚",
  "Productivity":         "🛠️",
  "Cloud & DevOps":       "☁️",
  "Shopping & Finance":   "💰",
  "Social":               "💬",
  "Reference":            "🏛️",
  "Other":                "🔖",
}

const UNCATEGORIZED      = "Other"
const UNCATEGORIZED_ICON = "🔖"

//#region ─── Known domain -> category ─────────

const DOMAIN_MAP: Record<string, string> = {
  // AI & ML
  "openai.com": "AI & ML", "anthropic.com": "AI & ML", "claude.ai": "AI & ML",
  "chat.openai.com": "AI & ML", "gemini.google.com": "AI & ML",
  "bard.google.com": "AI & ML", "huggingface.co": "AI & ML",
  "replicate.com": "AI & ML", "mistral.ai": "AI & ML", "perplexity.ai": "AI & ML",
  "stability.ai": "AI & ML", "midjourney.com": "AI & ML",
  "runwayml.com": "AI & ML", "elevenlabs.io": "AI & ML",
  "together.ai": "AI & ML", "groq.com": "AI & ML",
  "cohere.com": "AI & ML", "lmsys.org": "AI & ML", "ollama.ai": "AI & ML",

  // Dev & Code
  "github.com": "Dev & Code", "gitlab.com": "Dev & Code",
  "bitbucket.org": "Dev & Code", "codepen.io": "Dev & Code",
  "codesandbox.io": "Dev & Code", "replit.com": "Dev & Code",
  "stackblitz.com": "Dev & Code", "jsfiddle.net": "Dev & Code",
  "stackoverflow.com": "Dev & Code", "developer.mozilla.org": "Dev & Code",
  "devdocs.io": "Dev & Code", "npmjs.com": "Dev & Code",
  "pypi.org": "Dev & Code", "crates.io": "Dev & Code", "pkg.go.dev": "Dev & Code",
  "docs.python.org": "Dev & Code", "docs.rs": "Dev & Code",
  "rust-lang.org": "Dev & Code", "golang.org": "Dev & Code",
  "typescriptlang.org": "Dev & Code", "reactjs.org": "Dev & Code",
  "vuejs.org": "Dev & Code", "svelte.dev": "Dev & Code",
  "nextjs.org": "Dev & Code", "vercel.com": "Dev & Code",
  "netlify.com": "Dev & Code", "railway.app": "Dev & Code",
  "render.com": "Dev & Code", "fly.io": "Dev & Code",
  "supabase.com": "Dev & Code", "planetscale.com": "Dev & Code",

  // Design
  "figma.com": "Design", "sketch.com": "Design", "framer.com": "Design",
  "dribbble.com": "Design", "behance.net": "Design", "awwwards.com": "Design",
  "coolors.co": "Design", "colorhunt.co": "Design",
  "fontawesome.com": "Design", "fonts.google.com": "Design", "material.io": "Design",
  "tailwindcss.com": "Design", "ui.shadcn.com": "Design",
  "heroicons.com": "Design", "lucide.dev": "Design",
  "radix-ui.com": "Design", "daisyui.com": "Design",
  "css-tricks.com": "Design", "smashingmagazine.com": "Design",

  // Video & Media
  "youtube.com": "Video & Media", "youtu.be": "Video & Media",
  "vimeo.com": "Video & Media", "twitch.tv": "Video & Media",
  "netflix.com": "Video & Media", "spotify.com": "Video & Media",
  "soundcloud.com": "Video & Media", "podcasts.apple.com": "Video & Media",

  // News & Blogs
  "medium.com": "News & Blogs", "dev.to": "News & Blogs",
  "hashnode.com": "News & Blogs", "substack.com": "News & Blogs",
  "news.ycombinator.com": "News & Blogs", "techcrunch.com": "News & Blogs",
  "theverge.com": "News & Blogs", "wired.com": "News & Blogs",
  "arstechnica.com": "News & Blogs", "bbc.com": "News & Blogs",
  "reuters.com": "News & Blogs", "nytimes.com": "News & Blogs",
  "bloomberg.com": "News & Blogs",

  // Research & Learning
  "arxiv.org": "Research & Learning", "scholar.google.com": "Research & Learning",
  "semanticscholar.org": "Research & Learning", "researchgate.net": "Research & Learning",
  "pubmed.ncbi.nlm.nih.gov": "Research & Learning",
  "coursera.org": "Research & Learning", "udemy.com": "Research & Learning",
  "edx.org": "Research & Learning", "khanacademy.org": "Research & Learning",
  "freecodecamp.org": "Research & Learning", "frontendmasters.com": "Research & Learning",
  "egghead.io": "Research & Learning", "pluralsight.com": "Research & Learning",
  "wikipedia.org": "Research & Learning",

  // Productivity
  "notion.so": "Productivity", "obsidian.md": "Productivity",
  "roamresearch.com": "Productivity", "logseq.com": "Productivity",
  "airtable.com": "Productivity", "trello.com": "Productivity",
  "linear.app": "Productivity", "asana.com": "Productivity",
  "clickup.com": "Productivity", "monday.com": "Productivity",
  "todoist.com": "Productivity", "excalidraw.com": "Productivity",
  "miro.com": "Productivity", "loom.com": "Productivity",
  "calendly.com": "Productivity", "cal.com": "Productivity",
  "zapier.com": "Productivity", "make.com": "Productivity", "n8n.io": "Productivity",

  // Cloud & DevOps
  "aws.amazon.com": "Cloud & DevOps", "console.aws.amazon.com": "Cloud & DevOps",
  "cloud.google.com": "Cloud & DevOps", "azure.microsoft.com": "Cloud & DevOps",
  "digitalocean.com": "Cloud & DevOps", "cloudflare.com": "Cloud & DevOps",
  "docker.com": "Cloud & DevOps", "hub.docker.com": "Cloud & DevOps",
  "kubernetes.io": "Cloud & DevOps", "terraform.io": "Cloud & DevOps",
  "grafana.com": "Cloud & DevOps", "datadog.com": "Cloud & DevOps",
  "sentry.io": "Cloud & DevOps", "newrelic.com": "Cloud & DevOps",
  "ansible.com": "Cloud & DevOps",

  // Shopping & Finance
  "amazon.com": "Shopping & Finance", "ebay.com": "Shopping & Finance",
  "etsy.com": "Shopping & Finance", "shopify.com": "Shopping & Finance",
  "stripe.com": "Shopping & Finance", "paypal.com": "Shopping & Finance",
  "wise.com": "Shopping & Finance", "revolut.com": "Shopping & Finance",
  "coinbase.com": "Shopping & Finance", "binance.com": "Shopping & Finance",
  "robinhood.com": "Shopping & Finance", "investing.com": "Shopping & Finance",
  "tradingview.com": "Shopping & Finance",

  // Social
  "twitter.com": "Social", "x.com": "Social", "reddit.com": "Social",
  "discord.com": "Social", "slack.com": "Social", "telegram.org": "Social",
  "t.me": "Social", "instagram.com": "Social", "linkedin.com": "Social",
  "facebook.com": "Social", "mastodon.social": "Social",
  "producthunt.com": "Social", "indiehackers.com": "Social",
}
//#endregion

//#region ─── URL path signals ──────────

const PATH_SIGNALS: { pattern: RegExp; category: string }[] = [
  { pattern: /\/(issues?|pulls?|discussions?|milestones?)/, category: "Dev & Code" },
  { pattern: /\/(releases?|changelog|versions?)/, category: "Dev & Code" },
  { pattern: /\/(wiki|docs?|documentation|reference|api[-/]?ref)/, category: "Docs & References" },
  { pattern: /\/(blog|posts?|articles?|stories?|news)/, category: "News & Blogs" },
  { pattern: /\/(course|lesson|tutorial|learn|study|quiz)/, category: "Research & Learning" },
  { pattern: /\/(paper|research|survey|abstract|preprint)/, category: "Research & Learning" },
  { pattern: /\/(watch|video|playlist|shorts?)/, category: "Video & Media" },
  { pattern: /\/(r\/|u\/|user\/)/, category: "Social" },
  { pattern: /\/(shop|store|cart|checkout|product|item)/, category: "Shopping & Finance" },
  { pattern: /\/(invoice|billing|payment|subscription)/, category: "Shopping & Finance" },
  { pattern: /\/(dashboard|workspace|settings|account)/, category: "Productivity" },
]


// ─── Subdomain signals ────────────────────────────────────────────────────────

const SUBDOMAIN_SIGNALS: { pattern: RegExp; category: string }[] = [
  { pattern: /^(docs?|api|developer|dev|reference|ref)\./, category: "Docs & References" },
  { pattern: /^(blog|news|posts?|articles?)\./, category: "News & Blogs" },
  { pattern: /^(learn|courses?|academy|edu|training)\./, category: "Research & Learning" },
  { pattern: /^(status|monitor|uptime)\./, category: "Cloud & DevOps" },
  { pattern: /^(console|dashboard|app|portal|admin)\./, category: "Productivity" },
  { pattern: /^(shop|store|buy)\./, category: "Shopping & Finance" },
]

// ─── Title keyword buckets ────────────────────────────────────────────────────

const TITLE_BUCKETS: { keywords: string[]; category: string }[] = [
  { keywords: ["llm", "gpt", "chatgpt", "ai", "neural", "transformer", "diffusion", "embedding", "prompt", "langchain", "rag"], category: "AI & ML" },
  { keywords: ["github", "git", "api", "sdk", "cli", "npm", "package", "library", "framework", "code", "programming", "developer", "repo", "typescript", "javascript", "python", "rust"], category: "Dev & Code" },
  { keywords: ["design", "figma", "ui", "ux", "color", "font", "typography", "icon", "component", "interface", "mockup", "wireframe"], category: "Design" },
  { keywords: ["tutorial", "course", "learn", "guide", "how to", "howto", "introduction", "beginner", "explained", "cheatsheet"], category: "Research & Learning" },
  { keywords: ["paper", "research", "study", "survey", "analysis", "findings", "experiment"], category: "Research & Learning" },
  { keywords: ["video", "watch", "stream", "episode", "podcast", "listen"], category: "Video & Media" },
  { keywords: ["news", "blog", "post", "article", "weekly", "digest", "newsletter", "opinion"], category: "News & Blogs" },
  { keywords: ["notion", "obsidian", "productivity", "workflow", "automation", "task", "project"], category: "Productivity" },
  { keywords: ["aws", "docker", "kubernetes", "deploy", "devops", "infra", "ci", "pipeline", "monitoring", "server"], category: "Cloud & DevOps" },
  { keywords: ["price", "buy", "shop", "deal", "discount", "payment", "invoice", "billing", "order"], category: "Shopping & Finance" },
  { keywords: ["reddit", "forum", "community", "discussion", "tweet", "thread"], category: "Social" },
]
//#endregion

//#region ─── Helpers ────────────

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

function extractParts(url: string): { hostname: string; subdomain: string; sld: string; path: string } {
  try {
    const u = new URL(url)
    const hostname = u.hostname.replace(/^www\./, "").toLowerCase()
    const parts = hostname.split(".")
    const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    const subdomain = parts.length > 2 ? parts.slice(0, -2).join(".") : ""
    return { hostname, subdomain, sld, path: u.pathname + u.search }
  } catch {
    return { hostname: "", subdomain: "", sld: "", path: "" }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function groupByDomain(bookmark: Bookmark): string {
  return extractHostname(bookmark.url) || "Unknown"
}

function groupByMonth(bookmark: Bookmark): string {
  if (!bookmark.date) return "Unknown date"
  const d = new Date(bookmark.date)
  return `${d.getFullYear()} · ${d.toLocaleString("default", { month: "long" })}`
}

function groupByDate(bookmark: Bookmark): string {
  if (!bookmark.date) return "Unknown date"
  const d = new Date(bookmark.date)
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, "0")
  const dd   = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}
//#endregion

//#region ─── Auto-categorisation (topic mode) ─────────────

function generateAutoCategory(bm: Bookmark): string {
  const { hostname, subdomain, sld, path } = extractParts(bm.url)
  const titleLower = bm.title.toLowerCase()

  // 1. Exact domain match
  if (hostname && DOMAIN_MAP[hostname]) return DOMAIN_MAP[hostname]

  // 2. Subdomain-stripped match — but check subdomain signals first
  //    e.g. docs.github.com → "Docs & References", not "Dev & Code"
  if (subdomain && hostname) {
    const withoutSub = hostname.slice(subdomain.length + 1)
    if (DOMAIN_MAP[withoutSub]) {
      for (const sig of SUBDOMAIN_SIGNALS) {
        if (sig.pattern.test(subdomain + ".")) return sig.category
      }
      return DOMAIN_MAP[withoutSub]
    }
  }

  // 3. Subdomain signals on unknown domains
  if (subdomain) {
    for (const sig of SUBDOMAIN_SIGNALS) {
      if (sig.pattern.test(subdomain + ".")) return sig.category
    }
  }

  // 4. URL path signals
  if (path) {
    for (const sig of PATH_SIGNALS) {
      if (sig.pattern.test(path)) return sig.category
    }
  }

  // 5. Title keyword buckets
  for (const bucket of TITLE_BUCKETS) {
    if (bucket.keywords.some(kw => titleLower.includes(kw))) return bucket.category
  }

  // 6. TLD hints
  if (hostname.endsWith(".edu") || hostname.endsWith(".ac.uk")) return "Research & Learning"
  if (hostname.endsWith(".gov")) return "Reference"
  if (hostname.endsWith(".io")) return "Dev & Code"

  // 7. Last resort: capitalised SLD
  return sld ? capitalize(sld) : UNCATEGORIZED
}
//#endregion

//#region ─── Exported methods ─────────────

export function getCategoryes(
  bookmarks: Bookmark[],
  mode: GroupMode = "topic",
  meta: MetaStore = {},
  aliases: CategoryAliases = {}
): GroupedBookmarks {
  const groups: GroupedBookmarks = {}

  for (const bm of bookmarks) {
    if (!bm.url) continue

    let category: string
    if (mode === "topic") {
      const raw = meta[bm.id]?.customCategory ?? generateAutoCategory(bm)
      category = aliases[raw] ?? raw
    } else if (mode === "domain") {
      category = groupByDomain(bm)
    } else if (mode === "month") {
      category = groupByMonth(bm)
    } else {
      category = groupByDate(bm)
    }

    if (!groups[category]) groups[category] = []
    groups[category].push(bm)
  }

  const sorted: GroupedBookmarks = {}

  if (mode === "domain") {
    Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .forEach(k => { sorted[k] = groups[k] })
  } else if (mode === "month" || mode === "date") {
    Object.keys(groups)
      .sort((a, b) => {
        if (a === "Unknown date") return 1
        if (b === "Unknown date") return -1
        return b.localeCompare(a)
      })
      .forEach(k => { sorted[k] = groups[k] })
  } else {
    // Topic: known category order first, then alphabetical, Other last
    const knownOrder = Object.keys(CATEGORY_ICONS).filter(k => k !== UNCATEGORIZED)
    const unknown    = Object.keys(groups).filter(k => !knownOrder.includes(k) && k !== UNCATEGORIZED)
    ;[...knownOrder, ...unknown.sort(), UNCATEGORIZED]
      .filter(k => groups[k])
      .forEach(k => { sorted[k] = groups[k] })
  }

  return sorted
}

export function getCategoryIcon(name: string, mode: GroupMode = "topic"): string {
  if (mode === "month" || mode === "date") return "📅"
  if (mode === "domain") return "🌐"
  return CATEGORY_ICONS[name] ?? UNCATEGORIZED_ICON
}
//#endregion