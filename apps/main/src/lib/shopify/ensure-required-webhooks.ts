import { prisma } from "database";
import {
  ensureShopifyInventoryLevelsUpdateWebhook,
  ensureShopifyOrdersPaidWebhook,
  ensureShopifyProductsUpdateWebhook,
  registerShopifyUninstallWebhook,
  ShopifyRequestError,
  type ShopifyFetch,
} from "./client";
import { readShopifyAppConfig, type ShopifyAppConfig } from "./config";
import { accessTokenForConnection, ShopifyConnectError } from "./connect";
import { missingShopifyScopes } from "./scopes";

export type RequiredWebhookTopic =
  | "APP_UNINSTALLED"
  | "PRODUCTS_UPDATE"
  | "ORDERS_PAID"
  | "INVENTORY_LEVELS_UPDATE";

export type RequiredWebhookEnsureStatus = "REUSED" | "CREATED" | "UPDATED" | "SKIPPED_MISSING_SCOPE" | "FAILED";

export type RequiredWebhookEnsureResult = {
  topic: RequiredWebhookTopic;
  status: RequiredWebhookEnsureStatus;
  subscriptionId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type EnsureRequiredShopifyWebhooksResult = {
  ok: boolean;
  results: RequiredWebhookEnsureResult[];
  createdTopics: RequiredWebhookTopic[];
  missingScopes: string[];
};

function isMissingInventoryPermission(message: string): boolean {
  return /read_inventory|write_inventory|access.*(denied|forbidden)|not authorized|insufficient.*(scope|permission)|scope.*inventory|inventory.*scope/i.test(
    message
  );
}

/**
 * Ensure the required Shopify webhook set for one shop+token.
 * Reuses existing query-first ensure helpers — no duplicated registration logic.
 */
export async function ensureRequiredShopifyWebhooks(input: {
  shopDomain: string;
  accessToken: string;
  uninstallWebhookUri: string;
  providerEvidenceWebhookUri: string;
  grantedScopes?: string;
  fetchImpl?: ShopifyFetch;
}): Promise<EnsureRequiredShopifyWebhooksResult> {
  const results: RequiredWebhookEnsureResult[] = [];
  const createdTopics: RequiredWebhookTopic[] = [];
  const missingScopes = input.grantedScopes
    ? missingShopifyScopes(input.grantedScopes, ["read_inventory"])
    : [];

  try {
    await registerShopifyUninstallWebhook({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.uninstallWebhookUri,
      fetchImpl: input.fetchImpl,
    });
    results.push({ topic: "APP_UNINSTALLED", status: "REUSED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "uninstall webhook failed";
    results.push({
      topic: "APP_UNINSTALLED",
      status: "FAILED",
      errorCode: "APP_UNINSTALLED_ENSURE_FAILED",
      errorMessage: message.slice(0, 300),
    });
  }

  for (const row of [
    {
      topic: "PRODUCTS_UPDATE" as const,
      run: () =>
        ensureShopifyProductsUpdateWebhook({
          shopDomain: input.shopDomain,
          accessToken: input.accessToken,
          callbackUrl: input.providerEvidenceWebhookUri,
          fetchImpl: input.fetchImpl,
        }),
    },
    {
      topic: "ORDERS_PAID" as const,
      run: () =>
        ensureShopifyOrdersPaidWebhook({
          shopDomain: input.shopDomain,
          accessToken: input.accessToken,
          callbackUrl: input.providerEvidenceWebhookUri,
          fetchImpl: input.fetchImpl,
        }),
    },
  ]) {
    try {
      const outcome = await row.run();
      results.push({
        topic: row.topic,
        status: outcome.status,
        subscriptionId: outcome.subscriptionId,
      });
      if (outcome.status === "CREATED" || outcome.status === "UPDATED") {
        createdTopics.push(row.topic);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${row.topic} ensure failed`;
      results.push({
        topic: row.topic,
        status: "FAILED",
        errorCode: `${row.topic}_ENSURE_FAILED`,
        errorMessage: message.slice(0, 300),
      });
    }
  }

  if (missingScopes.includes("read_inventory")) {
    results.push({
      topic: "INVENTORY_LEVELS_UPDATE",
      status: "SKIPPED_MISSING_SCOPE",
      errorCode: "MISSING_READ_INVENTORY",
      errorMessage: "Connection granted scopes lack read_inventory",
    });
  } else {
    try {
      const outcome = await ensureShopifyInventoryLevelsUpdateWebhook({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        callbackUrl: input.providerEvidenceWebhookUri,
        fetchImpl: input.fetchImpl,
      });
      results.push({
        topic: "INVENTORY_LEVELS_UPDATE",
        status: outcome.status,
        subscriptionId: outcome.subscriptionId,
      });
      if (outcome.status === "CREATED" || outcome.status === "UPDATED") {
        createdTopics.push("INVENTORY_LEVELS_UPDATE");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "inventory webhook ensure failed";
      const missingInventory = isMissingInventoryPermission(message);
      results.push({
        topic: "INVENTORY_LEVELS_UPDATE",
        status: missingInventory ? "SKIPPED_MISSING_SCOPE" : "FAILED",
        errorCode: missingInventory ? "MISSING_READ_INVENTORY" : "INVENTORY_LEVELS_UPDATE_ENSURE_FAILED",
        errorMessage: message.slice(0, 300),
      });
      if (missingInventory && !missingScopes.includes("read_inventory")) {
        missingScopes.push("read_inventory");
      }
    }
  }

  const ok = results.every(
    (row) =>
      row.status === "REUSED" ||
      row.status === "CREATED" ||
      row.status === "UPDATED"
  );
  return { ok, results, createdTopics, missingScopes };
}

export type ReconcileActiveShopifyWebhooksResult = {
  checked: number;
  ok: number;
  repaired: number;
  failed: number;
  /** Permanent-ish permission gaps (do not thrash retry). */
  permissionBlocked: number;
  skipped: number;
  connectionResults: Array<{
    connectionId: string;
    generation: number;
    shopDomain: string;
    ok: boolean;
    createdTopics: RequiredWebhookTopic[];
    missingScopes: string[];
    errorCode?: string;
  }>;
};

/**
 * Connection-level webhook reconciliation for current-generation ACTIVE installs only.
 * Idempotent: existing topic+URI subscriptions are reused; never OAuth/reconnect.
 */
export async function reconcileActiveShopifyConnectionWebhooks(input?: {
  config?: ShopifyAppConfig | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
  /** Optional: limit to specific ACTIVE connection ids (tests / one-shot). */
  connectionIds?: string[];
}): Promise<ReconcileActiveShopifyWebhooksResult> {
  const config = input?.config === undefined ? readShopifyAppConfig() : input.config;
  if (!config) {
    return {
      checked: 0,
      ok: 0,
      repaired: 0,
      failed: 0,
      permissionBlocked: 0,
      skipped: 1,
      connectionResults: [],
    };
  }

  const connections = await prisma.shopifyConnection.findMany({
    where: {
      status: "ACTIVE",
      ...(input?.connectionIds?.length ? { id: { in: input.connectionIds } } : {}),
    },
    orderBy: { connectedAt: "asc" },
  });

  const connectionResults: ReconcileActiveShopifyWebhooksResult["connectionResults"] = [];
  let ok = 0;
  let repaired = 0;
  let failed = 0;
  let permissionBlocked = 0;

  for (const connection of connections) {
    if (!connection.shopDomain?.trim() || !connection.shopId?.trim()) {
      connectionResults.push({
        connectionId: connection.id,
        generation: connection.generation,
        shopDomain: connection.shopDomain,
        ok: false,
        createdTopics: [],
        missingScopes: [],
        errorCode: "INVALID_SHOP_IDENTITY",
      });
      failed += 1;
      continue;
    }

    try {
      const accessToken = await accessTokenForConnection(connection, {
        config,
        fetchImpl: input?.fetchImpl,
        now: input?.now,
      });
      const ensured = await ensureRequiredShopifyWebhooks({
        shopDomain: connection.shopDomain,
        accessToken,
        uninstallWebhookUri: config.uninstallWebhookUri,
        providerEvidenceWebhookUri: config.providerEvidenceWebhookUri,
        grantedScopes: connection.grantedScopes,
        fetchImpl: input?.fetchImpl,
      });
      const hardFail = ensured.results.some((r) => r.status === "FAILED");
      const scopeBlocked = ensured.results.some((r) => r.status === "SKIPPED_MISSING_SCOPE");
      connectionResults.push({
        connectionId: connection.id,
        generation: connection.generation,
        shopDomain: connection.shopDomain,
        ok: ensured.ok,
        createdTopics: ensured.createdTopics,
        missingScopes: ensured.missingScopes,
        errorCode: ensured.ok
          ? undefined
          : ensured.results.find((r) => r.status === "FAILED" || r.status === "SKIPPED_MISSING_SCOPE")
              ?.errorCode,
      });
      if (ensured.ok) {
        ok += 1;
        if (ensured.createdTopics.length > 0) repaired += 1;
      } else if (hardFail) {
        failed += 1;
      } else if (scopeBlocked) {
        permissionBlocked += 1;
      } else {
        failed += 1;
      }
      // Structured ops log only — never tokens/secrets; never seller notification on success.
      console.info("SHOPIFY_REQUIRED_WEBHOOKS_ENSURE", {
        connectionId: connection.id,
        generation: connection.generation,
        shopDomain: connection.shopDomain,
        ok: ensured.ok,
        createdTopics: ensured.createdTopics,
        missingScopes: ensured.missingScopes,
        statuses: ensured.results.map((r) => `${r.topic}:${r.status}`),
      });
    } catch (error) {
      const code =
        error instanceof ShopifyConnectError
          ? error.code.toUpperCase()
          : error instanceof ShopifyRequestError
            ? "PROVIDER_REQUEST_FAILED"
            : "ENSURE_FAILED";
      const message = error instanceof Error ? error.message.slice(0, 180) : "ensure failed";
      connectionResults.push({
        connectionId: connection.id,
        generation: connection.generation,
        shopDomain: connection.shopDomain,
        ok: false,
        createdTopics: [],
        missingScopes: [],
        errorCode: code,
      });
      failed += 1;
      console.info("SHOPIFY_REQUIRED_WEBHOOKS_ENSURE", {
        connectionId: connection.id,
        generation: connection.generation,
        shopDomain: connection.shopDomain,
        ok: false,
        errorCode: code,
        reason: message,
      });
    }
  }

  return {
    checked: connections.length,
    ok,
    repaired,
    failed,
    permissionBlocked,
    skipped: 0,
    connectionResults,
  };
}
