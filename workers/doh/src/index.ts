/**
 * BlockAds Private Serverless DNS-over-HTTPS (DoH) Worker
 * Real-time Adblocking & Tracking Sinkhole on Cloudflare Edge
 */

import {
  parseDnsQuery,
  createBlockedResponse,
  base64UrlToUint8Array,
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
        version: "1.0.0",
        upstream: env.UPSTREAM_DOH || "https://1.1.1.1/dns-query",
        blockMode: env.BLOCK_MODE || "zero",
        time: new Date().toISOString(),
      });
    }

    // ── 2. Landing / Setup Dashboard ──
    if (pathname === "/" || pathname === "/setup") {
      const blocklistUrl = env.DEFAULT_BLOCKLIST_URL || "https://raw.githubusercontent.com/bigdargon/hostsVN/master/hosts";
      const blocklist = await getBlocklist(blocklistUrl, env.R2_BUCKET);
      const html = renderDashboardHtml(
        url.host,
        env.UPSTREAM_DOH || "https://1.1.1.1/dns-query",
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
  const upstreamUrl = env.UPSTREAM_DOH || "https://1.1.1.1/dns-query";
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
    return handleJsonDnsQuery(jsonName, url, upstreamUrl, blocklist, blockMode);
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
      } catch (err) {
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

  // ── Adblocking Inspection ──
  const isBlocked = isDomainBlocked(parsed.name, blocklist);

  if (isBlocked) {
    // Generate synthesized sinkhole response
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

  // ── Forward Allowed Query to Upstream DoH ──
  try {
    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "Accept": "application/dns-message",
      },
      body: queryBytes as any,
    });

    if (!upstreamResp.ok) {
      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        headers: { "Content-Type": "application/dns-message", ...CORS_HEADERS },
      });
    }

    const respBytes = await upstreamResp.arrayBuffer();
    return new Response(respBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/dns-message",
        "Cache-Control": upstreamResp.headers.get("cache-control") || "public, max-age=120",
        "X-BlockAds-Action": "allowed",
        "X-BlockAds-Domain": parsed.name,
        ...CORS_HEADERS,
      },
    });
  } catch (err: any) {
    console.error("[DoH Worker] Upstream forward error:", err);
    return new Response(`Upstream DoH error: ${err.message}`, { status: 502 });
  }
}

/**
 * Handle Google/Cloudflare style JSON DoH API
 */
async function handleJsonDnsQuery(
  name: string,
  url: URL,
  upstreamUrl: string,
  blocklist: Set<string>,
  blockMode: "zero" | "nxdomain"
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

  // Forward to upstream JSON endpoint (Cloudflare 1.1.1.1)
  const forwardUrl = new URL(upstreamUrl);
  forwardUrl.search = url.search;
  const upstreamResp = await fetch(forwardUrl.toString(), {
    headers: { Accept: "application/dns-json" },
  });

  const data = await upstreamResp.json();
  return Response.json(data, {
    status: upstreamResp.status,
    headers: {
      "Content-Type": "application/dns-json",
      "X-BlockAds-Action": "allowed",
      ...CORS_HEADERS,
    },
  });
}
