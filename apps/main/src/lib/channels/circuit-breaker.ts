import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";
import { logSyncEvent } from "./sync-log";

/**
 * Circuit breaker states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests are rejected immediately
 * - HALF_OPEN: Testing recovery, allowing one request through
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Circuit breaker configuration.
 */
const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 2 * 60 * 1000;
const RECOVERY_TIMEOUT_MS = 30 * 1000;
const HALF_OPEN_SUCCESS_THRESHOLD = 2;

/**
 * In-memory circuit breaker state per connection.
 * Key: connectionId
 */
const circuitStates = new Map<
  string,
  {
    state: CircuitState;
    failures: number[];
    lastFailure: number | null;
    openedAt: number | null;
    halfOpenSuccesses: number;
  }
>();

/**
 * Get the current circuit breaker state for a connection.
 */
function getCircuitState(connectionId: string) {
  if (!circuitStates.has(connectionId)) {
    circuitStates.set(connectionId, {
      state: "CLOSED",
      failures: [],
      lastFailure: null,
      openedAt: null,
      halfOpenSuccesses: 0,
    });
  }
  return circuitStates.get(connectionId)!;
}

/**
 * Clean up old failures outside the failure window.
 */
function cleanupOldFailures(circuit: ReturnType<typeof getCircuitState>): void {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  circuit.failures = circuit.failures.filter((ts) => ts > cutoff);
}

/**
 * Check if the circuit is open for a connection.
 * If open, check if recovery timeout has passed to transition to half-open.
 */
