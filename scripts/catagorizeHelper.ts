import { kmeans } from "ml-kmeans"

type BookMarkEntry = {
  title: string
  domain: string
}

const MIN_CLUSTERS = 3
const ABSOLUTE_MAX_CLUSTERS = 40 // sanity ceiling even for huge collections

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

// Flat lookup set of every category name, used to detect when a k-means
// cluster's auto-picked term-based name happens to collide with a known
// brand/category name (e.g. "youtube") so we can verify domain purity
// before trusting that name — see enforceClusterDomainPurity.
const KNOWN_CATEGORY_NAMES = new Set(Object.keys(DOMAIN_CATEGORIES))

function preprocess(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
}

// --- Compute document frequency ---

function computeDocFrequency(documents: string[][]): Record<string, number> {
  const df: Record<string, number> = {}
  documents.forEach((doc) => {
    new Set(doc).forEach((term) => {
      df[term] = (df[term] || 0) + 1
    })
  })
  return df
}

// --- Compute TF-IDF vectors ---

function computeVectors(
  documents: string[][],
  vocabulary: string[],
  df: Record<string, number>
): number[][] {
  const N = documents.length
  return documents.map((doc) => {
    const tf: Record<string, number> = {}
    doc.forEach((term) => {
      tf[term] = (tf[term] || 0) + 1
    })
    const docLength = doc.length || 1

    return vocabulary.map((term) => {
      const termFreq = (tf[term] || 0) / docLength
      const idf = Math.log(N / (df[term] || 1) + 1) // Smoothed IDF
      return termFreq * idf
    })
  })
}

function topTermsForDoc(
  doc: string[],
  df: Record<string, number>,
  n: number,
  totalDocs: number
): string[] {
  const tf: Record<string, number> = {}
  doc.forEach((term) => {
    tf[term] = (tf[term] || 0) + 1
  })
  const docLength = doc.length || 1

  const scored = Object.keys(tf).map((term) => {
    const termFreq = tf[term] / docLength
    const idf = Math.log(totalDocs / (df[term] || 1) + 1)
    return { term, score: termFreq * idf }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, n).map((s) => s.term)
}

// --- Improved cluster count heuristics ---

/**
 * Dynamic cap: scales with total bookmark count.
 * More aggressive: creates more clusters for better granularity.
 *   50 entries    -> cap ~12
 *   200 entries   -> cap ~25
 *   1000 entries  -> cap ~40
 *   5000 entries  -> cap ~40 (hits absolute ceiling)
 */
export function estimateClusterCap(totalEntries: number): number {
  if (totalEntries <= 0) return MIN_CLUSTERS
  // More aggressive cap: sqrt(n) * 1.8 instead of 1.4
  const dynamicCap = Math.round(Math.sqrt(totalEntries) * 1.8)
  return Math.min(ABSOLUTE_MAX_CLUSTERS, Math.max(MIN_CLUSTERS, dynamicCap))
}

function estimateK(n: number, cap: number): number {
  // More aggressive K estimation: sqrt(n/1.5) instead of sqrt(n/2)
  const estimate = Math.round(Math.sqrt(n / 1.5))
  // Ensure we don't get too few clusters
  const minClusters = Math.min(4, Math.ceil(n / 15)) // At least 4 clusters, or 1 per 15 items
  return Math.min(cap, Math.max(MIN_CLUSTERS, Math.max(estimate, minClusters)))
}

// --- Domain-based fallback categorization ---

/**
 * Splits a domain into its dot-separated labels, lowercased, e.g.
 * "www.youtube.com" -> ["www", "youtube", "com"]
 * "sub.youtube-downloader.com" -> ["sub", "youtube-downloader", "com"]
 *
 * Matching against these labels (rather than raw substring `includes`)
 * means "youtube-downloader.com" and "notyoutube.com" no longer falsely
 * match "youtube" the way `domain.includes("youtube")` would.
 */
function domainLabels(domain: string): string[] {
  return domain.toLowerCase().split(".").filter(Boolean)
}

/**
 * True if `domain` genuinely belongs to `category`, checked by exact label
 * match (or, for multi-part keys like "youtu.be", a match against the
 * label-joined domain) rather than loose substring containment.
 */
function domainMatchesCategory(domain: string, categoryKeys: string[]): boolean {
  const labels = domainLabels(domain)
  const joined = labels.join(".")

  return categoryKeys.some((key) => {
    if (key.includes(".")) {
      // Multi-label key (e.g. "youtu.be", "github.io"): match as a suffix
      // of the full domain, not merely "contained somewhere".
      return joined === key || joined.endsWith(`.${key}`)
    }
    // Single-label key (e.g. "youtube"): must match a whole label exactly,
    // not just appear as a substring within a longer label.
    return labels.includes(key)
  })
}

function getDomainCategory(domain: string): string | null {
  for (const [category, domains] of Object.entries(DOMAIN_CATEGORIES)) {
    if (domainMatchesCategory(domain, domains)) {
      return category
    }
  }
  return null
}

/**
 * Fraction of a set of entries that share the same registrable-ish domain
 * "core" (second-level label, e.g. "youtube" out of "www.youtube.com").
 * Used as a generic cohesion signal: a cluster genuinely about one site
 * will have most members sharing a domain core; a cluster that's really
 * just "several unrelated sites whose titles happened to share a generic
 * word" will not.
 */
function dominantDomainCoreShare(members: { entry: BookMarkEntry }[]): {
  core: string | null
  share: number
} {
  const counts: Record<string, number> = {}
  for (const { entry } of members) {
    const labels = domainLabels(entry.domain)
    // second-to-last label is usually the meaningful "core" (google.com -> google,
    // co.uk-style domains aren't perfectly handled here but this is only a heuristic)
    const core = labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? ""
    if (!core) continue
    counts[core] = (counts[core] || 0) + 1
  }
  const entriesSorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entriesSorted.length === 0) return { core: null, share: 0 }
  const [core, count] = entriesSorted[0]
  return { core, share: count / members.length }
}

