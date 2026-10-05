import { NextRequest, NextResponse } from "next/server";
import { sql, ensureMigration } from "@/app/lib/db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function addCors(response: NextResponse): NextResponse {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function OPTIONS() {
  return addCors(new NextResponse(null, { status: 204 }));
}

export const revalidate = 3600;

// In-memory cache per worker isolate (10 minutes)
let memoryCache: { body: any; expiresAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    // 1. Check in-memory isolate cache
    if (memoryCache && Date.now() < memoryCache.expiresAt) {
      const res = NextResponse.json(memoryCache.body, {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
          "X-Worker-Cache": "MEMORY-HIT",
        },
      });
      return addCors(res);
    }

    // 2. Check Cloudflare Edge Cache API
    const cfCache = typeof caches !== "undefined" ? (caches as any).default : null;
    const cacheUrl = new URL(req.url).origin + "/api/filters/default";
    if (cfCache) {
      try {
        const cachedRes = await cfCache.match(cacheUrl);
        if (cachedRes) {
          const data = await cachedRes.json();
          memoryCache = { body: data, expiresAt: Date.now() + CACHE_TTL_MS };
          const res = NextResponse.json(data, {
            headers: {
              "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
              "X-Worker-Cache": "EDGE-HIT",
            },
          });
          return addCors(res);
        }
      } catch {
        // Ignore cache lookup error
      }
    }

    // 3. Query Database via Supabase Hyperdrive
    const rows = await sql`
      SELECT 
        COALESCE(filter_id, name) as id,
        COALESCE(display_name, name) as name,
        COALESCE(description, '') as description,
        COALESCE(is_enabled_by_default, false) as "isEnabled",
        true as "isBuiltIn",
        COALESCE(category, 'ads') as category,
        rule_count as "ruleCount",
        r2_download_link as "downloadUrl",
        url as "originalUrl"
      FROM filter_lists
      WHERE is_default = TRUE
      ORDER BY id ASC
    `;

    // Map each item to provide both modern downloadUrl and legacy individual URLs
    const results = rows.map((r: any) => {
      const zipUrl = r.downloadUrl;
      const baseR2 = zipUrl.replace(/\.zip(\?.*)?$/, "");
      const queryParam = zipUrl.includes("?") ? zipUrl.slice(zipUrl.indexOf("?")) : "";

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isEnabled: r.isEnabled,
        isBuiltIn: r.isBuiltIn,
        category: r.category,
        ruleCount: r.ruleCount,
        downloadUrl: zipUrl,
        originalUrl: r.originalUrl,
        bloomUrl: `${baseR2}.bloom${queryParam}`,
        trieUrl: `${baseR2}.trie${queryParam}`,
        cssUrl: `${baseR2}.css${queryParam}`,
        scriptletsUrl: `${baseR2}.scriptlets${queryParam}`,
      };
    });

    // Save to in-memory cache
    memoryCache = { body: results, expiresAt: Date.now() + CACHE_TTL_MS };

    const response = NextResponse.json(results, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "X-Worker-Cache": "MISS",
      },
    });

    // Save to Cloudflare Edge Cache
    if (cfCache) {
      try {
        const cacheStoreRes = new Response(JSON.stringify(results), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        });
        await cfCache.put(cacheUrl, cacheStoreRes);
      } catch {
        // Ignore cache put error
      }
    }

    return addCors(response);
  } catch (err: any) {
    console.error("[API] GET /api/filters/default failed:", err);
    return addCors(
      NextResponse.json(
        { status: "error", message: `Failed to fetch default filters: ${err.message}` },
        { status: 500 }
      )
    );
  }
}
