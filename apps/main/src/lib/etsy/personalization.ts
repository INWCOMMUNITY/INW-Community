import {
  buyerFieldsFromEtsyQuestions,
  etsyPersonalizationWriteBody,
  prisma,
  replaceListingBuyerFields,
  type EtsyJobHandlerResult,
  type EtsyPersonalizationQuestion,
  type NormalizedListingBuyerField,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

type PersonalizationBody = {
  personalization_questions?: EtsyPersonalizationQuestion[];
};

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null | undefined,
  message: string | null | undefined
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  const transient = apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK";
  if (transient) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: apiClass,
      errorMessage: message?.trim() || "Etsy personalization request failed",
      retryAt: retryAfterMs ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: "PERMANENT",
    errorCode: apiClass || "PERSONALIZATION_FAILED",
    errorMessage: message?.trim() || "Etsy personalization request failed",
  };
}

export async function fetchEtsyListingPersonalization(input: {
  connectionId: string;
  memberId: string;
  etsyListingId: string;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<
  | { ok: true; questions: EtsyPersonalizationQuestion[] }
  | { ok: false; failure: Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> }
> {
  const res = await etsyConnectionRequest<PersonalizationBody>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/personalization`,
    query: { supports_multiple_personalization_questions: true },
    maxAttempts: 2,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!res.ok) {
    return { ok: false, failure: classifyFailure(res.class, res.retryAfterMs, res.message) };
  }
  return { ok: true, questions: res.data?.personalization_questions ?? [] };
}

async function markPersonalizationUnread(storeItemId: string): Promise<void> {
  await prisma.etsyListingLink.updateMany({
    where: { storeItemId },
    data: { personalizationAuthoritative: false },
  });
}

async function loadNormalizedFields(storeItemId: string): Promise<NormalizedListingBuyerField[]> {
  const rows = await prisma.listingBuyerField.findMany({
    where: { storeItemId },
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  });
  return rows.map((row) => ({
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    required: row.required,
    maxCharacters: row.maxCharacters,
    maxFiles: row.maxFiles,
    labelEachFile: row.labelEachFile,
    etsyQuestionId: row.etsyQuestionId,
    options: row.options.map((option) => ({
      label: option.label,
      required: option.required,
      etsyOptionId: option.etsyOptionId,
    })),
  }));
}

/**
 * Replace Etsy personalization with the INW custom options, or delete when none remain.
 * Returns null when the push succeeded.
 */
export async function pushEtsyListingPersonalization(input: {
  connectionId: string;
  memberId: string;
  shopId: string;
  etsyListingId: string;
  storeItemId: string;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> | null> {
  let fields = await loadNormalizedFields(input.storeItemId);
  const path = `/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(input.etsyListingId)}/personalization`;
  if (fields.length === 0) {
    const link = await prisma.etsyListingLink.findFirst({
      where: { storeItemId: input.storeItemId, etsyConnectionId: input.connectionId },
      select: { personalizationAuthoritative: true },
    });
    if (link && !link.personalizationAuthoritative) {
      const again = await importEtsyListingPersonalization({
        connectionId: input.connectionId,
        memberId: input.memberId,
        etsyListingId: input.etsyListingId,
        storeItemId: input.storeItemId,
        fetchImpl: input.fetchImpl,
      });
      fields = await loadNormalizedFields(input.storeItemId);
      if (again.warning) return null;
    }
  }
  if (fields.length === 0) {
    const deleted = await etsyConnectionRequest({
      connectionId: input.connectionId,
      memberId: input.memberId,
      method: "DELETE",
      path,
      maxAttempts: 1,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!deleted.ok && deleted.httpStatus !== 404) {
      return classifyFailure(deleted.class, deleted.retryAfterMs, deleted.message);
    }
    await prisma.etsyListingLink.updateMany({
      where: { storeItemId: input.storeItemId, etsyConnectionId: input.connectionId },
      data: { personalizationDirty: false, personalizationAuthoritative: true },
    });
    return null;
  }

  const written = await etsyConnectionRequest<PersonalizationBody>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "POST",
    path,
    query: { supports_multiple_personalization_questions: true },
    body: etsyPersonalizationWriteBody(fields),
    maxAttempts: 1,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!written.ok) {
    return classifyFailure(written.class, written.retryAfterMs, written.message);
  }
  const echoed = buyerFieldsFromEtsyQuestions(written.data?.personalization_questions ?? []);
  if (echoed.ok && echoed.fields.length === fields.length) {
    await replaceListingBuyerFields(prisma, input.storeItemId, echoed.fields, {
      personalizationDirty: false,
    });
  }
  await prisma.etsyListingLink.updateMany({
    where: { storeItemId: input.storeItemId, etsyConnectionId: input.connectionId },
    data: { personalizationDirty: false, personalizationAuthoritative: true },
  });
  return null;
}

/** Best-effort import. Unsupported questions are reported and do not fail the listing import. */
export async function importEtsyListingPersonalization(input: {
  connectionId: string;
  memberId: string;
  etsyListingId: string;
  storeItemId: string;
  fetchImpl?: EtsyFetch;
}): Promise<{ warning: string | null }> {
  const fetched = await fetchEtsyListingPersonalization(input);
  if (!fetched.ok) {
    await markPersonalizationUnread(input.storeItemId);
    return { warning: fetched.failure.errorMessage ?? "Could not read Etsy personalization." };
  }
  const mapped = buyerFieldsFromEtsyQuestions(fetched.questions);
  if (!mapped.ok) {
    await markPersonalizationUnread(input.storeItemId);
    return { warning: mapped.error };
  }
  if (mapped.fields.length === 0) {
    const existingCount = await prisma.listingBuyerField.count({
      where: { storeItemId: input.storeItemId },
    });
    if (existingCount > 0) return { warning: null };
  }
  await replaceListingBuyerFields(prisma, input.storeItemId, mapped.fields, {
    personalizationDirty: false,
  });
  return { warning: null };
}
