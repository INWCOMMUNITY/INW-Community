import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

/**
 * Single Prisma client: **TCP** to Postgres (Neon pooled `DATABASE_URL`, Railway, Vercel Node, local).
 * We do not use `@prisma/adapter-neon` / `@neondatabase/serverless` here — that stack uses WebSockets
 * and breaks in many Node hosts (`WebSocket … undefined`, `fetch failed`).
 */
const isDev = process.env.NODE_ENV === "development";

const logOpt: ("query" | "error" | "warn")[] = isDev
  ? ["query", "error", "warn"]
  : ["error"];

function prismaHasShippingOptionCost(client: PrismaClient): boolean {
  const rdm = (
    client as {
      _runtimeDataModel?: { models?: Record<string, { fields?: Record<string, unknown> | unknown[] }> };
    }
  )._runtimeDataModel;
  const fields = rdm?.models?.ShippingOption?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) {
    return fields.some((f) => f && typeof f === "object" && (f as { name?: string }).name === "shippingCostCents");
  }
  return "shippingCostCents" in fields;
}

const prismaClient = (() => {
  const existing = globalThis.prisma;
  // After adding models/fields, a cached PrismaClient from before `prisma generate`
  // is missing delegates or columns — recreate it.
  if (
    existing &&
    typeof (existing as { shippingOption?: unknown }).shippingOption !== "undefined" &&
    typeof (existing as { listingFeedCollection?: unknown }).listingFeedCollection !== "undefined" &&
    typeof (existing as { cronJobLock?: unknown }).cronJobLock !== "undefined" &&
    typeof (existing as { storeVariant?: unknown }).storeVariant !== "undefined" &&
    typeof (existing as { inventoryState?: unknown }).inventoryState !== "undefined" &&
    typeof (existing as { inventoryEvent?: unknown }).inventoryEvent !== "undefined" &&
    typeof (existing as { checkoutAttempt?: unknown }).checkoutAttempt !== "undefined" &&
    typeof (existing as { inventoryReservation?: unknown }).inventoryReservation !== "undefined" &&
    typeof (existing as { stripeEventEvidence?: unknown }).stripeEventEvidence !== "undefined" &&
    typeof (existing as { refundOperation?: unknown }).refundOperation !== "undefined" &&
    typeof (existing as { transferOperation?: unknown }).transferOperation !== "undefined" &&
    typeof (existing as { commerceFoundationCutover?: unknown }).commerceFoundationCutover !== "undefined" &&
    typeof (existing as { shopifyConnection?: unknown }).shopifyConnection !== "undefined" &&
    typeof (existing as { shopifyOAuthState?: unknown }).shopifyOAuthState !== "undefined" &&
    typeof (existing as { shopifyListingLink?: unknown }).shopifyListingLink !== "undefined" &&
    typeof (existing as { shopifyVariantMap?: unknown }).shopifyVariantMap !== "undefined" &&
    typeof (existing as { shopifyProviderEvidence?: unknown }).shopifyProviderEvidence !== "undefined" &&
    typeof (existing as { shopifySyncJob?: unknown }).shopifySyncJob !== "undefined" &&
    prismaHasShippingOptionCost(existing)
  ) {
    return existing;
  }
  if (existing) {
    void existing.$disconnect().catch(() => {});
  }

  const baseLog =
    isDev
      ? (["query", "error", "warn"] as const)
      : ([
          { emit: "event" as const, level: "error" as const },
        ] as const);

  const options = isDev
    ? { log: logOpt }
    : {
        log: baseLog,
      };

  const client = new PrismaClient(options as any);

  const firstLog = baseLog[0];
  if (!isDev && Array.isArray(baseLog) && typeof firstLog === "object" && firstLog !== null && "emit" in firstLog && firstLog.emit === "event") {
    (client as any).$on("error", (e: unknown) => {
      let msg = "Prisma error (no details)";
      if (e != null && typeof e === "object" && "message" in e) {
        const m = (e as { message: unknown }).message;
        if (m != null && String(m).trim() !== "") msg = String(m);
      } else if (e != null && typeof e !== "object") {
        const s = String(e);
        if (s !== "undefined") msg = s;
      }
      console.error("[prisma:error]", msg);
    });
  }

  return client;
})();

export const prisma = prismaClient;
if (process.env.NODE_ENV !== "production") globalThis.prisma = prismaClient;