/**
 * Two related problems, both caused by naming clusters after whatever term
 * scored highest, with no check on whether that reflects real cohesion:
 *
 * 1. A cluster can get named after a known brand (e.g. "youtube") purely
 *    because that word won on TF-IDF frequency — even if hardly any
 *    member's domain is actually youtube.com.
 * 2. A cluster can get named after a generic, non-brand word (e.g.
 *    "example") that isn't in DOMAIN_CATEGORIES at all, gluing together
 *    totally unrelated domains that happened to share that word — this
 *    previously slipped through undetected since the old check only ever
 *    looked at known brand names.
 *
 * This pass now checks EVERY cluster for domain cohesion, not just ones
 * whose name matches a known brand:
 *  - If the name matches a known brand, verify actual domain purity against
 *    that brand's domain list (as before).
 *  - Otherwise, verify that a real majority of members share the same
 *    domain core. If neither check passes, split the cluster: keep any
 *    genuinely cohesive sub-group, and re-home the rest under a fresh
 *    term-based name (skipping the discredited word) rather than shipping
 *    a bucket of unrelated sites under a misleading label.
 */
function enforceClusterDomainPurity(
  clusters: Record<string, { entry: BookMarkEntry; terms: string[] }[]>
): Record<string, { entry: BookMarkEntry; terms: string[] }[]> {
  const result: Record<string, { entry: BookMarkEntry; terms: string[] }[]> = {}

  for (const [name, members] of Object.entries(clusters)) {
    // Strip any "-2", "-3" disambiguation suffix before checking.
    const baseName = name.replace(/-\d+$/, "")

    if (KNOWN_CATEGORY_NAMES.has(baseName)) {
      const categoryKeys = DOMAIN_CATEGORIES[baseName]
      const matching = members.filter((m) => domainMatchesCategory(m.entry.domain, categoryKeys))
      const nonMatching = members.filter((m) => !domainMatchesCategory(m.entry.domain, categoryKeys))
      const purity = matching.length / members.length

      if (purity >= 0.5 || nonMatching.length === 0) {
        result[name] = members
        continue
      }

      if (matching.length > 0) {
        result[name] = matching
      }
      if (nonMatching.length > 0) {
        splitInto(result, nonMatching, baseName)
      }
      continue
    }

    // Generic (non-brand) cluster name: require real domain cohesion
    // rather than trusting a shared-word coincidence. Small clusters (< 4)
    // are left alone — with so few members, "cohesion" isn't a meaningful
    // signal either way and splitting them further just produces noise.
    if (members.length < 4) {
      result[name] = members
      continue
    }

    const { core, share } = dominantDomainCoreShare(members)

    if (share >= 0.5 && core) {
      // Genuinely one site's bookmarks under a topical name — fine as-is.
      result[name] = members
      continue
    }

    // No real domain cohesion: this cluster is likely just "different
    // sites whose titles share a generic word". Re-home members under
    // per-domain groupings instead of keeping the misleading shared name.
    const byDomainCore: Record<string, { entry: BookMarkEntry; terms: string[] }[]> = {}
    for (const member of members) {
      const labels = domainLabels(member.entry.domain)
      const domainCore = labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? "misc"
      const key = domainCore.replace(/[^a-z0-9]/g, "").slice(0, 20) || "misc"
      if (!byDomainCore[key]) byDomainCore[key] = []
      byDomainCore[key].push(member)
    }

    for (const [domainCore, domainMembers] of Object.entries(byDomainCore)) {
      let finalName = domainCore
      let suffix = 2
      while (result[finalName]) {
        finalName = `${domainCore}-${suffix}`
        suffix++
      }
      result[finalName] = domainMembers
    }
  }

  return result
}

