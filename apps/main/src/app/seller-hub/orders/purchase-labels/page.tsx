import { redirect } from "next/navigation";

const PASSTHROUGH_KEYS = ["returnTo", "nwAppShippo", "nwAppChrome", "autoBulk"] as const;

function ordersListPathFromReturnTo(returnTo: string | undefined): "/resale-hub/orders" | "/seller-hub/orders" {
  if (returnTo === "/resale-hub/orders" || returnTo?.startsWith("/resale-hub/orders/")) {
    return "/resale-hub/orders";
  }
  return "/seller-hub/orders";
}

export default async function PurchaseLabelsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const returnTo = typeof sp.returnTo === "string" ? sp.returnTo : undefined;
  const targetPath = ordersListPathFromReturnTo(returnTo);
  const q = new URLSearchParams();
  for (const key of PASSTHROUGH_KEYS) {
    const v = sp[key];
    if (typeof v === "string" && v.length > 0) q.set(key, v);
  }
  const qs = q.toString();
  redirect(`${targetPath}${qs ? `?${qs}` : ""}`);
}
