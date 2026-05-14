import { NextResponse } from "next/server";
import { listHermesSkills } from "@/lib/hermes-skills";

export async function GET() {
  try {
    return NextResponse.json(listHermesSkills());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