/** Helper: name+insert a re-homed group of non-matching members. */
function splitInto(
  result: Record<string, { entry: BookMarkEntry; terms: string[] }[]>,
  nonMatching: { entry: BookMarkEntry; terms: string[] }[],
  avoidName: string
) {
  const fallbackName = pickFallbackClusterName(nonMatching, avoidName)
  let finalName = fallbackName
  let suffix = 2
  while (result[finalName]) {
    finalName = `${fallbackName}-${suffix}`
    suffix++
  }
  result[finalName] = nonMatching
}

/**
 * Picks a name for a cluster from its members' terms, skipping any term
 * that equals `avoidName` (the brand name we just determined doesn't fit),
 * so we don't just immediately re-pick the same misleading name.
 */
function pickFallbackClusterName(
  members: { entry: BookMarkEntry; terms: string[] }[],
  avoidName: string
): string {
  const termFrequency: Record<string, number> = {}
  members.forEach(({ terms }) => {
    terms.forEach((term) => {
      if (term === avoidName) return
      termFrequency[term] = (termFrequency[term] || 0) + 1
    })
  })

  const sortedTerms = Object.entries(termFrequency).sort((a, b) => b[1] - a[1])
  let clusterName = sortedTerms.length > 0 ? sortedTerms[0][0] : "misc"
  clusterName = clusterName.replace(/[^a-z0-9]/g, "").slice(0, 20) || "misc"
  return clusterName
}

// --- Main entry point ---

