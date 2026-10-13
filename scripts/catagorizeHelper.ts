import { kmeans } from "ml-kmeans"

type BookMarkEntry = {
  title: string
  domain: string
}

type Member = { entry: BookMarkEntry; idx: number }
type Sparse = { idx: number[]; w: number[] }

const MIN_CLUSTERS = 3
const ABSOLUTE_MAX_CLUSTERS = 40 // sanity ceiling even for huge collections

// Speed knobs: the dense matrix is (docs x MAX_VOCAB), so this is the main cost lever.
const MAX_VOCAB = 300 // only the most useful terms feed k-means
const MAX_DF_RATIO = 0.5 // drop terms that appear in more than half the docs (no signal)
const KMEANS_MAX_ITERATIONS = 40
const KMEANS_SEED = 42 // deterministic results between runs

const STOPWORDS = new Set([
  "a", "an", "the", "is", "in", "on", "at", "to", "of", "and", "or",
  "for", "with", "how", "what", "why", "this", "that", "it", "as",
  "by", "from", "be", "are", "was", "were", "com", "www", "http", "https",
  "you", "your", "i", "we", "they", "he", "she", "not", "but", "can",
  "net", "org", "io", "app", "dev", "api", "blog", "news", "shop", "store",
  "online", "free", "best", "top", "new", "old", "home", "index", "about",
  "contact", "support", "help", "faq", "login", "register", "signup",
  "download", "upload", "share", "view", "click", "read", "learn",
  "guide", "tutorial", "course", "example", "demo", "test", "sample",
  "site", "website", "page", "pages", "web", "html", "htm", "php"
])

