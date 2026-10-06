// Wix Integration - Re-exports for convenient access

// Configuration
export { readWixAppConfig, isWixConfigured, type WixAppConfig } from "./config";

// OAuth / Connection
export {
  beginWixConnect,
  completeWixOAuth,
  accessTokenForWixConnection,
} from "./connect";

// API Client
export {
  mintWixAccessToken,
  wixApplicationRequest,
  detectWixCatalogVersion,
  fetchWixSiteInfo,
} from "./client";

// Import Flow
export {
  listWixImportCandidates,
  getWixProductForImport,
  type WixImportCandidate,
  type ListWixImportCandidatesResult,
} from "./import-discovery";
export { importWixProduct } from "./import-listing";

// Listing Actions
export {
  scheduleWixContentUpdate,
  scheduleWixInventoryProjection,
  createWixListing,
  loadMappedWixListing,
  hasWixPendingProjections,
  reconcileWixListing,
  removeWixListing,
} from "./listing-actions";

// Job Handlers
export { handleWixCreateListingJob } from "./create-listing";
export { handleWixUpdateListingContentJob } from "./update-listing-content";
export { handleWixProjectInventoryJob } from "./project-inventory";
export { handleWixProcessProviderEvidenceJob } from "./process-provider-evidence";
export { handleWixReconcileListingJob } from "./reconcile-listing";

// Worker
export { runNextWixSyncJob, drainWixSyncJobs } from "./worker";

// Webhook Verification
export {
  verifyWixWebhook,
  verifyWixWebhookJwt,
  decodeWixWebhookPayload,
  hashWixWebhookBody,
  type WixWebhookVerifyResult,
  type WixWebhookEvent,
} from "./webhook-verify";

// Constants
export {
  WIX_API_BASE_URL,
  WIX_OAUTH_AUTHORIZE_URL,
  WIX_CATALOG_V1,
  WIX_CATALOG_V3,
} from "./constants";
