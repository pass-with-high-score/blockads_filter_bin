/**
 * BlockAds Private Serverless DNS-over-HTTPS (DoH) Worker
 * Real-time Adblocking & Tracking Sinkhole on Cloudflare Edge
 *
 * Features:
 * - RFC 8484 DNS-over-HTTPS wire format & JSON API
 * - Edge Caching via caches.default (< 1-2ms response on cache hits)
 * - EDNS Client Subnet (ECS) Stripping to protect user IP & location privacy
 * - Smart Upstream Fallback (Cloudflare -> Quad9 -> Google)
 * - Automatic Subdomain Hierarchy Matching
 */

import {
  parseDnsQuery,
  createBlockedResponse,
  base64UrlToUint8Array,
  stripEcs,
  replaceTransactionId,
  extractMinTtl,
  DNS_TYPES,
} from "./dns";
import { getBlocklist, isDomainBlocked } from "./blocklist";
import { renderDashboardHtml } from "./html";

export interface Env {
  UPSTREAM_DOH?: string;
  BLOCK_MODE?: "zero" | "nxdomain";
  CACHE_TTL?: string;
  DEFAULT_BLOCKLIST_URL?: string;
  R2_BUCKET?: R2Bucket;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const UPSTREAM_POOL = [
  "https://1.1.1.1/dns-query",
  "https://dns.quad9.net/dns-query",
  "https://dns.google/dns-query",
];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // ── 1. Health check ──
    if (pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "blockads-doh",
        version: "1.1.0",
        upstream: env.UPSTREAM_DOH || UPSTREAM_POOL[0],
        blockMode: env.BLOCK_MODE || "zero",
        features: ["edge_caching", "ecs_stripping", "upstream_fallback", "subdomain_matching"],
        time: new Date().toISOString(),
      });
    }

    // ── 2. Landing / Setup Dashboard ──
    if (pathname === "/" || pathname === "/setup") {
      const blocklistUrl =
        env.DEFAULT_BLOCKLIST_URL ||
        "https://raw.githubusercontent.com/bigdargon/hostsVN/master/hosts";
      const blocklist = await getBlocklist(blocklistUrl, env.R2_BUCKET);
      const html = renderDashboardHtml(
        url.host,
        env.UPSTREAM_DOH || UPSTREAM_POOL[0],
        blocklist.size
      );
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── 3. DoH Query Handling (/dns-query or /<profile>/dns-query) ──
    if (pathname === "/dns-query" || pathname.endsWith("/dns-query")) {
      return handleDnsQuery(req, env, ctx, url);
    }

    // Default fallback to Dashboard
    return Response.redirect(`${url.origin}/`, 302);
  },
};

/**
 * Main DNS query processor
 */