//#region Domain Catagories
const DOMAIN_CATEGORIES: Record<string, string[]> = {
  'youtube': ['youtube', 'youtu.be'],
  'github': ['github', 'github.io'],
  'google': ['google', 'gmail', 'docs', 'drive', 'calendar'],
  'amazon': ['amazon', 'aws'],
  'facebook': ['facebook', 'fb'],
  'twitter': ['twitter', 'x.com'],
  'linkedin': ['linkedin'],
  'instagram': ['instagram'],
  'reddit': ['reddit'],
  'stackoverflow': ['stackoverflow', 'stackexchange'],
  'medium': ['medium'],
  'wikipedia': ['wikipedia'],
  'netflix': ['netflix'],
  'spotify': ['spotify'],
  'slack': ['slack'],
  'discord': ['discord'],
  'zoom': ['zoom'],
  'microsoft': ['microsoft', 'azure', 'office', 'outlook', 'live'],
  'apple': ['apple', 'icloud', 'itunes'],
  'adobe': ['adobe'],
  'atlassian': ['atlassian', 'jira', 'confluence', 'bitbucket'],
  'notion': ['notion'],
  'figma': ['figma'],
  'vercel': ['vercel'],
  'netlify': ['netlify'],
  'heroku': ['heroku'],
  'railway': ['railway'],
  'render': ['render'],
  'cloudflare': ['cloudflare'],
  'digitalocean': ['digitalocean'],
  'linode': ['linode'],
  'mongodb': ['mongodb'],
  'mysql': ['mysql'],
  'postgresql': ['postgresql', 'postgres'],
  'redis': ['redis'],
  'elastic': ['elastic'],
  'kibana': ['kibana'],
  'grafana': ['grafana'],
  'prometheus': ['prometheus'],
  'docker': ['docker'],
  'kubernetes': ['kubernetes', 'k8s'],
  'jenkins': ['jenkins'],
  'gitlab': ['gitlab'],
  'npm': ['npm'],
  'yarn': ['yarn'],
  'python': ['python', 'pypi'],
  'java': ['java', 'jdk', 'jre'],
  'javascript': ['javascript', 'js'],
  'typescript': ['typescript', 'ts'],
  'react': ['react'],
  'vue': ['vue', 'vuejs'],
  'angular': ['angular'],
  'svelte': ['svelte'],
  'nextjs': ['nextjs', 'next'],
  'nuxt': ['nuxt', 'nuxtjs'],
  'gatsby': ['gatsby'],
  'tailwind': ['tailwind'],
  'bootstrap': ['bootstrap'],
  'material': ['material', 'mui', 'material-ui'],
  'cypress': ['cypress'],
  'jest': ['jest'],
  'playwright': ['playwright'],
  'webpack': ['webpack'],
  'vite': ['vite'],
  'eslint': ['eslint'],
  'prettier': ['prettier'],
  'babel': ['babel'],
  'swagger': ['swagger'],
  'postman': ['postman'],
  'insomnia': ['insomnia'],
  'dockerhub': ['dockerhub'],
  'crates': ['crates', 'crates.io'],
  'pypi': ['pypi'],
  'maven': ['maven'],
  'gradle': ['gradle'],
  'sentry': ['sentry'],
  'datadog': ['datadog'],
  'newrelic': ['newrelic'],
  'logrocket': ['logrocket'],
  'hotjar': ['hotjar'],
  'hubspot': ['hubspot'],
  'salesforce': ['salesforce'],
  'zendesk': ['zendesk'],
  'intercom': ['intercom'],
  'stripe': ['stripe'],
  'paypal': ['paypal'],
  'square': ['square'],
  'shopify': ['shopify'],
  'woocommerce': ['woocommerce'],
  'wordpress': ['wordpress'],
  'wix': ['wix'],
  'webflow': ['webflow'],
  'squarespace': ['squarespace'],
  'clickfunnels': ['clickfunnels'],
  'kajabi': ['kajabi'],
  'teachable': ['teachable'],
  'thinkific': ['thinkific'],
  'udemy': ['udemy'],
  'coursera': ['coursera'],
  'edx': ['edx'],
  'skillshare': ['skillshare'],
  'pluralsight': ['pluralsight'],
  'lynda': ['lynda'],
  'linkedinlearning': ['linkedinlearning'],
  'codecademy': ['codecademy'],
  'freecodecamp': ['freecodecamp'],
  'leetcode': ['leetcode'],
  'hackerrank': ['hackerrank'],
  'codewars': ['codewars'],
  'kaggle': ['kaggle'],
  'datacamp': ['datacamp'],
  'analytics': ['analytics'],
  'mixpanel': ['mixpanel'],
  'amplitude': ['amplitude'],
  'fullstory': ['fullstory'],
  'heap': ['heap'],
  'segment': ['segment'],
  'mparticle': ['mparticle'],
  'tealium': ['tealium']
}
//#endregion

const KNOWN_CATEGORY_NAMES = new Set(Object.keys(DOMAIN_CATEGORIES))

// --- O(1) domain lookup tables, built once at load time ---

// Single-label keys ("youtube") -> category. First category listed wins on conflicts.
const LABEL_TO_CATEGORY = new Map<string, string>()
// Multi-label keys ("youtu.be", "github.io") -> category, matched as a domain suffix.
const SUFFIX_KEYS: [string, string][] = []

for (const [category, keys] of Object.entries(DOMAIN_CATEGORIES)) {
  for (const key of keys) {
    if (key.includes(".")) {
      SUFFIX_KEYS.push([key, category])
    } else if (!LABEL_TO_CATEGORY.has(key)) {
      LABEL_TO_CATEGORY.set(key, category)
    }
  }
}

const SECOND_LEVEL_TLD_PARTS = new Set(["co", "com", "org", "net", "ac", "gov", "edu"])

function domainLabels(domain: string): string[] {
  return domain.toLowerCase().split(".").filter(Boolean)
}

/** "www.youtube.com" -> "youtube", "foo.co.uk" -> "foo" */
function domainCore(domain: string): string {
  const labels = domainLabels(domain)
  if (labels.length === 0) return ""
  if (labels.length === 1) return labels[0]
  const last = labels[labels.length - 1]
  const secondLast = labels[labels.length - 2]
  if (labels.length >= 3 && last.length === 2 && SECOND_LEVEL_TLD_PARTS.has(secondLast)) {
    return labels[labels.length - 3]
  }
  return secondLast
}

