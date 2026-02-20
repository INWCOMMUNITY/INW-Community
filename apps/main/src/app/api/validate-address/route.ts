import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 2000;

function normalizeState(s: string): string {
  const upper = s.trim().toUpperCase();
  if (US_STATES[upper]) return upper;
  const entry = Object.entries(US_STATES).find(
    ([, name]) => name.toUpperCase() === upper
  );
  return entry ? entry[0] : upper;
}

async function validateWithNominatim(
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<{ valid: boolean; formatted?: { street: string; city: string; state: string; zip: string } }> {
  const query = `${street}, ${city}, ${state} ${zip}, USA`;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    limit: "1",
    countrycodes: "us",
  })}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "NorthwestCommunityApp/1.0 (contact@northwestcommunity.app)" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return { valid: false };

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return { valid: false };

  const match = results[0];
  const addr = match.address ?? {};

  if (!addr.road && !addr.house_number) return { valid: false };

  const matchedCity = addr.city || addr.town || addr.village || addr.hamlet || city;
  const matchedState = addr.state || state;
  const matchedZip = addr.postcode || zip;

  const roadParts = [addr.house_number, addr.road].filter(Boolean).join(" ");

  return {
    valid: true,
    formatted: {
      street: roadParts || street,
      city: matchedCity,
      state: normalizeState(matchedState),
      zip: matchedZip.split("-")[0],
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = Date.now();
    const lastRequest = rateLimitMap.get(session.user.id) ?? 0;
    if (now - lastRequest < RATE_LIMIT_MS) {
      return NextResponse.json(
        { valid: false, error: "Please wait a moment before trying again." },
        { status: 429 }
      );
    }
    rateLimitMap.set(session.user.id, now);

    if (rateLimitMap.size > 10000) {
      const cutoff = now - 60_000;
      for (const [key, ts] of rateLimitMap) {
        if (ts < cutoff) rateLimitMap.delete(key);
      }
    }

    const { street, city, state, zip } = await req.json();

    if (!street || !city || !state || !zip) {
      return NextResponse.json(
        { valid: false, error: "All address fields are required." },
        { status: 400 }
      );
    }

    if (typeof street !== "string" || street.length > 200 ||
        typeof city !== "string" || city.length > 100 ||
        typeof state !== "string" || state.length > 50 ||
        typeof zip !== "string" || zip.length > 15) {
      return NextResponse.json(
        { valid: false, error: "Invalid input." },
        { status: 400 }
      );
    }

    const stateCode = normalizeState(state);
    if (!US_STATES[stateCode]) {
      return NextResponse.json({
        valid: false,
        error: "Please enter a valid US state (e.g. WA, CA, NY).",
      }, { status: 400 });
    }

    if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) {
      return NextResponse.json({
        valid: false,
        error: "Please enter a valid 5-digit ZIP code.",
      }, { status: 400 });
    }

    const result = await validateWithNominatim(
      street.trim(),
      city.trim(),
      stateCode,
      zip.trim()
    );

    if (!result.valid) {
      return NextResponse.json({
        valid: false,
        error: "We couldn't verify this address. Please check the street, city, state, and ZIP code.",
      }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      formatted: result.formatted,
    });
  } catch (e) {
    console.error("[validate-address]", e);
    return NextResponse.json(
      { valid: false, error: "Address verification failed. Please try again." },
      { status: 500 }
    );
  }
}
