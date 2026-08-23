import { NextRequest, NextResponse } from "next/server";
import { getFilterByUrl, upsertFilter } from "@/app/lib/db";
import { validateFilterListURL, deriveNameFromURL, sanitizeName, compileFilterList } from "@/app/lib/compiler";
import { uploadFilter } from "@/app/lib/r2";

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
    const body = await req.json().catch(() => ({}));
    const { url } = body;

    if (!url || typeof url !== "string") {
      return addCors(NextResponse.json(
        { status: "error", message: "URL is required and must be a string" },
        { status: 400 }
      ));
    }

    const { searchParams } = new URL(req.url);
    const forceRebuild = searchParams.get("force") === "true";

    // ── 1. Check database cache ──
    if (!forceRebuild) {
      try {
        const existing = await getFilterByUrl(url);
        if (existing) {
          console.log(`[API] Returning cached filter for: ${url}`);
          return addCors(NextResponse.json({
            status: "success",
            downloadUrl: existing.r2DownloadLink,
            ruleCount: existing.ruleCount,
            fileSize: parseInt(existing.fileSize, 10),
          }));
        }
      } catch (err: any) {
        console.error(`[API] DB cache check failed:`, err);
      }
    }

    // ── 2. Validate URL ──
    console.log(`[API] Validating URL: ${url}`);
    try {
      await validateFilterListURL(url);
    } catch (err: any) {
      return addCors(NextResponse.json(
        { status: "error", message: `URL validation failed: ${err.message}` },
        { status: 400 }
      ));
    }

    // ── 3. Compile filter list ──
    const rawName = deriveNameFromURL(url);
    const name = sanitizeName(rawName);
    if (!name) {
      return addCors(NextResponse.json(
        { status: "error", message: "Could not derive a valid name from the provided URL" },
        { status: 400 }
      ));
    }

    console.log(`[API] Starting compilation for '${name}'`);
    let result;
    try {
      result = await compileFilterList(name, url);
      if (result.ruleCount === 0) {
        throw new Error("No domain rules found in filter list");
      }
    } catch (err: any) {
      return addCors(NextResponse.json(
        { status: "error", message: `Compilation failed: ${err.message}` },
        { status: 500 }
      ));
    }

    // ── 4. Upload to Cloudflare R2 ──
    console.log(`[API] Uploading ${name}.zip to R2 (${result.fileSize} bytes)`);
    let downloadUrl;
    try {
      downloadUrl = await uploadFilter(name, result.zipData);
    } catch (err: any) {
      return addCors(NextResponse.json(
        { status: "error", message: `R2 upload failed: ${err.message}` },
        { status: 500 }
      ));
    }

    // Add cache-buster to download URL
    downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;
    console.log(`[API] ✓ Uploaded to R2: ${downloadUrl}`);

    // ── 5. Cache record in PostgreSQL ──
    try {
      await upsertFilter(name, url, downloadUrl, result.ruleCount, result.fileSize);
      console.log(`[API] ✓ DB record upserted: url=${url}`);
    } catch (err: any) {
      console.error(`[API] ⚠ DB cache upsert failed (upload succeeded):`, err);
    }

    return addCors(NextResponse.json({
      status: "success",
      downloadUrl,
      ruleCount: result.ruleCount,
      fileSize: result.fileSize,
    }));
  } catch (err: any) {
    console.error("[API] Unexpected build error:", err);
    return addCors(NextResponse.json(
      { status: "error", message: `An unexpected error occurred: ${err.message}` },
      { status: 500 }
    ));
  }
}