const domainCategoryCache = new Map<string, string | null>()

/**
 * Resolves a domain to a known category (or null). Whole-label matching only,
 * so "youtube-downloader.com" never matches "youtube". Labels are checked from
 * the registrable name outward, so "docs.github.com" resolves to github, not
 * google (via the "docs" subdomain).
 */
function getDomainCategory(domain: string): string | null {
  const cached = domainCategoryCache.get(domain)
  if (cached !== undefined) return cached

  const labels = domainLabels(domain)
  const joined = labels.join(".")
  let found: string | null = null

  for (const [key, category] of SUFFIX_KEYS) {
    if (joined === key || joined.endsWith(`.${key}`)) {
      found = category
      break
    }
  }

  if (!found) {
    // Skip the TLD (last label) when there's more than one label.
    const start = labels.length > 1 ? labels.length - 2 : 0
    for (let i = start; i >= 0; i--) {
      const category = LABEL_TO_CATEGORY.get(labels[i])
      if (category) {
        found = category
        break
      }
    }
  }

  domainCategoryCache.set(domain, found)
  return found
}

// --- Text preprocessing ---

function preprocess(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
}

function computeDocFrequency(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>()
  for (const doc of documents) {
    for (const term of new Set(doc)) {
      df.set(term, (df.get(term) || 0) + 1)
    }
  }
  return df
}

// --- Sparse, L2-normalised TF-IDF ---

/**
 * Builds a sparse TF-IDF vector (only the vocabulary terms the doc contains)
 * and L2-normalises it. With unit vectors, Euclidean k-means behaves like
 * cosine-similarity clustering, which is what you want for text: long and
 * short titles are treated fairly.
 */
function buildSparse(doc: string[], termIndex: Map<string, number>, idf: number[]): Sparse {
  const counts = new Map<number, number>()
  for (const term of doc) {
    const i = termIndex.get(term)
    if (i !== undefined) counts.set(i, (counts.get(i) || 0) + 1)
  }

  const idx: number[] = []
  const w: number[] = []
  let norm = 0
  for (const [i, c] of counts) {
    const v = c * idf[i]
    idx.push(i)
    w.push(v)
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let j = 0; j < w.length; j++) w[j] /= norm
  }
  return { idx, w }
}

function toDense(s: Sparse, size: number): number[] {
  const v = new Array<number>(size).fill(0)
  for (let j = 0; j < s.idx.length; j++) v[s.idx[j]] = s.w[j]
  return v
}

function computeCentroid(docIdxs: number[], sparse: Sparse[], size: number): Float64Array {
  const c = new Float64Array(size)
  for (const d of docIdxs) {
    const s = sparse[d]
    for (let j = 0; j < s.idx.length; j++) c[s.idx[j]] += s.w[j]
  }
  return c
}

function normalizeInPlace(v: Float64Array): Float64Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

function sparseDot(s: Sparse, dense: Float64Array): number {
  let sum = 0
  for (let j = 0; j < s.idx.length; j++) sum += s.w[j] * dense[s.idx[j]]
  return sum
}

/** Name a group after its highest-weighted centroid term (optionally skipping one). */
function nameFromCentroid(centroid: Float64Array, vocabulary: string[], avoid?: string): string {
  let best = -1
  let bestScore = 0
  for (let i = 0; i < centroid.length; i++) {
    if (centroid[i] > bestScore && vocabulary[i] !== avoid) {
      bestScore = centroid[i]
      best = i
    }
  }
  return sanitizeName(best >= 0 ? vocabulary[best] : "misc")
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9]/g, "").slice(0, 20) || "misc"
}

function uniqueName(base: string, taken: Record<string, unknown>): string {
  let name = base
  let suffix = 2
  while (taken[name]) {
    name = `${base}-${suffix}`
    suffix++
  }
  return name
}

// --- Cluster count heuristics ---

/**
 * Dynamic cap: scales with total bookmark count.
 *   50 entries    -> cap ~13
 *   200 entries   -> cap ~25
 *   1000 entries  -> cap ~40 (hits absolute ceiling)
 */
