/**
 * Capture a channel sync error in Sentry with structured context.
 * No-ops gracefully if Sentry is not configured.
 */
export function captureChannelSyncError(
  error: unknown,
  context: {
    provider: string;
    storeItemId?: string;
    connectionId?: string;
    operation?: string;
  }
): void {
  try {
    const Sentry = require("@sentry/nextjs");
    Sentry.withScope((scope: { setTag: (k: string, v: string) => void; setContext: (k: string, v: Record<string, unknown>) => void }) => {
      scope.setTag("channel.provider", context.provider);
      if (context.operation) scope.setTag("channel.operation", context.operation);
      scope.setContext("channel_sync", {
        provider: context.provider,
        storeItemId: context.storeItemId,
        connectionId: context.connectionId,
        operation: context.operation,
      });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
  } catch {
    // Sentry not available
  }
}