export function getCatagorized(
  entries: BookMarkEntry[]
): Record<string, BookMarkEntry[]> {
  if (entries.length === 0) return {}

  // IMPORTANT: only the title feeds the term/vocabulary pipeline used for
  // clustering and naming. Previously `domain` was mixed in here too, which
  // meant clusters got named "youtube"/"github"/"example" etc. just because
  // the domain string (which appears in every doc for that site) dominated
  // TF-IDF — producing names that duplicated plain domain-based grouping
  // instead of reflecting what the bookmarks are actually about. Domain is
  // still used separately for purity checks and the fallback categorizer.
  const documents = entries.map((entry) => preprocess(entry.title))

  // Check if we have enough terms for clustering
  const totalTerms = documents.reduce((sum, doc) => sum + doc.length, 0)
  if (totalTerms < 10) {
    // Fallback to domain-based categorization
    return getDomainBasedCategories(entries)
  }

  const df = computeDocFrequency(documents)
  const vocabulary = Object.keys(df)

  // If vocabulary is too small, use domain-based
  if (vocabulary.length < 5) {
    return getDomainBasedCategories(entries)
  }

  const vectors = computeVectors(documents, vocabulary, df)
  const topTermsPerEntry = documents.map((doc) =>
    topTermsForDoc(doc, df, 5, documents.length)
  )

  const cap = estimateClusterCap(entries.length)
  let k = Math.min(estimateK(entries.length, cap), entries.length)
  
  // Ensure k is at least 2
  k = Math.max(k, 2)

  let clusterAssignments: number[]
  try {
    const result = kmeans(vectors, k, {
      maxIterations: 100,
      tolerance: 0.0001
    })
    clusterAssignments = result.clusters
  } catch (error) {
    // If K-means fails, use domain-based
    return getDomainBasedCategories(entries)
  }

  // Check if we got valid clusters
  const uniqueClusters = new Set(clusterAssignments)
  if (uniqueClusters.size < 2) {
    // If all in one cluster, try with more clusters
    k = Math.min(k + 3, cap, entries.length)
    try {
      const result = kmeans(vectors, k, {
        maxIterations: 100,
        tolerance: 0.0001
      })
      clusterAssignments = result.clusters
    } catch (error) {
      return getDomainBasedCategories(entries)
    }
  }

  const clustersRaw: Record<number, { entry: BookMarkEntry; terms: string[] }[]> = {}
  entries.forEach((entry, i) => {
    const clusterIdx = clusterAssignments[i]
    if (!clustersRaw[clusterIdx]) clustersRaw[clusterIdx] = []
    clustersRaw[clusterIdx].push({ entry, terms: topTermsPerEntry[i] || [] })
  })

  // Merge tiny clusters (less than 3 items) into the closest big cluster
  const clusterSizes = Object.fromEntries(
    Object.entries(clustersRaw).map(([id, members]) => [Number(id), members.length])
  )
  
  const tinyClusters = Object.entries(clusterSizes)
    .filter(([_, size]) => size < 3 && size > 0)
    .map(([id]) => Number(id))
  
  const bigClusters = Object.entries(clusterSizes)
    .filter(([_, size]) => size >= 3)
    .map(([id]) => Number(id))

  if (tinyClusters.length > 0 && bigClusters.length > 0) {
    // Move tiny clusters to the nearest big cluster
    for (const tinyId of tinyClusters) {
      const tinyMembers = clustersRaw[tinyId]
      if (!tinyMembers) continue
      
      // Find closest big cluster (by checking if any terms overlap)
      let bestMatch = bigClusters[0]
      let bestScore = 0
      
      for (const bigId of bigClusters) {
        const bigMembers = clustersRaw[bigId]
        if (!bigMembers) continue
        
        // Calculate overlap score based on terms
        const bigTerms = new Set(
          bigMembers.flatMap(m => m.terms)
        )
        
        let overlapCount = 0
        for (const member of tinyMembers) {
          for (const term of member.terms) {
            if (bigTerms.has(term)) overlapCount++
          }
        }
        
        if (overlapCount > bestScore) {
          bestScore = overlapCount
          bestMatch = bigId
        }
      }
      
      // Merge tiny cluster into best match
      if (clustersRaw[bestMatch]) {
        clustersRaw[bestMatch].push(...tinyMembers)
      }
      delete clustersRaw[tinyId]
    }
  }

  let output: Record<string, BookMarkEntry[]> = {}
  const namedClusters: Record<string, { entry: BookMarkEntry; terms: string[] }[]> = {}

  Object.values(clustersRaw).forEach((members) => {
    if (members.length === 0) return

    const termFrequency: Record<string, number> = {}
    members.forEach(({ terms }) => {
      terms.forEach((term) => {
        termFrequency[term] = (termFrequency[term] || 0) + 1
      })
    })

    const sortedTerms = Object.entries(termFrequency).sort((a, b) => b[1] - a[1])
    let clusterName = sortedTerms.length > 0 ? sortedTerms[0][0] : "misc"
    
    // Clean up cluster name
    clusterName = clusterName.replace(/[^a-z0-9]/g, '').slice(0, 20) || "misc"

    let finalName = clusterName
    let suffix = 2
    while (namedClusters[finalName]) {
      finalName = `${clusterName}-${suffix}`
      suffix++
    }

    namedClusters[finalName] = members
  })

  // Before finalizing, verify that any cluster named after a known brand
  // (e.g. "youtube") is actually dominated by that brand's domains. If not,
  // split off the mismatched members instead of shipping a misleading
  // category (this is the core fix for e.g. non-YouTube URLs ending up in
  // a "youtube" bucket just because titles mentioned the word).
  const purified = enforceClusterDomainPurity(namedClusters)

  for (const [name, members] of Object.entries(purified)) {
    output[name] = members.map((m) => m.entry)
  }

  // If we still have very few categories, enhance with domain-based
  if (Object.keys(output).length < 3) {
    const domainBased = getDomainBasedCategories(entries)
    // Merge domain-based categories with cluster-based
    for (const [cat, items] of Object.entries(domainBased)) {
      if (!output[cat]) {
        output[cat] = items
      }
    }
  }

  return output
}

// --- Domain-based categorization fallback ---

function getDomainBasedCategories(entries: BookMarkEntry[]): Record<string, BookMarkEntry[]> {
  const categories: Record<string, BookMarkEntry[]> = {}
  
  for (const entry of entries) {
    let domain = entry.domain
    // Extract main domain
    const parts = domain.split('.')
    let category: string
    
    // Try to match against known domain categories first
    const knownCategory = getDomainCategory(domain)
    if (knownCategory) {
      category = knownCategory
    } else if (parts.length >= 2) {
      // Try to get the second-level domain
      category = parts[parts.length - 2]
      // Handle special cases like .co.uk
      if (parts.length >= 3 && (parts[parts.length - 1] === 'uk' || parts[parts.length - 1] === 'au')) {
        category = parts[parts.length - 3]
      }
    } else {
      category = domain
    }
    
    // Clean up category name
    category = category.replace(/[^a-z0-9]/g, '').slice(0, 20) || 'uncategorized'
    
    if (!categories[category]) {
      categories[category] = []
    }
    categories[category].push(entry)
  }
  
  return categories
}