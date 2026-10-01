import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

export type EtsyReadinessState = "ready_to_ship" | "made_to_order";

type EtsyReadinessStateDefinition = {
  readiness_state_id?: number | string;
  readiness_state?: string;
};

export type ResolveEtsyReadinessStateResult =
  | { ok: true; readinessStateId: string; readinessState: EtsyReadinessState; created: boolean }
  | { ok: false; message: string; code: "MISSING" | "PROVIDER_ERROR" | "AUTH" };

function preferredReadinessState(input: {
  whenMade?: string | null;
  inventoryTracking?: string | null;
}): EtsyReadinessState {
  if (input.whenMade === "made_to_order" || input.inventoryTracking === "made_to_order") {
    return "made_to_order";
  }
  return "ready_to_ship";
}

function parseDefinitions(data: unknown): Array<{ id: string; state: EtsyReadinessState }> {
  const root = data as { results?: unknown } | null;
  const rows = Array.isArray(root?.results)
    ? (root!.results as EtsyReadinessStateDefinition[])
    : Array.isArray(data)
      ? (data as EtsyReadinessStateDefinition[])
      : [];
  const out: Array<{ id: string; state: EtsyReadinessState }> = [];
  for (const row of rows) {
    const id = String(row.readiness_state_id ?? "").trim();
    const state = row.readiness_state === "made_to_order" ? "made_to_order" : "ready_to_ship";
    if (/^\d+$/.test(id)) out.push({ id, state });
  }
  return out;
}

/**
 * Etsy now requires readiness_state_id (processing profile) for physical listings.
 * Prefer an existing shop profile matching made-to-order vs ready-to-ship; create one if needed.
 */
export async function resolveEtsyReadinessStateId(input: {
  connectionId: string;
  memberId: string;
  shopId: string;
  whenMade?: string | null;
  inventoryTracking?: string | null;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<ResolveEtsyReadinessStateResult> {
  const preferred = preferredReadinessState({
    whenMade: input.whenMade,
    inventoryTracking: input.inventoryTracking,
  });

  const listRes = await etsyConnectionRequest<{
    results?: EtsyReadinessStateDefinition[];
  }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(input.shopId)}/readiness-state-definitions`,
    maxAttempts: 2,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!listRes.ok) {
    if (listRes.class === "AUTH" || listRes.class === "NOT_CONFIGURED") {
      return { ok: false, code: "AUTH", message: listRes.message };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: listRes.message || "Could not load Etsy processing profiles",
    };
  }

  const existing = parseDefinitions(listRes.data);
  const matched =
    existing.find((row) => row.state === preferred) ?? existing[0] ?? null;
  if (matched) {
    return {
      ok: true,
      readinessStateId: matched.id,
      readinessState: matched.state,
      created: false,
    };
  }

  const createRes = await etsyConnectionRequest<{
    readiness_state_id?: number | string;
    readiness_state?: string;
  }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "POST",
    path: `/shops/${encodeURIComponent(input.shopId)}/readiness-state-definitions`,
    body: {
      readiness_state: preferred,
      min_processing_time: preferred === "made_to_order" ? 3 : 1,
      max_processing_time: preferred === "made_to_order" ? 5 : 3,
      processing_time_unit: "days",
    },
    bodyEncoding: "form",
    maxAttempts: 1,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!createRes.ok || !createRes.data) {
    if (createRes.class === "AUTH") {
      return {
        ok: false,
        code: "AUTH",
        message:
          "Etsy needs shops_w to create a processing profile. Reconnect Etsy in Connection Settings, or add a Processing Profile in Etsy Shop Manager.",
      };
    }
    return {
      ok: false,
      code: "MISSING",
      message:
        createRes.message ||
        "Add a Processing Profile in Etsy Shop Manager (Shipping settings), then try List on Etsy again.",
    };
  }

  const createdId = String(createRes.data.readiness_state_id ?? "").trim();
  if (!/^\d+$/.test(createdId)) {
    return {
      ok: false,
      code: "MISSING",
      message: "Etsy created a processing profile without a readiness_state_id",
    };
  }
  return {
    ok: true,
    readinessStateId: createdId,
    readinessState: preferred,
    created: true,
  };
}
