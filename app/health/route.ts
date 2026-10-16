import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "1.0.2",
    time: new Date().toISOString(),
  });
}
