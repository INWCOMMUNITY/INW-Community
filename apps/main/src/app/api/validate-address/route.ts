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

const SHIPPO_API = "https://api.goshippo.com";

type ShippoValidateResponse = {
  original_address?: { address_line_1?: string; address_line_2?: string; city_locality?: string; state_province?: string; postal_code?: string };
  recommended_address?: { address_line_1?: string; address_line_2?: string; city_locality?: string; state_province?: string; postal_code?: string } | null;
  analysis?: { validation_result?: { is_valid?: boolean }; address_type?: string };
};

function mapShippoAddressToFormatted(addr: ShippoValidateResponse["recommended_address"] | ShippoValidateResponse["original_address"], fallback: { street: string; city: string; state: string; zip: string }): { street: string; city: string; state: string; zip: string } {
  if (!addr) return fallback;
  const street1 = (addr.address_line_1 ?? fallback.street).trim();
  const street2 = (addr.address_line_2 ?? "").trim();
  const street = street2 ? `${street1}, ${street2}` : street1;
  return {
    street,
    city: (addr.city_locality ?? fallback.city).trim(),
    state: addr.state_province ? normalizeState(addr.state_province) : fallback.state,
    zip: (addr.postal_code ?? fallback.zip).toString().trim().replace(/\D/g, "").slice(0, 5),
  };
}

async function validateWithShippo(
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
  const key = process.env.SHIPPO_API_KEY?.trim();
  if (!key) {
    logReason("shippo_no_key");
    return { valid: false };
  }

  const input = { street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim().split("-")[0] };
  const params = new URLSearchParams({
    address_line_1: input.street,
    city_locality: input.city,
    state_province: input.state,
    postal_code: input.zip,
    country_code: "US",
  });
  if (input.street.length > 100) params.set("address_line_1", input.street.slice(0, 100));

  const res = await fetch(`${SHIPPO_API}/v2/addresses/validate?${params}`, {
    headers: {
      Authorization: `ShippoToken ${key}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    logReason("shippo_http_error", `status=${res.status} ${text.slice(0, 100)}`);
    return { valid: false };
  }

  const data = (await res.json().catch(() => null)) as ShippoValidateResponse | null;
  if (!data) {
    logReason("shippo_no_body");
    return { valid: false };
  }

  const isValid = data.analysis?.validation_result?.is_valid === true;
  const recommended = data.recommended_address && typeof data.recommended_address === "object"
    ? data.recommended_address
    : null;

  if (isValid) {
    const formatted = recommended
      ? mapShippoAddressToFormatted(recommended, input)
      : mapShippoAddressToFormatted(data.original_address, input);
    return { valid: true, formatted };
  }

  if (recommended?.address_line_1?.trim() && recommended?.city_locality?.trim() && recommended?.state_province?.trim() && recommended?.postal_code?.trim()) {
    return {
      valid: false,
      suggestedFormatted: mapShippoAddressToFormatted(recommended, input),
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

    const zipTrim = zip.trim().replace(/\D/g, "");
    if (zipTrim.length < 5) {
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

    const forCheckout = requireCarrierVerification === true;

    if (forCheckout && !process.env.SHIPPO_API_KEY?.trim()) {
      return NextResponse.json(
        {
          valid: false,
          error: "Shipping address verification is temporarily unavailable. Please try again later.",
        },
        { status: 503 }
      );
    }

    const result = await validateWithShippo(streetTrim, cityTrim, stateCode, zip.trim(), logReason);

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
