import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

type Ac = { long_name: string; short_name: string; types: string[] };

function getComponent(components: Ac[], ...types: string[]): string {
  const c = components.find((a) => types.some((t) => a.types.includes(t)));
  return c ? (types.includes("administrative_area_level_1") ? c.short_name : c.long_name) : "";
}

/**
 * GET ?placeId=... - Fetch place details and return parsed address for shipping.
 * Returns { street, city, state, zip } or { error }.
 */
export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim();
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  if (!GOOGLE_PLACES_KEY) {
    return NextResponse.json({ error: "Address lookup not configured" }, { status: 503 });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    url.searchParams.set("fields", "address_components");

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    const data = (await res.json()) as {
      status?: string;
      result?: { address_components?: Ac[] };
    };

    if (data.status !== "OK" || !data.result?.address_components) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    const comp = data.result.address_components;
    const streetNumber = getComponent(comp, "street_number");
    const route = getComponent(comp, "route");
    const street = [streetNumber, route].filter(Boolean).join(" ").trim() || getComponent(comp, "subpremise") || "";
    const city =
      getComponent(comp, "locality") ||
      getComponent(comp, "sublocality") ||
      getComponent(comp, "sublocality_level_1") ||
      getComponent(comp, "administrative_area_level_2");
    const state = getComponent(comp, "administrative_area_level_1");
    const zip = getComponent(comp, "postal_code");

    return NextResponse.json({
      street: street || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: zip || undefined,
    });
  } catch {
    return NextResponse.json({ error: "Address lookup failed" }, { status: 500 });
  }
}
