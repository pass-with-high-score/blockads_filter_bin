/**
 * BlockAds Domain Blocklist & Subdomain Matcher
 */

// Essential high-impact telemetry & ad domains embedded for instant 0ms cold-start
const BUILTIN_BLOCKED_DOMAINS = new Set([
  // Google / YouTube Ads & Telemetry
  "doubleclick.net",
  "googleads.g.doubleclick.net",
  "pagead2.googlesyndication.com",
  "adservice.google.com",
  "app-measurement.com",
  "analytics.google.com",
  // Facebook / Meta Tracking
  "graph.facebook.com",
  "pixel.facebook.com",
  "an.facebook.com",
  // Mobile Ad Networks & Trackers
  "unityads.unity3d.com",
  "adcolony.com",
  "vungle.com",
  "ironsrc.mobi",
  "appsflyer.com",
  "adjust.com",
  "branch.io",
  "mixpanel.com",
  "crashlytics.com",
  "applovin.com",
  "mbridge.com",
  "mintegral.com",
  "inmobi.com",
  "chartboost.com",
  "flurry.com",
  "tapjoy.com",
  // Common tracking & analytics
  "sentry.io",
  "hotjar.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
]);

interface BlocklistCache {
  domains: Set<string>;
  lastLoaded: number;
}

// In-memory cache per worker isolate
const blocklistCacheMap = new Map<string, BlocklistCache>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Checks if a domain or any of its parent domains are in the blocklist.
 * Example: for "ads.sub.example.com", checks:
 * 1. "ads.sub.example.com"
 * 2. "sub.example.com"
 * 3. "example.com"
 */
export function isDomainBlocked(domain: string, blocklist: Set<string>): boolean {
  if (!domain) return false;
  domain = domain.toLowerCase().trim();

  // Strip trailing dot if present (FQDN)
  if (domain.endsWith(".")) {
    domain = domain.slice(0, -1);
  }

  // 1. Direct match
  if (blocklist.has(domain)) {
    return true;
  }

  // 2. Subdomain check (traverse upwards)
  let dotIndex = domain.indexOf(".");
  while (dotIndex !== -1) {
    const parentDomain = domain.slice(dotIndex + 1);
    if (blocklist.has(parentDomain)) {
      return true;
    }
    dotIndex = domain.indexOf(".", dotIndex + 1);
  }

  return false;
}

export const PRESET_BLOCKLISTS: Record<string, string> = {
  hostsvn: "https://raw.githubusercontent.com/bigdargon/hostsVN/master/hosts",
  stevenblack: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  easyprivacy: "https://justdomains.github.io/blocklists/lists/easyprivacy-justdomains.txt",
};

export const DEFAULT_COMBINED_BLOCKLISTS = [
  PRESET_BLOCKLISTS.hostsvn,
  PRESET_BLOCKLISTS.stevenblack,
  PRESET_BLOCKLISTS.easyprivacy,
];

/**
 * Loads and caches blocklists from one or multiple URLs/presets
 */
export async function getBlocklist(
  source: string | string[],
  r2Bucket?: R2Bucket
): Promise<Set<string>> {
  // Normalize input into an array of URLs
  let urls: string[] = [];
  if (Array.isArray(source)) {
    urls = source;
  } else if (typeof source === "string") {
    if (source.includes(",")) {
      urls = source.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (source === "all" || source === "combined") {
      urls = DEFAULT_COMBINED_BLOCKLISTS;
    } else if (PRESET_BLOCKLISTS[source.toLowerCase()]) {
      urls = [PRESET_BLOCKLISTS[source.toLowerCase()]];
    } else if (source.trim()) {
      urls = [source.trim()];
    }
  }

  if (urls.length === 0) {
    urls = DEFAULT_COMBINED_BLOCKLISTS;
  }

  // Resolve preset names inside array
  urls = urls.map((u) => PRESET_BLOCKLISTS[u.toLowerCase()] || u);

  const cacheKey = urls.sort().join("|");
  const cached = blocklistCacheMap.get(cacheKey);

  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.domains;
  }

  const domains = new Set<string>(BUILTIN_BLOCKED_DOMAINS);

  // Fetch all blocklists concurrently
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": "BlockAds-DoH-Worker/1.0" },
          cf: { cacheTtl: 21600, cacheEverything: true },
        });

        if (!resp.ok) return;

        const text = await resp.text();
        const lines = text.split("\n");

        for (let line of lines) {
          line = line.trim();
          if (!line || line.startsWith("#") || line.startsWith("!")) continue;

          // Parse hosts format: 0.0.0.0 domain or 127.0.0.1 domain
          if (line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ")) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2 && parts[1]) {
              domains.add(parts[1].toLowerCase());
            }
            continue;
          }

          // Parse Adblock Plus format: ||domain^
          if (line.startsWith("||") && line.includes("^")) {
            const domain = line.slice(2, line.indexOf("^")).toLowerCase();
            if (domain && !domain.includes("/")) {
              domains.add(domain);
            }
            continue;
          }

          // Parse wildcard format: *.domain.com
          if (line.startsWith("*.")) {
            domains.add(line.slice(2).toLowerCase());
            continue;
          }

          // Plain domain
          if (!line.includes(" ") && !line.includes("/") && line.includes(".")) {
            domains.add(line.toLowerCase());
          }
        }
      } catch (err) {
        console.error(`[DoH Blocklist] Failed to fetch blocklist from ${url}:`, err);
      }
    })
  );

  blocklistCacheMap.set(cacheKey, {
    domains,
    lastLoaded: Date.now(),
  });

  return domains;
}
