import { NextRequest, NextResponse } from "next/server";
import { getFiltersPaginated, getFilterByUrl, deleteFilterByUrl } from "@/app/lib/db";
import { deleteFilter } from "@/app/lib/r2";

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

// ── GET /api/filters (List Filters) ──
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const search = searchParams.get("search") || undefined;
    const sort = searchParams.get("sort") || undefined;
    const order = searchParams.get("order") || undefined;

    const { data, total } = await getFiltersPaginated(page, limit, search, sort, order);
    const totalPages = Math.ceil(total / limit);

    return addCors(NextResponse.json({
      data,
      meta: {
        currentPage: page,
        limit,
        totalRecords: total,
        totalPages,
      },
    }));
  } catch (err: any) {
    console.error("[API] GET /api/filters failed:", err);
    return addCors(NextResponse.json(
      { status: "error", message: `Failed to fetch filters: ${err.message}` },
      { status: 500 }
    ));
  }
}

// ── DELETE /api/filters (Delete Filter) ──
export async function DELETE(req: NextRequest) {
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

    // ── 2. Check query parameter ──
    const { searchParams } = new URL(req.url);
    const filterUrl = searchParams.get("url");

    if (!filterUrl) {
      return addCors(NextResponse.json(
        { status: "error", message: "Query parameter 'url' is required" },
        { status: 400 }
      ));
    }

    // ── 3. Find and delete filter ──
    const filter = await getFilterByUrl(filterUrl);
    if (!filter) {
      return addCors(NextResponse.json(
        { status: "error", message: `Filter list not found for URL: ${filterUrl}` },
        { status: 404 }
      ));
    }

    // Delete from Cloudflare R2
    try {
      await deleteFilter(filter.name);
      console.log(`[API] Deleted ${filter.name}.zip from R2`);
    } catch (err: any) {
      console.warn(`[API] R2 delete warning for '${filter.name}':`, err.message);
    }

    // Delete from PostgreSQL
    await deleteFilterByUrl(filterUrl);
    console.log(`[API] Deleted DB record for: ${filterUrl}`);

    return addCors(NextResponse.json({
      status: "success",
      message: "Filter deleted",
    }));
  } catch (err: any) {
    console.error("[API] DELETE /api/filters failed:", err);
    return addCors(NextResponse.json(
      { status: "error", message: `Failed to delete filter: ${err.message}` },
      { status: 500 }
    ));
  }
}
