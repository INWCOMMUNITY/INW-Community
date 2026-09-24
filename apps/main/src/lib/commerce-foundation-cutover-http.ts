import { NextResponse } from "next/server";
import {
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  CommerceFoundationCutoverBlockedError,
  getCommerceFoundationCutoverState,
  isCommerceFoundationCutoverBlockedError,
  prisma,
} from "database";

export const INVENTORY_CUTOVER_FROZEN_HTTP = {
  error: "inventory_cutover_frozen" as const,
  retryable: true as const,
};

export function cutoverBlockedJsonResponse(): NextResponse {
  return NextResponse.json(INVENTORY_CUTOVER_FROZEN_HTTP, { status: 503 });
}

export function jsonIfCutoverBlocked(err: unknown): NextResponse | null {
  if (isCommerceFoundationCutoverBlockedError(err)) {
    return cutoverBlockedJsonResponse();
  }
  return null;
}

/** CLASS 1 HTTP gate. Call before any inventory/lifecycle mutation transaction. */
export async function gateLegacyInteractiveMutation(): Promise<NextResponse | null> {
  try {
    await assertLegacyInteractiveMutationAllowed(prisma);
    return null;
  } catch (err) {
    const blocked = jsonIfCutoverBlocked(err);
    if (blocked) return blocked;
    throw err;
  }
}

export async function resolveCommerceInventoryWriter(): Promise<
  { ok: true; route: "legacy" | "foundation" } | { ok: false; response: NextResponse }
> {
  try {
    const state = await getCommerceFoundationCutoverState(prisma);
    const route = commerceInventoryWriterRoute(state.mode);
    if (route === "blocked") {
      throw new CommerceFoundationCutoverBlockedError({ mode: state.mode, writerClass: "interactive" });
    }
    return { ok: true, route };
  } catch (err) {
    const blocked = jsonIfCutoverBlocked(err);
    if (blocked) return { ok: false, response: blocked };
    throw err;
  }
}

export async function gateInteractiveOrFoundationWriter(): Promise<NextResponse | null> {
  const writer = await resolveCommerceInventoryWriter();
  if (!writer.ok) return writer.response;
  return null;
}
