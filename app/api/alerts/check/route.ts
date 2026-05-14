import { NextResponse } from "next/server";

export async function POST() {
  try {
    return NextResponse.json({
      results: [],
      checkedAt: Date.now(),
      message: "No alert rules configured",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
