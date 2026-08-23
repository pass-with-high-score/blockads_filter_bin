import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAllFilters, upsertFilter, deleteFilterByUrl } from "@/app/lib/db";
import { compileFilterList, validateFilterListURL } from "@/app/lib/compiler";
import { uploadFilter, deleteFilter } from "@/app/lib/r2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

export async function POST(req: NextRequest) {
  try {
    // ── 1. Validate Authentication ──
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return addCors(NextResponse.json(
        { status: "error", message: "Admin token is not configured on the server" },
        { status: 403 }
      ));
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return addCors(NextResponse.json(
        { status: "error", message: "Authorization header with Bearer scheme is required" },
        { status: 401 }
      ));
    }

    const token = authHeader.slice(7);
    if (token !== adminToken) {
      return addCors(NextResponse.json(
        { status: "error", message: "Invalid admin token" },
        { status: 401 }
      ));
    }

    // ── 2. Get All Filters ──
    const filters = await getAllFilters();

    // ── 3. Run Asynchronously via waitUntil ──
    waitUntil(
      (async () => {
        console.log(`[API RebuildAll] Starting background rebuild of ${filters.length} filters...`);
        for (const filter of filters) {
          console.log(`[API RebuildAll] Rebuilding '${filter.name}' (${filter.url})`);
          try {
            // Validate URL
            await validateFilterListURL(filter.url);

            // Compile
            const result = await compileFilterList(filter.name, filter.url);

            // Upload to R2
            let downloadUrl = await uploadFilter(filter.name, result.zipData);

            // Cache-buster query param
            downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;

            // Update Database
            await upsertFilter(
              filter.name,
              filter.url,
              downloadUrl,
              result.ruleCount,
              result.fileSize
            );
            console.log(`[API RebuildAll] ✓ Successfully rebuilt '${filter.name}'`);
          } catch (err: any) {
            console.error(`[API RebuildAll] ✗ Failed for ${filter.url}: ${err.message}. Removing from database.`);
            // Clean up R2 if possible
            try {
              await deleteFilter(filter.name);
            } catch (r2Err) {
              // Ignore S3 delete error
            }
            // Delete from Database
            await deleteFilterByUrl(filter.url).catch(() => { });
          }
        }
        console.log("[API RebuildAll] ✓ Background rebuild complete!");
      })()
    );

    return addCors(NextResponse.json({
      status: "success",
      message: `Started rebuilding ${filters.length} filters in the background`,
    }));
  } catch (err: any) {
    console.error("[API] RebuildAll error:", err);
    return addCors(NextResponse.json(
      { status: "error", message: `Failed to trigger rebuild: ${err.message}` },
      { status: 500 }
    ));
  }
}