export * from "@prisma/client";
export {
  closeOrDeleteMemberAccount,
  countMemberDurableCommerceEvidence,
  durableCommerceFinancialNone,
} from "./member-account-lifecycle";
export type {
  MemberAccountLifecycleResult,
  MemberDurableCommerceEvidenceCounts,
} from "./member-account-lifecycle";
export {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  CommerceFoundationCutoverBlockedError,
  CommerceFoundationCutoverStateError,
  CommerceFoundationWriterModeError,
  INVENTORY_CUTOVER_FROZEN_ERROR,
  assertFoundationInventoryWriterAllowed,
  assertLegacyDrainFinalizerAllowed,
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  durableStartedAtFromUnixSeconds,
  getCommerceFoundationCutoverState,
  isCommerceFoundationCutoverBlockedError,
  isFoundationInventoryWriterMode,
} from "./commerce-foundation-cutover";
export type { CommerceFoundationCutoverState, CommerceFoundationCutoverWriterClass } from "./commerce-foundation-cutover";
export {
  applyTrackedMarketplaceSale,
  FoundationInsufficientAvailabilityError,
  FoundationInventoryError,
  FoundationMissingStateError,
  FoundationReservationError,
  FoundationRestockReviewError,
  convertReservation,
  holdTrackedReservation,
  lockCheckoutAttemptForUpdate,
  lockStoreItemForUpdate,
  MARKETPLACE_ORDER_CAUSE,
  projectStoreItemQuantity,
  releaseReservation,
  restockTrackedVariant,
  setTrackedOnHand,
  SHOPIFY_SOURCE_SYSTEM,
  trackedAvailable,
} from "./commerce-foundation-inventory";
export {
  FoundationVariantResolutionError,
  resolveCheckoutVariant,
  resolveMatrixVariant,
  resolveSimpleDefaultVariant,
} from "./commerce-foundation-variant-resolution";
export {
  applyFoundationSellerQuantitySets,
  assertFoundationMatrixStructureUnchanged,
  assertNoStructuralVariantChange,
  endFoundationListing,
  markFoundationListingSold,
  provisionNativeFoundationListing,
  relistFoundationListing,
  restockFoundationOrderLine,
} from "./commerce-foundation-listing";
export {
  canonicalCheckoutVariantIdentity,
  checkoutPrepareAdvisoryLockKeys,
  classifyStripeSessionCreateFailure,
  expireFoundationCheckoutAttempt,
  failCheckoutAttemptAndRelease,
  finalizeFoundationCheckoutPayment,
  FOUNDATION_MTO_PURCHASE_CAP,
  foundationAttemptExpiryDecision,
  FoundationCheckoutNotConvertibleError,
  FoundationCheckoutReuseError,
  hashFoundationCart,
  markCheckoutAttemptSessionOpen,
  markCheckoutAttemptSessionUnknown,
  newCheckoutIdempotencyKey,
  prepareFoundationCheckout,
  stripeCheckoutRequestOptions,
} from "./commerce-foundation-checkout";
export type { FoundationCheckoutSellerOrderInput } from "./commerce-foundation-checkout";
export {
  applyFoundationCheckoutProviderObservation,
  FOUNDATION_CHECKOUT_HOLD_MS,
  FOUNDATION_CHECKOUT_RECONCILIATION_BATCH_SIZE,
  foundationCheckoutReconciliationCronAllowed,
  hostedCheckoutUrlIfActive,
  listFoundationCheckoutReconciliationCandidates,
} from "./commerce-foundation-checkout-reconciliation";
export type {
  FoundationCheckoutObservationResult,
  FoundationCheckoutProviderObservation,
  FoundationCheckoutReconciliationClassification,
} from "./commerce-foundation-checkout-reconciliation";
export {
  FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE,
  listFoundationReturnSettlementCandidates,
} from "./commerce-foundation-return-reconciliation";
export type { FoundationReturnSettlementCandidate } from "./commerce-foundation-return-reconciliation";
export { reconcileStoreItemQuantities, verifyFoundationListingHealth } from "./commerce-foundation-health";
export {
  beginFoundationTransferAttempt,
  classifyFoundationFailedTransferRetryability,
  classifyStripeTransferFailure,
  COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER,
  completeFoundationSellerPayoutLedger,
  completeFoundationStoreOrderPaid,
  ensureFoundationStorefrontRefundOperation,
  ensureFoundationTransferIntent,
  ensureFoundationTransferIntents,
  evaluateFoundationPayoutRefundDisposition,
  FOUNDATION_PAYOUT_AUTO_RETRY_OPERATION_STATUSES,
  FOUNDATION_PAYOUT_UNRESOLVED_OPERATION_STATUSES,
  FOUNDATION_SELLER_PAYOUT_ELIGIBLE_ORDER_STATUSES,
  FOUNDATION_STOREFRONT_REFUND_IDEMPOTENCY_PREFIX,
  FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS,
  FOUNDATION_TRANSFER_PROCESSING_STALE_MS,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
  FOUNDATION_COMPATIBILITY_TRANSFER_ID_CONFLICT,
  foundationSellerPayoutRecoveryWhere,
  foundationStorefrontRefundIdempotencyKey,
  foundationSucceededPayoutLocalRepairOutstanding,
  foundationSucceededPayoutWhere,
  foundationTransferIdempotencyKey,
  isFoundationSucceededPayoutLocalRepairEligible,
  listFoundationSucceededPayoutLocalRepairAttemptIds,
  FoundationRefundIntentConflictError,
  FoundationTransferIntentConflictError,
  FoundationTransferOperatorRequiredError,
  FoundationTransferRefundBlockedError,
  FoundationTransferResetError,
  isFoundationBuyerSaleCompleteStatus,
  isFoundationSameKeyReplayAllowed,
  isFoundationSellerPayoutEligibleOrderStatus,
  isPermanentFoundationNonconvertibleError,
  isRetryableFoundationCommerceError,
  listFoundationPayoutReconciliation,
  lockFoundationPayoutOutForRefund,
  markFoundationAttemptUnfulfillable,
  markFoundationAttemptUnfulfillableInTx,
  markFoundationStoreOrderPaidAfterConvert,
  OPERATOR_RESET_FOR_RETRY,
  ORDER_REFUNDED_BEFORE_TRANSFER,
  persistFoundationRefundOutcome,
  persistFoundationRefundSuccess,
  persistFoundationTransferOutcome,
  persistFoundationTransferSuccess,
  resetFoundationTransferForOperatorRetry,
} from "./commerce-foundation-transfer";
export type {
  CompleteFoundationPaidOrderInput,
  FoundationFailedTransferRetryability,
  FoundationPayoutOperationView,
  FoundationPayoutRefundDisposition,
  FoundationPayoutRefundLockResult,
  FoundationStorefrontRefundBeginAction,
  FoundationStorefrontRefundIntentInput,
  FoundationTransferBeginAction,
  FoundationTransferIntentInput,
  FoundationTransferResetErrorCode,
  MarkFoundationStoreOrderPaidInput,
} from "./commerce-foundation-transfer";
export {
  FOUNDATION_RETURN_ENTITLEMENT_IDEMPOTENCY_PREFIX,
  FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
  FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
  FoundationReturnEntitlementCausalError,
  FoundationReturnEntitlementIntentConflictError,
  beginFoundationReturnEntitlementAttempt,
  completeFoundationSellerReturnEntitlementLedger,
  foundationReturnEntitlementIdempotencyKey,
  persistFoundationReturnEntitlementOutcome,
  persistFoundationReturnEntitlementPreflightFailure,
  persistFoundationReturnEntitlementSuccess,
  prepareFoundationReturnSellerSettlement,
  evaluateFoundationReturnEntitlementResetEligibility,
  getFoundationReturnEntitlementAdminState,
  resetFoundationSellerReturnEntitlementForRetry,
} from "./commerce-foundation-return-entitlement";
export type {
  FoundationReturnEntitlementBeginAction,
  FoundationReturnEntitlementPreflightFailureResult,
  FoundationReturnEntitlementProviderSnapshot,
  PrepareFoundationReturnSellerSettlementInput,
  PrepareFoundationReturnSellerSettlementResult,
  FoundationReturnEntitlementAdminState,
  FoundationReturnEntitlementResetBlockedReason,
  FoundationReturnEntitlementResetEligibility,
  FoundationReturnEntitlementResetResult,
} from "./commerce-foundation-return-entitlement";
export {
  FOUNDATION_RETURN_LEDGER_TYPE,
  classifySellerBalanceLedgerEvidence,
  isFoundationReturnLedgerAnomaly,
} from "./commerce-foundation-return-ledger-evidence";
export type {
  FoundationReturnLedgerEvidenceClassification,
  FoundationReturnLedgerEvidenceResult,
  FoundationReturnLedgerEvidenceRow,
  FoundationReturnLedgerExactExpectation,
} from "./commerce-foundation-return-ledger-evidence";
export {
  HISTORICAL_REFUND_COMPATIBILITY_MANIFEST_VERSION,
  analyzeHistoricalRefundCompatibility,
  classifyHistoricalRefundCompatibility,
  evaluateHistoricalRefundAlreadySettled,
  hashHistoricalRefundCompatibilityRecords,
  isHistoricalRefundAlreadySettled,
  isHistoricalRefundCompatibilityReviewRequired,
  isHistoricalRefundFinancialNoOp,
  isHistoricalRefundOrdinaryFoundationFlow,
  loadHistoricalRefundCompatibilityEvidence,
  loadHistoricalRefundRuntimeDecision,
  maskStripeTransferId as maskHistoricalRefundStripeTransferId,
  mustBlockHistoricalSellerFinancialMutation,
  hasHistoricalLegacyReturnSettlementFingerprint,
  hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps,
  isCanonicalFoundationOpOnlyAnomalyReasons,
  resolveHistoricalRefundRuntimeDecision,
  runHistoricalExternalRefundRestockBranch,
  shouldSkipSellerLedgerDebitForHistoricalRefund,
} from "./foundation/historical-refund-compatibility";
export type {
  HistoricalExternalRefundRestockBranchResult,
  HistoricalRefundCompatibilityClassification,
  HistoricalRefundCompatibilityEvidence,
  HistoricalRefundCompatibilityManifest,
  HistoricalRefundCompatibilityReasonCode,
  HistoricalRefundCompatibilityRecord,
  HistoricalRefundLedgerRow,
  HistoricalRefundRuntimeAction,
  HistoricalRefundRuntimeDecision,
  HistoricalRefundTransferOperationEvidence,
} from "./foundation/historical-refund-compatibility";
export {
  HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
  HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES,
  HISTORICAL_TO_BACKFILL_MANIFEST_VERSION,
  analyzeHistoricalTransferOperationBackfill,
  applyHistoricalTransferOperationBackfill,
  buildHistoricalToPreviewManifest,
  canReconstructHistoricalSellerTransferCents,
  classifyHistoricalTransferOperationCandidate,
  hashHistoricalToCandidates,
  loadHistoricalToCandidateEvidence,
  maskStripeTransferId,
  reconstructHistoricalSellerTransferCents,
  buildExpectedHistoricalTransferOperation,
  isExactHistoricalTransferOperationMatch,
} from "./foundation/historical-transfer-operation-backfill";
export type {
  AnalyzeHistoricalToBackfillInput,
  ApplyHistoricalToBackfillInput,
  ApplyHistoricalToBackfillResult,
  HistoricalSaleLedgerEvidence,
  HistoricalReturnLedgerEvidence,
  HistoricalToAllowedApplyCutoverMode,
  HistoricalToApplyItemResult,
  HistoricalToApplyOutcome,
  HistoricalToApplyOverallStatus,
  HistoricalToCandidateEvidence,
  HistoricalToCandidateRecord,
  HistoricalToClassification,
  HistoricalToExpectedCanonicalRow,
  HistoricalToExistingRow,
  HistoricalToReasonCode,
  HistoricalTransferOperationBackfillManifest,
} from "./foundation/historical-transfer-operation-backfill";
export {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  disconnectShopifyConnection,
  readShopifyOAuthBrowserBindingHash,
  ShopifyShopOwnershipConflictError,
  getActiveShopifyConnectionForMember,
  getShopifyConnectionForMember,
  listShopifyConnectionsForMember,
  persistShopifyInstall,
  revokeActiveShopifyConnectionsForShop,
  rotateShopifyTokenMaterial,
  setShopifyPrimaryLocation,
} from "./shopify/connection";
export type {
  ShopifyDb,
  ShopifyInstallInput,
  ShopifyPublicConnection,
} from "./shopify/connection";
export {
  assertShopifyInventoryItemGid,
  assertShopifyLineItemGid,
  assertShopifyOrderGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  isShopifyInventoryItemGid,
  isShopifyLineItemGid,
  isShopifyOrderGid,
  isShopifyProductGid,
  isShopifyProductVariantGid,
  shopifyLineItemGidFromNumericId,
  shopifyOrderGidFromNumericId,
  shopifyProductVariantGidFromNumericId,
  SHOPIFY_INVENTORY_ITEM_GID_PATTERN,
  SHOPIFY_LINE_ITEM_GID_PATTERN,
  SHOPIFY_ORDER_GID_PATTERN,
  SHOPIFY_PRODUCT_GID_PATTERN,
  SHOPIFY_PRODUCT_VARIANT_GID_PATTERN,
  ShopifyGidValidationError,
} from "./shopify/gids";
export type { ShopifyGidResource } from "./shopify/gids";
export {
  applyShopifyPaidOrderLineSale,
  applyShopifyPaidOrderObservation,
  classifyShopifySaleFactEquivalence,
  mergePaidOrderLineIdentities,
  parseShopifyOrdersPaidWebhookBody,
} from "./shopify/order-sale";
export type {
  ApplyShopifyPaidOrderLineResult,
  ApplyShopifyPaidOrderResult,
  ShopifyOrderSaleDb,
  ShopifyPaidOrderLineObservation,
} from "./shopify/order-sale";
export {
  createShopifyListingMapping,
  lookupShopifyListingByProductId,
  lookupShopifyListingByStoreItem,
  lookupShopifyVariantByInventoryItem,
  lookupShopifyVariantByRemoteVariant,
  lookupShopifyVariantByStoreVariant,
  ShopifyMappingConflictError,
  ShopifyMappingError,
} from "./shopify/mapping";
export type {
  CreateShopifyListingMappingInput,
  ShopifyListingMappingSnapshot,
  ShopifyMappedListing,
  ShopifyMappedVariant,
  ShopifyMappingCode,
  ShopifyMappingDb,
  ShopifyMappingLookupResult,
  ShopifyVariantMappingInput,
} from "./shopify/mapping";
export {
  clearShopifyProductContentConflict,
  clearShopifyVariantContentConflict,
  ensureShopifyUpdateListingContentJob,
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  recordShopifyListingContentDesire,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
} from "./shopify/content-desire";
export type {
  RecordShopifyListingContentDesireResult,
  ShopifyContentDb,
  ShopifyListingContentSnapshot,
} from "./shopify/content-desire";
export {
  normalizeShopifyDescription,
  normalizeShopifySku,
  normalizeShopifyTitle,
  shopifyCentsFromMoneyString,
  shopifyMoneyFromCents,
  shopifyProductContentFingerprint,
  shopifyUpdateListingContentDedupeKey,
  shopifyVariantContentFingerprint,
} from "./shopify/content-fingerprint";
export { classifyShopifyContentSemantics } from "./shopify/content-semantic";
export type {
  ClassifyShopifyContentSemanticsInput,
  ShopifyContentSemanticClass,
} from "./shopify/content-semantic";
export {
  applyShopifyProductsUpdateObservation,
  markShopifyEvidenceError,
  markShopifyEvidenceIgnored,
} from "./shopify/content-inbound";
export type {
  ApplyShopifyProductsUpdateResult,
  ShopifyInboundDb,
  ShopifyRemoteProductObservation,
} from "./shopify/content-inbound";
export {
  hashShopifyWebhookPayload,
  ingestShopifyWebhookEvidence,
  resolveShopifyConnectionForWebhook,
  SHOPIFY_DEDICATED_WEBHOOK_TOPICS,
  ShopifyEvidenceIngestError,
  ShopifyEvidenceInvariantError,
} from "./shopify/evidence";
export type {
  IngestShopifyWebhookEvidenceInput,
  IngestShopifyWebhookEvidenceResult,
  ShopifyEvidenceDb,
} from "./shopify/evidence";
export {
  claimNextShopifySyncJob,
  completeShopifySyncJobDead,
  completeShopifySyncJobRetry,
  completeShopifySyncJobSuccess,
  enqueueShopifySyncJob,
  hashShopifyJobPayload,
  shopifyEvidenceJobDedupeKey,
  shopifyJobBackoffMs,
  ShopifySyncJobConflictError,
} from "./shopify/jobs";
export type {
  EnqueueShopifySyncJobInput,
  ShopifyJobDb,
  ShopifyJobHandlerResult,
  ShopifySyncJobClaim,
} from "./shopify/jobs";
