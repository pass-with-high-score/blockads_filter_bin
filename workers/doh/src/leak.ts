/**
 * BlockAds DNS Leak Check Service & Open API
 * Powered by: brianshea2/addr.tools (https://github.com/brianshea2/addr.tools)
 */

export const POWERED_BY = {
  name: "brianshea2/addr.tools",
  url: "https://github.com/brianshea2/addr.tools",
  description: "possibly useful tools for the Internet",
  author: "Brian Shea",
  repo: "https://github.com/brianshea2/addr.tools",
};

export interface ClientNetworkInfo {
  ip: string;
  country: string;
  city: string;
  region?: string;
  asn: number;
  asOrg: string;
  colo: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
}

export interface ResolverInfo {
  ip: string;
  org?: string;
  country?: string;
  city?: string;
  region?: string;
  ptr?: string | null;
  clientSubnet?: string | null;
  proto?: string;
  isSameAsClientAsn?: boolean;
}

export interface LeakAnalysisResult {
  status: "ok" | "error";
  verdict: "secure" | "leak_detected" | "ecs_leak";
  isLeak: boolean;
  hasEcsLeak: boolean;
  message: string;
  client: ClientNetworkInfo;
  resolvers: ResolverInfo[];
  detectedResolverCount: number;
  testedAt: string;
  poweredBy: typeof POWERED_BY;
}

/**
 * Generate a cryptographically random 8-character hex session ID
 * valid for addr.tools / watch
 */
export function generateSessionId(): string {
  const randomBytes = new Uint8Array(4);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate probe subdomains for a session
 */
export function getProbeDomains(sessionId: string): string[] {
  return [
    `1.${sessionId}.test.dnscheck.tools`,
    `2.${sessionId}.test.dnscheck.tools`,
    `3.${sessionId}.test.dnscheck.tools`,
    `4.${sessionId}.test.dnscheck.tools`,
  ];
}

/**
 * Extract client network info from Cloudflare request headers and CF object
 */
export function getClientNetworkInfo(req: Request): ClientNetworkInfo {
  const cf = (req as any).cf || {};
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1";

  return {
    ip,
    country: cf.country || "XX",
    city: cf.city || "Unknown City",
    region: cf.region || "",
    asn: cf.asn || 0,
    asOrg: cf.asOrganization || "Unknown ISP",
    colo: cf.colo || "EDGE",
    postalCode: cf.postalCode || "",
    latitude: cf.latitude || "",
    longitude: cf.longitude || "",
  };
}

/**
 * Convert IPv4 or IPv6 address to its reverse DNS zone string
 */
export function getReverseZone(ip: string): string | null {
  if (ip.includes(".")) {
    // IPv4
    const parts = ip.split(".");
    if (parts.length === 4) {
      return parts.reverse().join(".") + ".in-addr.arpa";
    }
  } else if (ip.includes(":")) {
    // IPv6
    try {
      const [left, right] = ip.split("::");
      const leftParts = left ? left.split(":") : [];
      const rightParts = right !== undefined ? (right ? right.split(":") : []) : null;
      let parts: string[];
      if (rightParts !== null) {
        const missing = 8 - (leftParts.length + rightParts.length);
        parts = [...leftParts, ...Array(missing).fill("0"), ...rightParts];
      } else {
        parts = leftParts;
      }
      const hex = parts.map((p) => p.padStart(4, "0")).join("");
      return hex.split("").reverse().join(".") + ".ip6.arpa";
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Enrich an IP address with Geo, ASN, Organization, and Reverse DNS (PTR)
 * Uses addr.tools APIs with graceful error handling
 */
export async function enrichIp(ip: string): Promise<ResolverInfo> {
  let org = "Unknown";
  let country = "";
  let city = "";
  let region = "";
  let ptr: string | null = null;

  // 1. Fetch Geo and Org from https://ip.addr.tools/<ip>
  try {
    const geoResp = await fetch(`https://ip.addr.tools/${encodeURIComponent(ip)}`, {
      headers: { "User-Agent": "BlockAds-DnsLeakCheck/1.0" },
      cf: { cacheTtl: 3600, cacheEverything: true } as any,
    });
    if (geoResp.ok) {
      const data: any = await geoResp.json();
      org = data.org || org;
      country = data.country || country;
      city = data.city || city;
      region = data.region || region;
    }
  } catch (err) {
    console.warn(`[LeakCheck] Geo lookup failed for ${ip}:`, err);
  }

  // 2. Fetch PTR record from https://addr.tools/dns/<reverseZone>/ptr
  const revZone = getReverseZone(ip);
  if (revZone) {
    try {
      const ptrResp = await fetch(`https://addr.tools/dns/${revZone}/ptr`, {
        headers: { "User-Agent": "BlockAds-DnsLeakCheck/1.0" },
        cf: { cacheTtl: 3600, cacheEverything: true } as any,
      });
      if (ptrResp.ok) {
        const ptrData: any = await ptrResp.json();
        const answer = ptrData?.Answer?.find((a: any) => a.type === 12);
        if (answer?.data) {
          ptr = answer.data.endsWith(".") ? answer.data.slice(0, -1) : answer.data;
        }
      }
    } catch (err) {
      console.warn(`[LeakCheck] PTR lookup failed for ${ip}:`, err);
    }
  }

  return {
    ip,
    org,
    country,
    city,
    region,
    ptr,
  };
}

/**
 * Analyze detected resolvers against client network info
 */
export function evaluateLeak(
  client: ClientNetworkInfo,
  resolvers: ResolverInfo[]
): {
  verdict: "secure" | "leak_detected" | "ecs_leak";
  isLeak: boolean;
  hasEcsLeak: boolean;
  message: string;
} {
  if (resolvers.length === 0) {
    return {
      verdict: "secure",
      isLeak: false,
      hasEcsLeak: false,
      message: "No resolvers detected yet. Run query probe to detect active resolvers.",
    };
  }

  // Check if any resolver's organization matches client ISP or is local ISP
  let isLeak = false;
  let hasEcsLeak = false;

  const clientOrgNormalized = (client.asOrg || "").toLowerCase();

  for (const r of resolvers) {
    const resolverOrgNormalized = (r.org || "").toLowerCase();
    // If the detected resolver ASN/Org matches client local ISP
    if (
      clientOrgNormalized &&
      resolverOrgNormalized &&
      (resolverOrgNormalized.includes(clientOrgNormalized) ||
        clientOrgNormalized.includes(resolverOrgNormalized))
    ) {
      r.isSameAsClientAsn = true;
      isLeak = true;
    }

    if (r.clientSubnet && !r.clientSubnet.endsWith("/0")) {
      hasEcsLeak = true;
    }
  }

  if (isLeak) {
    return {
      verdict: "leak_detected",
      isLeak: true,
      hasEcsLeak,
      message:
        "DNS Leak detected: One or more DNS queries bypassed your secure Private DNS/VPN and reached your local ISP nameservers.",
    };
  }

  if (hasEcsLeak) {
    return {
      verdict: "ecs_leak",
      isLeak: false,
      hasEcsLeak: true,
      message:
        "ECS Subnet Leak detected: Your DNS resolver advertised your client IP subnet to authoritative nameservers.",
    };
  }

  return {
    verdict: "secure",
    isLeak: false,
    hasEcsLeak: false,
    message:
      "Your DNS connection is private and secure. All queries were resolved through secure external resolvers without exposing your local ISP or IP subnet.",
  };
}
