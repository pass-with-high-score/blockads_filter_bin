import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function addCors(response: NextResponse | Response): Response {
  const res = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.headers.set(key, value);
  });
  return res;
}

export async function OPTIONS() {
  return addCors(new NextResponse(null, { status: 204 }));
}

export const dynamic = "force-dynamic";

/**
 * GET & POST /api/combine
 * Combines multiple filter lists into a single plain-text filter subscription
 * (adblock, domains, or hosts format).
 */
async function handleCombine(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const search = url.search;

    let compilerService: any = null;
    try {
      const ctx = getCloudflareContext();
      compilerService = (ctx?.env as any)?.COMPILER_SERVICE;
    } catch {}

    const isGet = req.method === "GET";
    const body = isGet ? undefined : await req.text();

    // 1. Try Service Binding
    if (compilerService) {
      try {
        const targetUrl = new URL(req.url);
        targetUrl.pathname = "/api/combine";
        const containerReq = new Request(targetUrl.toString(), {
          method: req.method,
          headers: req.headers,
          body,
        });
        const containerResp = await compilerService.fetch(containerReq);
        return addCors(containerResp);
      } catch (err: any) {
        console.error(`[Combine API] Service Binding error, falling back:`, err);
      }
    }

    // 2. Direct Container Worker HTTP fallback
    const containerBase = process.env.COMPILER_CONTAINER_URL || "https://complier.pwhs.app";
    const containerResp = await fetch(`${containerBase}/api/combine${search}`, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
      },
      body,
    });

    return addCors(containerResp);
  } catch (err: any) {
    console.error("[Combine API] Error:", err);
    return addCors(
      NextResponse.json(
        { status: "error", message: `Failed to combine filters: ${err.message}` },
        { status: 500 }
      )
    );
  }
}

export async function GET(req: NextRequest) {
  return handleCombine(req);
}

export async function POST(req: NextRequest) {
  return handleCombine(req);
}
