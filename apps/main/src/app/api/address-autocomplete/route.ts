import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

/**
 * GET ?input=... - Proxy to Google Place Autocomplete (addresses only).
 * Returns { suggestions: { description, placeId }[] } or { error }.
 * If no API key, returns { suggestions: [] } so the app can still use manual entry.
 */
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("input")?.trim();
  if (!input || input.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  if (!GOOGLE_PLACES_KEY) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", input);
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    const data = (await res.json()) as {
      status?: string;
      predictions?: Array<{ description?: string; place_id?: string }>;
    };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return NextResponse.json({ suggestions: [] });
    }

    const suggestions = (data.predictions ?? []).map((p) => ({
      description: p.description ?? "",
      placeId: p.place_id ?? "",
    }));

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
