import { NextRequest, NextResponse } from "next/server";
import { getFilterByUrl, upsertFilter } from "@/app/lib/db";
import { validateFilterListURL, deriveNameFromURL, sanitizeName, compileFilterList } from "@/app/lib/compiler";
import { uploadFilter } from "@/app/lib/r2";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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

export const dynamic = "force-dynamic";

/**
 * POST /api/build
 * Compile a filter list. Delegates heavy compilation to the Go Container Worker,
 * returning synchronous results required by the Android client and frontend.
 */
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
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("DB cache check timed out")), 3000)
        );
        const existing = await Promise.race([getFilterByUrl(url), timeoutPromise]);
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
        console.error(`[API] DB cache check failed or timed out:`, err?.message || err);
      }
    }

    // ── 2. Validate URL syntax & reachability ──
    console.log(`[API] Validating URL: ${url}`);
    try {
      await validateFilterListURL(url);
    } catch (err: any) {
      return addCors(NextResponse.json(
        { status: "error", message: `URL validation failed: ${err.message}` },
        { status: 400 }
      ));
    }

    const rawName = deriveNameFromURL(url);
    const name = sanitizeName(rawName);
    if (!name) {
      return addCors(NextResponse.json(
        { status: "error", message: "Could not derive a valid name from the provided URL" },
        { status: 400 }
      ));
    }

    // ── 3. Delegate to Go Container Worker (via Service Binding) ──
    let compilerService: any = null;
    try {
      const ctx = getCloudflareContext();
      compilerService = (ctx?.env as any)?.COMPILER_SERVICE;
    } catch {}

    if (compilerService) {
      console.log(`[API] 🚀 Delegating compilation to Cloudflare Go Container (Service Binding) for: ${url}`);
      try {
        const targetUrl = new URL(req.url);
        targetUrl.pathname = "/api/build";
        const containerReq = new Request(targetUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const containerResp = await compilerService.fetch(containerReq);
        const data = await containerResp.json();
        return addCors(NextResponse.json(data, { status: containerResp.status }));
      } catch (err: any) {
        console.error(`[API] Service Binding call failed, trying fallback:`, err);
      }
    }

    // ── 4. Fallback to direct Container Worker HTTP endpoint ──
    try {
      console.log(`[API] 🚀 Delegating compilation to Cloudflare Go Container (HTTP) for: ${url}`);
      const containerResp = await fetch("https://blockads-compiler.nguyenquangminh623.workers.dev/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await containerResp.json();
      return addCors(NextResponse.json(data, { status: containerResp.status }));
    } catch (containerErr: any) {
      console.error(`[API] Container HTTP proxy failed, falling back to local JS compile:`, containerErr);
    }

    // ── 5. Final fallback: local JS compilation (if container offline) ──
    console.log(`[API] Starting fallback JS compilation for '${name}'`);
    let result;
    try {
      result = await compileFilterList(name, url);
      if (result.ruleCount === 0) {
        throw new Error("No domain rules found in filter list");
      }
    } catch (err: any) {
      const isClientError =
        err.message?.includes("No domains, CSS rules, or scriptlets found") ||
        err.message?.includes("No domain rules found");
      return addCors(NextResponse.json(
        { status: "error", message: `Compilation failed: ${err.message}` },
        { status: isClientError ? 400 : 500 }
      ));
    }

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

    downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;
    console.log(`[API] ✓ Uploaded to R2: ${downloadUrl}`);

    try {
      await upsertFilter(name, url, downloadUrl, result.ruleCount, result.fileSize);
      console.log(`[API] ✓ DB record upserted: url=${url}`);
    } catch (err: any) {
      console.error(`[API] ⚠ DB cache upsert failed:`, err);
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