export function isCircuitOpen(connectionId: string): boolean {
  const circuit = getCircuitState(connectionId);

  if (circuit.state === "CLOSED") {
    return false;
  }

  if (circuit.state === "OPEN") {
    if (circuit.openedAt && Date.now() - circuit.openedAt >= RECOVERY_TIMEOUT_MS) {
      circuit.state = "HALF_OPEN";
      circuit.halfOpenSuccesses = 0;
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Check circuit breaker status without modifying state.
 */
export function getCircuitStatus(connectionId: string): {
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  openedAt: Date | null;
} {
  const circuit = getCircuitState(connectionId);
  cleanupOldFailures(circuit);

  return {
    state: circuit.state,
    failures: circuit.failures.length,
    lastFailure: circuit.lastFailure ? new Date(circuit.lastFailure) : null,
    openedAt: circuit.openedAt ? new Date(circuit.openedAt) : null,
  };
}

/**
 * Record a successful request. If in half-open state, may transition to closed.
 */
export async function recordCircuitSuccess(
  connectionId: string,
  provider: ChannelProvider,
  memberId?: string
): Promise<void> {
  const circuit = getCircuitState(connectionId);

  if (circuit.state === "HALF_OPEN") {
    circuit.halfOpenSuccesses++;
    if (circuit.halfOpenSuccesses >= HALF_OPEN_SUCCESS_THRESHOLD) {
      circuit.state = "CLOSED";
      circuit.failures = [];
      circuit.lastFailure = null;
      circuit.openedAt = null;
      circuit.halfOpenSuccesses = 0;

      await persistCircuitState(connectionId, "CLOSED");

      if (memberId) {
        logSyncEvent(
          memberId,
          provider,
          "circuit_closed",
          "Channel sync recovered and is operating normally"
        );
      }
      console.info("[circuit-breaker] circuit closed after recovery", {
        connectionId,
        provider,
      });
    }
  } else if (circuit.state === "CLOSED") {
    cleanupOldFailures(circuit);
  }
}

/**
 * Record a failed request. May trip the circuit to open state.
 */
export async function recordCircuitFailure(
  connectionId: string,
  provider: ChannelProvider,
  memberId?: string,
  error?: string
): Promise<void> {
  const circuit = getCircuitState(connectionId);
  const now = Date.now();

  circuit.failures.push(now);
  circuit.lastFailure = now;
  cleanupOldFailures(circuit);

  if (circuit.state === "HALF_OPEN") {
    circuit.state = "OPEN";
    circuit.openedAt = now;
    circuit.halfOpenSuccesses = 0;

    await persistCircuitState(connectionId, "OPEN", error);

    if (memberId) {
      logSyncEvent(
        memberId,
        provider,
        "circuit_open",
        `Channel sync paused after failed recovery test: ${error?.slice(0, 200) ?? "Unknown error"}`
      );
    }
    console.warn("[circuit-breaker] circuit re-opened after half-open failure", {
      connectionId,
      provider,
    });
    return;
  }

  if (circuit.state === "CLOSED" && circuit.failures.length >= FAILURE_THRESHOLD) {
    circuit.state = "OPEN";
    circuit.openedAt = now;

    await persistCircuitState(connectionId, "OPEN", error);

    if (memberId) {
      logSyncEvent(
        memberId,
        provider,
        "circuit_open",
        `Channel sync paused due to repeated failures (${FAILURE_THRESHOLD} in ${FAILURE_WINDOW_MS / 1000}s): ${error?.slice(0, 200) ?? "Unknown error"}`
      );

      import("@/lib/send-push-notification")
        .then(({ sendPushNotification }) => {
          const label = provider.charAt(0).toUpperCase() + provider.slice(1);
          sendPushNotification(memberId, {
            title: `${label} sync temporarily paused`,
            body: "Multiple sync failures detected. We'll retry automatically soon.",
            data: { screen: "seller-hub/channels/sync-activity" },
            category: "commerce",
          }).catch(() => {});
        })
        .catch(() => {});
    }

    console.warn("[circuit-breaker] circuit opened", {
      connectionId,
      provider,
      failures: circuit.failures.length,
    });
  }
}

/**
 * Manually reset a circuit to closed state.
 */
export async function resetCircuit(
  connectionId: string,
  provider: ChannelProvider,
  memberId?: string
): Promise<void> {
  const circuit = getCircuitState(connectionId);
  circuit.state = "CLOSED";
  circuit.failures = [];
  circuit.lastFailure = null;
  circuit.openedAt = null;
  circuit.halfOpenSuccesses = 0;

  await persistCircuitState(connectionId, "CLOSED");

  if (memberId) {
    logSyncEvent(memberId, provider, "circuit_closed", "Circuit manually reset");
  }
  console.info("[circuit-breaker] circuit manually reset", {
    connectionId,
    provider,
  });
}

/**
 * Persist circuit state to ChannelConnection.config for recovery after cold start.
 */
async function persistCircuitState(
  connectionId: string,
  state: CircuitState,
  lastError?: string
): Promise<void> {
  try {
    const conn = await prisma.channelConnection.findUnique({
      where: { id: connectionId },
      select: { config: true },
    });

    const existingConfig =
      conn?.config && typeof conn.config === "object"
        ? { ...(conn.config as Record<string, unknown>) }
        : {};

    existingConfig.circuitBreaker = {
      state,
      openedAt: state === "OPEN" ? new Date().toISOString() : null,
      lastError: lastError?.slice(0, 500) ?? null,
    };

    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: { config: existingConfig as Prisma.InputJsonValue },
    });
  } catch (e) {
    console.warn("[circuit-breaker] failed to persist state", {
      connectionId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Hydrate circuit breaker state from ChannelConnection.config on cold start.
 */
export function hydrateCircuitFromConfig(connectionId: string, config: unknown): void {
  if (!config || typeof config !== "object") return;

  const c = config as Record<string, unknown>;
  const cb = c.circuitBreaker as Record<string, unknown> | undefined;
  if (!cb) return;

  const state = cb.state as CircuitState | undefined;
  if (!state || !["CLOSED", "OPEN", "HALF_OPEN"].includes(state)) return;

  const circuit = getCircuitState(connectionId);
  circuit.state = state;

  if (state === "OPEN" && typeof cb.openedAt === "string") {
    circuit.openedAt = new Date(cb.openedAt).getTime();
  }
}

/**
 * Get all connections with open circuits for a member.
 */
export function getOpenCircuitsForMember(connectionIds: string[]): string[] {
  return connectionIds.filter((id) => isCircuitOpen(id));
}