export function estimateClusterCap(totalEntries: number): number {
  if (totalEntries <= 0) return MIN_CLUSTERS
  const dynamicCap = Math.round(Math.sqrt(totalEntries) * 1.8)
  return Math.min(ABSOLUTE_MAX_CLUSTERS, Math.max(MIN_CLUSTERS, dynamicCap))
}

function estimateK(n: number, cap: number): number {
  const estimate = Math.round(Math.sqrt(n / 1.5))
  const minClusters = Math.min(4, Math.ceil(n / 15))
  return Math.min(cap, Math.max(MIN_CLUSTERS, Math.max(estimate, minClusters)))
}

// --- Brand purity check ---

/**
 * A cluster named after a known brand (e.g. "youtube") must actually be made
 * of that brand's domains. If fewer than half are, keep the genuine members
 * under the brand name and re-home the rest under a different centroid-based
 * name.
 */
function enforceBrandPurity(
  clusters: Record<string, Member[]>,
  sparse: Sparse[],
  vocabulary: string[]
): Record<string, Member[]> {
  const result: Record<string, Member[]> = {}

  for (const [name, members] of Object.entries(clusters)) {
    const baseName = name.replace(/-\d+$/, "")

    if (!KNOWN_CATEGORY_NAMES.has(baseName)) {
      result[uniqueName(name, result)] = members
      continue
    }

    const matching: Member[] = []
    const nonMatching: Member[] = []
    for (const m of members) {
      if (getDomainCategory(m.entry.domain) === baseName) matching.push(m)
      else nonMatching.push(m)
    }

    if (nonMatching.length === 0 || matching.length / members.length >= 0.5) {
      result[uniqueName(name, result)] = members
      continue
    }

    if (matching.length > 0) result[uniqueName(baseName, result)] = matching

    const centroid = computeCentroid(nonMatching.map((m) => m.idx), sparse, vocabulary.length)
    const fallback = nameFromCentroid(centroid, vocabulary, baseName)
    result[uniqueName(fallback, result)] = nonMatching
  }

  return result
}

// --- Main entry point ---

