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

export async function GET(req: NextRequest) {
  try {
    await ensureMigration();

    // Query all default filters with both legacy and zip URLs
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

    return addCors(NextResponse.json(results));
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
