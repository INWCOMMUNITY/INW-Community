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

/** Normalize for comparison: lowercase, collapse spaces, take first 5 digits of zip. */
function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function zip5(z: string): string {
  return z.trim().replace(/\D/g, "").slice(0, 5);
}

async function validateWithNominatim(
  street: string,
  city: string,
  state: string,
  zip: string,
  logReason: (reason: string, detail?: string) => void
): Promise<{ valid: boolean; formatted?: { street: string; city: string; state: string; zip: string } }> {
  const params = new URLSearchParams({
    street,
    city,
    state,
    postalcode: zip.split("-")[0],
    country: "usa",
    format: "json",
    addressdetails: "1",
    limit: "1",
    countrycodes: "us",
  });
  const url = `https://nominatim.openstreetmap.org/search?${params}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "NorthwestCommunityApp/1.0 (contact@northwestcommunity.app)" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    logReason("nominatim_http_error", `status=${res.status}`);
    return { valid: false };
  }

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) {
    logReason("nominatim_no_results");
    return { valid: false };
  }

  const match = results[0];
  const addr = match.address ?? {};
  const addrKeys = Object.keys(addr).join(",");

  const hasStreetLevel = !!(addr.road || addr.house_number);
  const matchedCity = addr.city || addr.town || addr.village || addr.hamlet || city;
  const matchedState = addr.state || state;
  const matchedZip = (addr.postcode || zip).toString().split("-")[0];

  if (hasStreetLevel) {
    const roadParts = [addr.house_number, addr.road].filter(Boolean).join(" ");
    return {
      valid: true,
      formatted: {
        street: roadParts || street,
        city: matchedCity,
        state: normalizeState(matchedState),
        zip: matchedZip,
      },
    };
  }

  const zipMatch = zip5(matchedZip) === zip5(zip);
  const cityNorm = normalizeForMatch(matchedCity);
  const userCityNorm = normalizeForMatch(city);
  const cityMatch = cityNorm === userCityNorm || cityNorm.includes(userCityNorm) || userCityNorm.includes(cityNorm);
  const stateMatch = normalizeState(matchedState) === normalizeState(state);

  if (zipMatch && (cityMatch || stateMatch)) {
    logReason("nominatim_accepted_city_state_zip_only");
    return {
      valid: true,
      formatted: {
        street,
        city: matchedCity,
        state: normalizeState(matchedState),
        zip: matchedZip,
      },
    };
  }

  logReason("nominatim_no_road_house_number_mismatch", `addrKeys=${addrKeys}`);
  return { valid: false };
}

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

type EasyPostAddressData = {
  verifications?: { delivery?: { success?: boolean; errors?: unknown[] } };
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
};

async function easyPostVerifyOnce(
  street1: string,
  city: string,
  state: string,
  zip: string,
  key: string,
  street2?: string
): Promise<{ ok: boolean; data?: EasyPostAddressData }> {
  const basicAuth = Buffer.from(`${key}:`, "utf8").toString("base64");
  const address: { street1: string; street2?: string; city: string; state: string; zip: string; country: string } = {
    street1: street1.trim(),
    city: city.trim(),
    state: state.trim(),
    zip: zip.split("-")[0],
    country: "US",
  };
  if (street2?.trim()) address.street2 = street2.trim();
  const res = await fetch(`${EASYPOST_API_BASE}/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify({ address, verify: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as EasyPostAddressData;
  return { ok: true, data };
}

function toFormatted(data: EasyPostAddressData, fallback: { street: string; city: string; state: string; zip: string }) {
  const street1 = (data.street1 ?? fallback.street).trim();
  const street2 = (data.street2 ?? "").trim();
  const street = street2 ? `${street1}, ${street2}` : street1;
  return {
    street,
    city: data.city ?? fallback.city,
    state: data.state ? normalizeState(data.state) : fallback.state,
    zip: (data.zip ?? fallback.zip).toString().split("-")[0],
  };
}

async function validateWithEasyPost(
  street: string,
  city: string,
  state: string,
  zip: string,
  logReason: (reason: string, detail?: string) => void
): Promise<{
  valid: boolean;
  formatted?: { street: string; city: string; state: string; zip: string };
  suggestedFormatted?: { street: string; city: string; state: string; zip: string };
}> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) return { valid: false };

  const input = { street, city, state, zip: zip.split("-")[0] };
  const first = await easyPostVerifyOnce(street, city, state, zip, key);
  if (!first.ok || !first.data) {
    logReason("easypost_http_error", "first request failed");
    return { valid: false };
  }

  const data = first.data;
  const delivery = data.verifications?.delivery;
  const success = delivery?.success === true;

  if (success) {
    return {
      valid: true,
      formatted: toFormatted(data, input),
    };
  }

  logReason("easypost_verify_failed", delivery?.errors ? JSON.stringify(delivery.errors).slice(0, 150) : undefined);

  const hasCorrected =
    data.street1?.trim() && data.city?.trim() && data.state?.trim() && data.zip?.trim();
  if (hasCorrected) {
    const retry = await easyPostVerifyOnce(
      data.street1!,
      data.city!,
      data.state!,
      data.zip!,
      key,
      data.street2
    );
    if (retry.ok && retry.data?.verifications?.delivery?.success === true) {
      logReason("easypost_retry_succeeded", "second attempt with EasyPost-corrected address");
      return {
        valid: true,
        formatted: toFormatted(retry.data, input),
      };
    }
    return {
      valid: false,
      suggestedFormatted: toFormatted(data, input),
    };
  }

  return { valid: false };
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

    const body = await req.json();
    const { street, city, state, zip, requireCarrierVerification } = body as {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      requireCarrierVerification?: boolean;
    };

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

    const logReason = (reason: string, detail?: string) => {
      console.error("[validate-address]", reason, detail ?? "");
    };

    const streetTrim = street.trim();
    const cityTrim = city.trim();
    const zipTrim = zip.trim();

    const forCheckout = requireCarrierVerification === true;

    if (forCheckout && !process.env.EASYPOST_API_KEY?.trim()) {
      return NextResponse.json(
        {
          valid: false,
          error: "Shipping address verification is temporarily unavailable. Please try again later.",
        },
        { status: 503 }
      );
    }

    let result = await validateWithEasyPost(streetTrim, cityTrim, stateCode, zipTrim, logReason);
    if (!result.valid && !forCheckout) {
      result = await validateWithNominatim(streetTrim, cityTrim, stateCode, zipTrim, logReason);
    }

    if (!result.valid) {
      return NextResponse.json(
        {
          valid: false,
          error: forCheckout
            ? "This address cannot be used for shipping labels. Please check street, city, state, and ZIP (e.g. add apartment number if missing)."
            : "We couldn't verify this address. Please check the street, city, state, and ZIP code.",
          ...(result.suggestedFormatted ? { suggestedFormatted: result.suggestedFormatted } : {}),
        },
        { status: 400 }
      );
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
