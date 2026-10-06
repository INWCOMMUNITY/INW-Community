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
  applyTrackedMarketplaceQuantityEdit,
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
  MARKETPLACE_QUANTITY_EDIT_CAUSE,
  MARKETPLACE_QUANTITY_EDIT_SCOPE,
  projectStoreItemQuantity,
  projectStoreItemVariantsMatrix,
  releaseReservation,
  restockTrackedVariant,
  setTrackedOnHand,
  SHOPIFY_SOURCE_SYSTEM,
  ETSY_SOURCE_SYSTEM,
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
  applyFoundationSellerCollapseToSimple,
  applyFoundationSellerMatrixStructure,
  assertFoundationMatrixStructureUnchanged,
  assertNoStructuralVariantChange,
  endFoundationListing,
  markFoundationListingSold,
  provisionNativeFoundationListing,
  relistFoundationListing,
  restockFoundationOrderLine,
} from "./commerce-foundation-listing";
export type { FoundationMatrixSkuTarget } from "./commerce-foundation-listing";
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
  consumeEtsyOAuthState,
  createEtsyOAuthState,
  disconnectEtsyConnection,
  readEtsyOAuthBrowserBindingHash,
  EtsyShopOwnershipConflictError,
  getActiveEtsyConnectionForMember,
  getEtsyConnectionForMember,
  listEtsyConnectionsForMember,
  persistEtsyInstall,
  rotateEtsyTokenMaterial,
} from "./etsy/connection";
export type {
  EtsyDb,
  EtsyInstallInput,
  EtsyPublicConnection,
} from "./etsy/connection";
export {
  ETSY_ORDER_WEBHOOK_TOPICS,
  EtsyEvidenceIngestError,
  EtsyEvidenceInvariantError,
  hashEtsyWebhookPayload,
  ingestEtsyWebhookEvidence,
  normalizeEtsyWebhookTopic,
  resolveEtsyConnectionForWebhook,
} from "./etsy/evidence";
export type {
  EtsyEvidenceDb,
  IngestEtsyWebhookEvidenceInput,
  IngestEtsyWebhookEvidenceResult,
} from "./etsy/evidence";
export {
  claimNextEtsySyncJob,
  completeEtsySyncJobDead,
  completeEtsySyncJobRetry,
  completeEtsySyncJobSuccess,
  enqueueEtsySyncJob,
  etsyEvidenceJobDedupeKey,
  etsyJobBackoffMs,
  hashEtsyJobPayload,
  EtsySyncJobConflictError,
} from "./etsy/jobs";
export type {
  EnqueueEtsySyncJobInput,
  EtsyJobDb,
  EtsyJobHandlerResult,
  EtsySyncJobClaim,
} from "./etsy/jobs";
export {
  beginEtsyListingImportAttempt,
  completeEtsyListingImportAttempt,
  failEtsyListingImportAttempt,
} from "./etsy/import-attempt";
export type { BeginEtsyListingImportAttemptResult } from "./etsy/import-attempt";
export {
  createEtsyImportedListingMapping,
  replaceEtsyListingVariantMaps,
  lookupEtsyListingByRemoteId,
  EtsyMappingConflictError,
  EtsyMappingError,
} from "./etsy/import-mapping";
export type {
  CreateEtsyImportedListingMappingInput,
  EtsyListingMappingSnapshot,
  EtsyVariantMappingInput,
} from "./etsy/import-mapping";
export {
  etsyCentsFromMoney,
  etsyMoneyFromCents,
  etsyProductContentFingerprint,
  etsyUpdateListingContentDedupeKey,
  etsyVariantContentFingerprint,
  normalizeEtsyDescription,
  normalizeEtsyPhotoUrls,
  normalizeEtsySku,
  normalizeEtsyTitle,
} from "./etsy/content-fingerprint";
export {
  ensureEtsyUpdateListingContentJob,
  markEtsyProductContentApplied,
  markEtsyVariantContentApplied,
  recordEtsyDirtyMappedVariantContentDesires,
  recordEtsyHowItsMadeDesire,
  recordEtsyListingContentDesire,
  recordEtsyListingVariantTopologyDesire,
  setEtsyProductContentConflict,
  setEtsyVariantContentConflict,
} from "./etsy/content-desire";
export type {
  EtsyContentDb,
  EtsyHowItsMadeSnapshot,
  EtsyListingContentSnapshot,
  RecordEtsyListingContentDesireResult,
} from "./etsy/content-desire";
export { classifyEtsyContentSemantics } from "./etsy/content-semantic";
export type {
  ClassifyEtsyContentSemanticsInput,
  EtsyContentSemanticClass,
} from "./etsy/content-semantic";
export { applyEtsyListingContentInbound } from "./etsy/content-inbound";
export type {
  ApplyEtsyListingInboundResult,
  EtsyInboundDb,
  EtsyRemoteListingObservation,
} from "./etsy/content-inbound";
export {
  aspectsEqual,
  buildEtsyInboundAspects,
  mergeEtsyInboundAspects,
  normalizeEtsyTags,
  normalizeInboundAspects,
  tagsEqual,
} from "./etsy/listing-aspects";
export type { EtsyInboundAspect, EtsyListingAttributeSource } from "./etsy/listing-aspects";
export {
  applyEtsyListingInventoryInbound,
  applyEtsyOfferingInventoryObservation,
} from "./etsy/inventory-inbound";
export type {
  ApplyEtsyInventoryObservationResult,
  EtsyInventoryInboundDb,
} from "./etsy/inventory-inbound";
export {
  enqueueDueEtsyListingContentPolls,
  etsyListingContentPollWindowStartMs,
  etsyPollListingContentDedupeKey,
  isEtsyListingContentPollDue,
  markEtsyListingContentPollComplete,
} from "./etsy/listing-content-poll";
export {
  applyEtsyPaidOrderLineSale,
  applyEtsyPaidOrderObservation,
  classifyEtsySaleFactEquivalence,
  restockEtsyCanceledReceipt,
} from "./etsy/order-sale";
export type {
  ApplyEtsyPaidOrderLineResult,
  EtsyOrderSaleDb,
  EtsyPaidOrderLineObservation,
} from "./etsy/order-sale";
export {
  captureEtsyInventoryProjectionDesire,
  ensureEtsyProjectInventoryJob,
  etsyProjectInventoryDedupeKey,
  markEtsyInventoryProjectionApplied,
} from "./etsy/inventory-desire";
export type {
  CaptureEtsyInventoryProjectionDesireResult,
  EtsyInventoryDesireDb,
} from "./etsy/inventory-desire";
export {
  ETSY_WHEN_MADE_LABELS,
  ETSY_WHEN_MADE_VALUES,
  ETSY_WHO_MADE_LABELS,
  ETSY_WHO_MADE_VALUES,
  isEtsyWhenMade,
  isEtsyWhoMade,
  resolveEtsyHowItsMadeForCreate,
} from "./etsy/how-its-made";
export type {
  EtsyHowItsMadeInput,
  EtsyHowItsMadeMissing,
  EtsyHowItsMadeReady,
  EtsyWhenMade,
  EtsyWhoMade,
} from "./etsy/how-its-made";
export {
  classifyEtsyListingHealth,
  enqueueDueEtsyListingReconciliations,
  etsyListingIssueDedupeKey,
  etsyReconcileListingDedupeKey,
  persistEtsyListingHealth,
  reconcileEtsyListingHealthFromDb,
} from "./etsy/listing-health";
export type { EtsyHealthDb, EtsyListingHealthSnapshot } from "./etsy/listing-health";
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
  appendShopifyVariantMaps,
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
export { createShopifyImportedListingMapping } from "./shopify/import-mapping";
export type {
  CreateShopifyImportedListingMappingInput,
  ShopifyImportMappingDb,
} from "./shopify/import-mapping";
export {
  beginShopifyListingImportAttempt,
  completeShopifyListingImportAttempt,
  failShopifyListingImportAttempt,
} from "./shopify/import-attempt";
export type {
  BeginShopifyListingImportAttemptResult,
  ShopifyImportAttemptDb,
} from "./shopify/import-attempt";
export { reconcileShopifyImportBootstrapSales } from "./shopify/import-bootstrap";
export type { ReconcileShopifyImportBootstrapResult } from "./shopify/import-bootstrap";
export {
  clearShopifyProductContentConflict,
  clearShopifyVariantContentConflict,
  ensureShopifyUpdateListingContentJob,
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  recordShopifyListingContentDesire,
  recordShopifyDirtyMappedVariantContentDesires,
  requeueShopifyContentForUnpushedMedia,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
} from "./shopify/content-desire";
export type {
  RecordShopifyListingContentDesireResult,
  ShopifyContentDb,
  ShopifyListingContentSnapshot,
} from "./shopify/content-desire";
export {
  captureShopifyInventoryProjectionDesire,
  clearShopifyInventoryProjectionPendingMutation,
  ensureShopifyProjectInventoryJob,
  markShopifyInventoryProjectionApplied,
  markShopifyInventoryProjectionRemoteDrift,
  seedShopifyInventoryProjectionOnMapping,
  setShopifyInventoryProjectionPendingMutation,
} from "./shopify/inventory-desire";
export type {
  CaptureShopifyInventoryProjectionDesireResult,
  ShopifyInventoryDesireDb,
} from "./shopify/inventory-desire";
export {
  ensureShopifyPublishListingJob,
  shopifyPublishListingDedupeKey,
} from "./shopify/publish-desire";
export type { ShopifyPublishJobDb } from "./shopify/publish-desire";
export {
  classifyShopifyInventoryProjectionAction,
  shopifyInventoryActivateIdempotencyKey,
  shopifyInventoryProjectionReferenceUri,
  shopifyInventorySetIdempotencyKey,
  shopifyInventoryTrackedIdempotencyKey,
  shopifyProjectInventoryDedupeKey,
} from "./shopify/inventory-projection";
export type { ShopifyInventoryProjectionDecision } from "./shopify/inventory-projection";
export {
  classifyShopifyListingHealth,
  enqueueDueShopifyListingReconciliations,
  ensureShopifyReconcileListingJob,
  persistShopifyListingHealth,
  shopifyListingIssueDedupeKey,
  shopifyReconcileListingDedupeKey,
  shopifyReconcileTimeBucket,
  toPublicShopifyListingStatus,
} from "./shopify/listing-health";
export type {
  ClassifyShopifyListingHealthInput,
  PersistShopifyListingHealthResult,
  ShopifyHealthDb,
  ShopifyListingHealthSnapshot,
  ShopifyListingIssueSeverity,
  ShopifyListingPublicStatus,
  ShopifyListingRemoteObservation,
} from "./shopify/listing-health";
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
export {
  planShopifyFieldLevelSync,
  SHOPIFY_PRODUCT_FIELD_KEYS,
  SHOPIFY_VARIANT_FIELD_KEYS,
} from "./shopify/field-semantic";
export type {
  ShopifyAdaptiveFieldKey,
  ShopifyFieldObservation,
  ShopifyFieldPlan,
  ShopifyFieldSemanticAction,
} from "./shopify/field-semantic";
export {
  shopifyDescriptionFieldFingerprint,
  shopifyFieldFingerprint,
  normalizeShopifyDescriptionHtmlForCompare,
} from "./shopify/field-fingerprint";
export {
  loadShopifyFieldStates,
  markShopifyFieldsApplied,
  persistShopifyFieldPlans,
  seedShopifyListingFieldConvergence,
} from "./shopify/field-state";
export type { ShopifyFieldStateDb } from "./shopify/field-state";
export { planShopifyOutboundContentFields } from "./shopify/content-outbound-fields";
export type { ShopifyOutboundFieldPlan } from "./shopify/content-outbound-fields";
export {
  matchRemoteShopifyMediaToMaps,
  planShopifyMediaDesireFromPhotos,
  shopifyMediaContentSha256,
  shopifyMediaIdentityFingerprint,
  upsertShopifyMediaDesireMaps,
} from "./shopify/media-map";
export type { ShopifyMediaDesireRow, ShopifyMediaMapDb } from "./shopify/media-map";
export {
  classifyShopifyDirectInventoryEdit,
  shouldPauseInventoryForDirectShopifyEdit,
} from "./shopify/inventory-direct-edit";
export type { ShopifyDirectInventoryEditClass } from "./shopify/inventory-direct-edit";
export { applyShopifyInventoryLevelObservation } from "./shopify/inventory-levels-inbound";
export type {
  ApplyShopifyInventoryLevelResult,
  ShopifyInventoryLevelObservation,
  ShopifyInventoryLevelsDb,
} from "./shopify/inventory-levels-inbound";
export { applyShopifyMediaInbound } from "./shopify/media-inbound";
export type { ShopifyMediaInboundDb, ShopifyRemoteMediaNode } from "./shopify/media-inbound";
export {
  applyShopifyVariantMediaInbound,
  classifyVariantMediaInbound,
  planVariantMediaAssociations,
  planVariantMediaInboundAssociations,
  seedShopifyVariantMediaConvergence,
  variantMediaLocalFingerprint,
  variantMediaRemoteFingerprint,
} from "./shopify/variant-media";
export type {
  ShopifyVariantMediaInboundDb,
  VariantMediaAssociationPlan,
  VariantMediaInboundClass,
} from "./shopify/variant-media";
export {
  correlateVariantsByOptionCombination,
  isShopifyDefaultTitleOnly,
  planShopifyTopologyDiff,
  shopifyOptionCombinationKey,
  shopifySelectedOptionsToInwOptions,
  shopifyTopologyToInwMatrix,
  SHOPIFY_MAX_OPTION_DIMENSIONS,
  SHOPIFY_MAX_VARIANTS,
  validateShopifyImportTopology,
} from "./shopify/variant-topology";
export type {
  ShopifyOptionAxis,
  ShopifyRemoteVariantSnap,
  ShopifyTopologyDiffPlan,
  ShopifyTopologyLocalVariant,
  ShopifyTopologyRemoteOption,
  ShopifyTopologyValidation,
} from "./shopify/variant-topology";
export {
  normalizeShopifyAspects,
  normalizeShopifyBarcode,
  normalizeShopifyPhotoUrls,
  normalizeShopifyTags,
  normalizeShopifyVendor,
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
// Wix integration exports
export {
  consumeWixOAuthState,
  createWixOAuthState,
  disconnectWixConnection,
  readWixOAuthBrowserBindingHash,
  WixSiteOwnershipConflictError,
  getActiveWixConnectionForMember,
  getWixConnectionForMember,
  listWixConnectionsForMember,
  persistWixInstall,
  updateWixCatalogVersion,
  setWixDefaultLocation,
} from "./wix/connection";
export type {
  WixDb,
  WixInstallInput,
  WixPublicConnection,
} from "./wix/connection";
export {
  claimNextWixSyncJob,
  completeWixSyncJobDead,
  completeWixSyncJobRetry,
  completeWixSyncJobSuccess,
  enqueueWixSyncJob,
  hashWixJobPayload,
  wixCreateListingDedupeKey,
  wixEvidenceJobDedupeKey,
  wixJobBackoffMs,
  wixPollListingContentDedupeKey,
  wixProjectInventoryDedupeKey,
  wixReconcileListingDedupeKey,
  wixUpdateListingContentDedupeKey,
  WixSyncJobConflictError,
} from "./wix/jobs";
export type {
  EnqueueWixSyncJobInput,
  WixJobDb,
  WixJobHandlerResult,
  WixSyncJobClaim,
} from "./wix/jobs";
export {
  hashWixWebhookPayload,
  ingestWixWebhookEvidence,
  markWixEvidenceError,
  markWixEvidenceIgnored,
  markWixEvidenceProcessed,
  normalizeWixWebhookTopic,
  resolveWixConnectionForWebhook,
  getWixEvidenceWithConnection,
  WIX_INVENTORY_WEBHOOK_TOPICS,
  WIX_ORDER_WEBHOOK_TOPICS,
  WIX_PRODUCT_WEBHOOK_TOPICS,
  WixEvidenceIngestError,
  WixEvidenceInvariantError,
} from "./wix/evidence";
export type {
  IngestWixWebhookEvidenceInput,
  IngestWixWebhookEvidenceResult,
  WixEvidenceDb,
} from "./wix/evidence";
export {
  createWixImportedListingMapping,
  createWixNativeListingMapping,
  deleteWixListingMapping,
  lookupWixListingByRemoteId,
  lookupWixListingByStoreItem,
  lookupWixVariantByRemoteVariant,
  lookupWixVariantByStoreVariant,
  replaceWixListingVariantMaps,
  WixMappingConflictError,
  WixMappingError,
} from "./wix/import-mapping";
export type {
  CreateWixImportedListingMappingInput,
  CreateWixNativeListingMappingInput,
  WixListingMappingSnapshot,
  WixMappingDb,
  WixVariantMappingInput,
} from "./wix/import-mapping";
export {
  beginWixListingImportAttempt,
  completeWixListingImportAttempt,
  failWixListingImportAttempt,
  getWixListingBootstrapCutoff,
  getWixListingImportAttempt,
  listWixListingImportAttempts,
} from "./wix/import-attempt";
export type { BeginWixListingImportAttemptResult, WixImportAttemptDb } from "./wix/import-attempt";
export {
  applyWixPaidOrderLineSale,
  applyWixPaidOrderObservation,
  classifyWixSaleFactEquivalence,
  restockWixCanceledOrder,
  WIX_SOURCE_SYSTEM,
} from "./wix/order-sale";
export type {
  ApplyWixPaidOrderLineResult,
  WixOrderSaleDb,
  WixPaidOrderLineObservation,
} from "./wix/order-sale";
export {
  captureWixInventoryProjectionDesire,
  captureWixInventoryProjectionDesireAfterChange,
  ensureWixProjectInventoryJob,
  getUnprojectedWixVariantMaps,
  hasUnprojectedWixInventoryDesires,
  markWixInventoryProjectionApplied,
} from "./wix/inventory-desire";
export type {
  CaptureWixInventoryProjectionDesireResult,
  WixInventoryDesireDb,
} from "./wix/inventory-desire";
export {
  classifyWixListingHealth,
  clearWixListingIssue,
  enqueueDueWixListingReconciliations,
  markWixListingReconciled,
  persistWixListingHealth,
  recordWixDeadJobIssue,
  refreshWixListingHealthFromDb,
  stickyWixDivergenceIssue,
  toPublicWixListingStatus,
} from "./wix/listing-health";
export type {
  ClassifyWixListingHealthInput,
  WixHealthDb,
  WixListingHealthSnapshot,
  WixListingPublicStatus,
} from "./wix/listing-health";
export {
  clearWixProductContentConflict,
  ensureWixUpdateListingContentJob,
  markWixProductContentApplied,
  markWixVariantContentApplied,
  recordWixListingContentDesire,
  recordWixMappedListingContentDesire,
  recordWixListingVariantTopologyDesire,
  setWixProductContentConflict,
} from "./wix/content-desire";
export type {
  RecordWixListingContentDesireResult,
  RecordWixMappedListingContentDesireResult,
  WixContentDb,
  WixListingContentSnapshot,
} from "./wix/content-desire";
export { applyWixListingContentInbound } from "./wix/content-inbound";
export type {
  ApplyWixListingInboundResult,
  WixInboundDb,
  WixRemoteListingObservation,
} from "./wix/content-inbound";
export {
  normalizeWixDescription,
  normalizeWixPhotoUrls,
  normalizeWixTitle,
  wixProductContentFingerprint,
  wixVariantContentFingerprint,
} from "./wix/content-fingerprint";
export { classifyWixContentSemantics } from "./wix/content-semantic";
export type {
  ClassifyWixContentSemanticsInput,
  WixContentSemanticClass,
} from "./wix/content-semantic";
