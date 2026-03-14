import { NextRequest, NextResponse } from "next/server";
import { PREBUILT_CITIES, filterPrebuiltCities } from "@/lib/prebuilt-cities";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const filtered = search.trim() ? filterPrebuiltCities(search) : [...PREBUILT_CITIES];
  return NextResponse.json({ cities: filtered });
}
