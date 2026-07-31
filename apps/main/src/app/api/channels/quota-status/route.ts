import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getDailyUsage,
  getProjectedUsage,
  checkAllQuotaAlerts,
} from "@/lib/channels/daily-quota-tracker";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/quota-status
 * 
 * Returns current API quota usage and alerts for all channel providers.
 * Accessible to admins only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  
  // Only allow admins to view quota status
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const providers: ChannelProvider[] = ["etsy", "ebay", "shopify", "wix"];
  
  const providerStats = await Promise.all(
    providers.map(async (provider) => {
      const usage = getDailyUsage(provider);
      const projected = await getProjectedUsage(provider);
      
      return {
        provider,
        usage,
        projected,
        status: getStatusLevel(usage.percentUsed, projected.willExceed),
      };
    })
  );

  const alerts = await checkAllQuotaAlerts();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    providers: providerStats,
    alerts: alerts.map((a) => ({
      provider: a.provider,
      level: a.alertLevel,
      message: a.message,
    })),
    summary: {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter((a) => a.alertLevel === "critical" || a.alertLevel === "exceeded").length,
    },
  });
}

function getStatusLevel(
  percentUsed: number,
  willExceed: boolean
): "ok" | "warning" | "critical" | "exceeded" {
  if (percentUsed >= 100) return "exceeded";
  if (percentUsed >= 90) return "critical";
  if (percentUsed >= 70 || willExceed) return "warning";
  return "ok";
}