export function getCatagorized(entries: BookMarkEntry[]): Record<string, BookMarkEntry[]> {
  if (entries.length === 0) return {}

  // Only titles feed clustering; domains are used for purity checks/fallback.
  const documents = entries.map((entry) => preprocess(entry.title))

  const totalTerms = documents.reduce((sum, doc) => sum + doc.length, 0)
  if (totalTerms < 10) return getDomainBasedCategories(entries)

  const N = entries.length
  const df = computeDocFrequency(documents)

  // Keep only informative terms: appear in 2+ docs (a term in one doc can't
  // group anything) but not in more than half (too generic to separate topics),
  // then cap to the MAX_VOCAB most common. This is the biggest speedup, since
  // it shrinks the matrix from (docs x every unique word) to (docs x ~300).
  const maxDf = Math.max(3, Math.floor(N * MAX_DF_RATIO))
  const vocabulary = [...df.entries()]
    .filter(([, count]) => count >= 2 && count <= maxDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VOCAB)
    .map(([term]) => term)

  if (vocabulary.length < 5) return getDomainBasedCategories(entries)

  const V = vocabulary.length
  const termIndex = new Map(vocabulary.map((term, i) => [term, i] as [string, number]))
  const idf = vocabulary.map((term) => Math.log(N / (df.get(term) || 1) + 1))
  const sparse = documents.map((doc) => buildSparse(doc, termIndex, idf))

  // Entries with no vocabulary terms have a zero vector; they would all clump
  // together in one meaningless cluster, so route them to domain grouping.
  const clusterable: number[] = []
  const leftovers: BookMarkEntry[] = []
  for (let i = 0; i < N; i++) {
    if (sparse[i].idx.length > 0) clusterable.push(i)
    else leftovers.push(entries[i])
  }

  const n = clusterable.length
  if (n < MIN_CLUSTERS + 1) return getDomainBasedCategories(entries)

  const vectors = clusterable.map((i) => toDense(sparse[i], V))
  const cap = estimateClusterCap(n)
  let k = Math.max(2, Math.min(estimateK(n, cap), n))

  const runKMeans = (kk: number): number[] | null => {
    try {
      return kmeans(vectors, kk, {
        initialization: "kmeans++", // far better starting centroids than random
        maxIterations: KMEANS_MAX_ITERATIONS,
        tolerance: 1e-4,
        seed: KMEANS_SEED
      }).clusters
    } catch {
      return null
    }
  }

  let assignments = runKMeans(k)
  if (!assignments) return getDomainBasedCategories(entries)

  if (new Set(assignments).size < 2) {
    k = Math.min(k + 3, cap, n)
    assignments = runKMeans(k)
    if (!assignments || new Set(assignments).size < 2) {
      return getDomainBasedCategories(entries)
    }
  }

  // Group doc indices by cluster id
  const groups = new Map<number, number[]>()
  assignments.forEach((clusterId, pos) => {
    const list = groups.get(clusterId)
    if (list) list.push(clusterable[pos])
    else groups.set(clusterId, [clusterable[pos]])
  })

  // Re-home members of tiny clusters (< 3 items) one by one into the most
  // cosine-similar large cluster. Doing it per entry (rather than moving the
  // whole tiny cluster) keeps unrelated entries from being dragged together.
  const bigIds: number[] = []
  const tinyIds: number[] = []
  for (const [id, list] of groups) {
    if (list.length >= 3) bigIds.push(id)
    else tinyIds.push(id)
  }

  if (tinyIds.length > 0 && bigIds.length > 0) {
    const bigCentroids = bigIds.map((id) =>
      normalizeInPlace(computeCentroid(groups.get(id)!, sparse, V))
    )
    for (const tinyId of tinyIds) {
      for (const docIdx of groups.get(tinyId)!) {
        let bestPos = 0
        let bestScore = -1
        for (let b = 0; b < bigIds.length; b++) {
          const score = sparseDot(sparse[docIdx], bigCentroids[b])
          if (score > bestScore) {
            bestScore = score
            bestPos = b
          }
        }
        groups.get(bigIds[bestPos])!.push(docIdx)
      }
      groups.delete(tinyId)
    }
  }

  // Name each cluster after its strongest centroid term
  const namedClusters: Record<string, Member[]> = {}
  for (const list of groups.values()) {
    if (list.length === 0) continue
    const centroid = computeCentroid(list, sparse, V)
    const name = uniqueName(nameFromCentroid(centroid, vocabulary), namedClusters)
    namedClusters[name] = list.map((idx) => ({ entry: entries[idx], idx }))
  }

  const purified = enforceBrandPurity(namedClusters, sparse, vocabulary)

  const output: Record<string, BookMarkEntry[]> = {}
  for (const [name, members] of Object.entries(purified)) {
    output[name] = members.map((m) => m.entry)
  }

  // Add the un-clusterable entries by domain
  if (leftovers.length > 0) {
    for (const [cat, items] of Object.entries(getDomainBasedCategories(leftovers))) {
      if (output[cat]) output[cat].push(...items)
      else output[cat] = items
    }
  }

  // Too few categories to be useful: use domain grouping if it gives more.
  // (Returned as a replacement, not merged, so no entry appears twice.)
  if (Object.keys(output).length < MIN_CLUSTERS) {
    const domainBased = getDomainBasedCategories(entries)
    if (Object.keys(domainBased).length > Object.keys(output).length) return domainBased
  }

  return output
}

// --- Domain-based categorization fallback ---

function getDomainBasedCategories(entries: BookMarkEntry[]): Record<string, BookMarkEntry[]> {
  const categories: Record<string, BookMarkEntry[]> = {}

  for (const entry of entries) {
    const raw = getDomainCategory(entry.domain) ?? domainCore(entry.domain)
    const category = raw.replace(/[^a-z0-9]/g, "").slice(0, 20) || "uncategorized"

    if (!categories[category]) categories[category] = []
    categories[category].push(entry)
  }

  return categories
}