async function handleDnsQuery(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  const primaryUpstream = env.UPSTREAM_DOH || UPSTREAM_POOL[0];
  const blockMode = (env.BLOCK_MODE as "zero" | "nxdomain") || "zero";
  const defaultBlocklistUrl =
    env.DEFAULT_BLOCKLIST_URL ||
    "https://raw.githubusercontent.com/bigdargon/hostsVN/master/hosts";

  // Check for custom blocklist URL parameter (e.g. ?blocklist=https://...)
  const blocklistSource = url.searchParams.get("blocklist") || defaultBlocklistUrl;
  const blocklist = await getBlocklist(blocklistSource, env.R2_BUCKET);

  // ── Mode A: JSON DoH API (e.g. /dns-query?name=example.com&type=A) ──
  const jsonName = url.searchParams.get("name");
  if (jsonName && req.headers.get("accept")?.includes("application/dns-json")) {
    return handleJsonDnsQuery(jsonName, url, primaryUpstream, blocklist, blockMode, ctx);
  }

  // ── Mode B: Binary Wire Format (RFC 8484) ──
  let queryBytes: Uint8Array | null = null;

  if (req.method === "POST") {
    const buf = await req.arrayBuffer();
    queryBytes = new Uint8Array(buf);
  } else if (req.method === "GET") {
    const dnsParam = url.searchParams.get("dns");
    if (dnsParam) {
      try {
        queryBytes = base64UrlToUint8Array(dnsParam);
      } catch {
        return new Response("Invalid base64url 'dns' query parameter", { status: 400 });
      }
    }
  }

  if (!queryBytes || queryBytes.length < 12) {
    return new Response("Malformed DNS query", { status: 400, headers: CORS_HEADERS });
  }

  // Parse QNAME and QTYPE
  const parsed = parseDnsQuery(queryBytes);
  if (!parsed || !parsed.name) {
    return new Response("Could not parse DNS query name", { status: 400, headers: CORS_HEADERS });
  }

  // ── Step 1: Adblocking Inspection ──
  const isBlocked = isDomainBlocked(parsed.name, blocklist);

  if (isBlocked) {
    // Generate synthesized sinkhole response (0.0.0.0 / :: / NXDOMAIN)
    const blockedBytes = createBlockedResponse(queryBytes, parsed, blockMode, 300);
    return new Response(blockedBytes as any, {
      status: 200,
      headers: {
        "Content-Type": "application/dns-message",
        "Cache-Control": "public, max-age=300",
        "X-BlockAds-Action": "blocked",
        "X-BlockAds-Domain": parsed.name,
        ...CORS_HEADERS,
      },
    });
  }

  // ── Step 2: Cloudflare Edge Cache Lookup (RAM speed < 1-2ms) ──
  // Use a canonical cache key based on query domain & type
  const cacheKeyUrl = `https://${url.host}/_dns_cache/${parsed.type}/${encodeURIComponent(parsed.name)}`;
  const cache = caches.default;

  try {
    const cachedResp = await cache.match(cacheKeyUrl);
    if (cachedResp) {
      const cachedBuf = new Uint8Array(await cachedResp.arrayBuffer());
      // Stamp the current query's transaction ID on the cached DNS response
      const patchedResp = replaceTransactionId(cachedBuf, parsed.id);

      return new Response(patchedResp as any, {
        status: 200,
        headers: {
          "Content-Type": "application/dns-message",
          "Cache-Control": cachedResp.headers.get("cache-control") || "public, max-age=120",
          "X-BlockAds-Action": "allowed",
          "X-BlockAds-Cache": "HIT",
          "X-BlockAds-Domain": parsed.name,
          ...CORS_HEADERS,
        },
      });
    }
  } catch (cacheErr) {
    console.error("[DoH Worker] Cache match error:", cacheErr);
  }

  // ── Step 3: Strip EDNS Client Subnet (ECS) to prevent client IP leakage ──
  const cleanQueryBytes = stripEcs(queryBytes);

  // ── Step 4: Forward to Upstream with Automatic Fallback ──
  const upstreamsToTry = [primaryUpstream, ...UPSTREAM_POOL.filter((u) => u !== primaryUpstream)];
  const upstreamResp = await fetchWithFallback(cleanQueryBytes, upstreamsToTry);

  if (!upstreamResp) {
    return new Response("All upstream DoH resolvers failed", { status: 502, headers: CORS_HEADERS });
  }

  const respBytes = new Uint8Array(await upstreamResp.arrayBuffer());
  const minTtl = extractMinTtl(respBytes);

  // ── Step 5: Store in Edge Cache asynchronously ──
  if (upstreamResp.status === 200 && respBytes.length > 12) {
    const responseToCache = new Response(respBytes as any, {
      status: 200,
      headers: {
        "Content-Type": "application/dns-message",
        "Cache-Control": `public, max-age=${minTtl}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKeyUrl, responseToCache));
  }

  // Return to client stamped with query ID
  const finalRespBytes = replaceTransactionId(respBytes, parsed.id);
  return new Response(finalRespBytes as any, {
    status: 200,
    headers: {
      "Content-Type": "application/dns-message",
      "Cache-Control": `public, max-age=${minTtl}`,
      "X-BlockAds-Action": "allowed",
      "X-BlockAds-Cache": "MISS",
      "X-BlockAds-Domain": parsed.name,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Forwards wire-format query to upstream pool with fast timeout & fallback
 */
async function fetchWithFallback(
  queryBytes: Uint8Array,
  upstreams: string[]
): Promise<Response | null> {
  for (const upstream of upstreams) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800); // 1.8s timeout per upstream

      const res = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/dns-message",
          "Accept": "application/dns-message",
        },
        body: queryBytes as any,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return res;
      }
    } catch (err: any) {
      console.warn(`[DoH Upstream] ${upstream} failed:`, err?.message || err);
    }
  }
  return null;
}

/**
 * Handle Google/Cloudflare style JSON DoH API with Edge Caching & ECS stripping
 */
async function handleJsonDnsQuery(
  name: string,
  url: URL,
  upstreamUrl: string,
  blocklist: Set<string>,
  blockMode: "zero" | "nxdomain",
  ctx: ExecutionContext
): Promise<Response> {
  const typeStr = url.searchParams.get("type") || "A";
  const isBlocked = isDomainBlocked(name, blocklist);

  if (isBlocked) {
    if (blockMode === "nxdomain") {
      return Response.json(
        {
          Status: 3, // NXDOMAIN
          TC: false,
          RD: true,
          RA: true,
          AD: false,
          CD: false,
          Question: [{ name, type: typeStr === "AAAA" ? 28 : 1 }],
        },
        {
          headers: {
            "Content-Type": "application/dns-json",
            "X-BlockAds-Action": "blocked",
            "Cache-Control": "public, max-age=300",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Zero Sinkhole (0.0.0.0 or ::)
    return Response.json(
      {
        Status: 0, // NOERROR
        TC: false,
        RD: true,
        RA: true,
        AD: false,
        CD: false,
        Question: [{ name, type: typeStr === "AAAA" ? 28 : 1 }],
        Answer: [
          {
            name,
            type: typeStr === "AAAA" ? 28 : 1,
            TTL: 300,
            data: typeStr === "AAAA" ? "::" : "0.0.0.0",
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/dns-json",
          "X-BlockAds-Action": "blocked",
          "Cache-Control": "public, max-age=300",
          ...CORS_HEADERS,
        },
      }
    );
  }

  // Edge Cache Check for JSON
  const cacheKeyUrl = `https://${url.host}/_dns_json_cache/${typeStr}/${encodeURIComponent(name)}`;
  const cache = caches.default;
  const cached = await cache.match(cacheKeyUrl);
  if (cached) {
    const data = await cached.json();
    return Response.json(data, {
      headers: {
        "Content-Type": "application/dns-json",
        "X-BlockAds-Action": "allowed",
        "X-BlockAds-Cache": "HIT",
        "Cache-Control": cached.headers.get("cache-control") || "public, max-age=120",
        ...CORS_HEADERS,
      },
    });
  }

  // Forward to upstream with ECS explicitly disabled (0.0.0.0/0)
  const forwardUrl = new URL(upstreamUrl);
  forwardUrl.search = url.search;
  forwardUrl.searchParams.set("edns_client_subnet", "0.0.0.0/0");

  try {
    const upstreamResp = await fetch(forwardUrl.toString(), {
      headers: { Accept: "application/dns-json" },
    });

    const data = await upstreamResp.json();
    const ttl = (data as any)?.Answer?.[0]?.TTL || 120;

    const res = Response.json(data, {
      status: upstreamResp.status,
      headers: {
        "Content-Type": "application/dns-json",
        "X-BlockAds-Action": "allowed",
        "X-BlockAds-Cache": "MISS",
        "Cache-Control": `public, max-age=${ttl}`,
        ...CORS_HEADERS,
      },
    });

    if (upstreamResp.ok) {
      ctx.waitUntil(cache.put(cacheKeyUrl, res.clone()));
    }

    return res;
  } catch (err: any) {
    return new Response(`Upstream JSON DoH error: ${err.message}`, { status: 502, headers: CORS_HEADERS });
  }
}
