import Stripe from "stripe";
import { prisma } from "database";

export type AppShippingAddressInput = {
  street: string;
  aptOrSuite?: string;
  city: string;
  state: string;
  zip: string;
};

function normalizeUsZip(zip: string): string {
  return zip.trim().replace(/\D/g, "").slice(0, 5);
}

export function appShippingToStripeAddress(addr: AppShippingAddressInput): Stripe.AddressParam {
  return {
    line1: addr.street.trim(),
    ...(addr.aptOrSuite?.trim() ? { line2: addr.aptOrSuite.trim() } : {}),
    city: addr.city.trim(),
    state: addr.state.trim(),
    postal_code: normalizeUsZip(addr.zip),
    country: "US",
  };
}

function shippingDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined
): string {
  const n = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ").trim();
  if (n) return n;
  if (email?.includes("@")) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
  }
  return "Customer";
}

function isCompleteShipTo(addr: AppShippingAddressInput | null | undefined): addr is AppShippingAddressInput {
  if (!addr) return false;
  return Boolean(
    addr.street?.trim() && addr.city?.trim() && addr.state?.trim() && addr.zip?.trim()
  );
}

export function isNoSuchCustomerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such customer/i.test(msg);
}

/**
 * Find a Customer on the *marketplace* Stripe account for this member.
 * Never use member.stripeCustomerId — that belongs to the billing (Northwest Community) account.
 */
export async function findMarketplaceStripeCustomerId(
  stripe: Stripe,
  params: { memberId: string; email?: string | null }
): Promise<string | null> {
  const memberId = params.memberId.trim();
  if (!memberId) return null;

  try {
    const search = await stripe.customers.search({
      query: `metadata['memberId']:'${memberId.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    if (search.data[0]?.id) return search.data[0].id;
  } catch (err) {
    console.warn("[stripe-storefront-customer] customers.search failed; falling back to email list", {
      memberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const email = params.email?.includes("@") ? params.email.trim() : null;
  if (!email) return null;

  try {
    const listed = await stripe.customers.list({ email, limit: 10 });
    const withMeta = listed.data.find((c) => c.metadata?.memberId === memberId);
    if (withMeta?.id) return withMeta.id;
  } catch (err) {
    console.warn("[stripe-storefront-customer] customers.list by email failed", {
      memberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

/**
 * Resolve or create the marketplace Stripe Customer and sync shipping + billing address
 * so hosted Checkout can use Stripe Tax without `shipping_address_collection`.
 *
 * Does not read or write member.stripeCustomerId (billing / subscriptions account).
 */
export async function ensureStripeCustomerForStorefrontCheckout(
  stripe: Stripe,
  params: {
    memberId: string;
    email: string;
    firstName: string;
    lastName: string;
    shipTo: AppShippingAddressInput | null;
  }
): Promise<string> {
  const member = await prisma.member.findUnique({
    where: { id: params.memberId },
    select: { id: true },
  });
  if (!member) {
    throw new Error("Member not found");
  }

  const email = params.email.includes("@") ? params.email.trim() : undefined;
  const name = shippingDisplayName(params.firstName, params.lastName, params.email);
  const stripeAddress = isCompleteShipTo(params.shipTo) ? appShippingToStripeAddress(params.shipTo) : undefined;

  let customerId = await findMarketplaceStripeCustomerId(stripe, {
    memberId: params.memberId,
    email,
  });

  if (!customerId) {
    const customer = await stripe.customers.create({
      ...(email ? { email } : {}),
      ...(name !== "Customer" ? { name } : {}),
      metadata: { memberId: params.memberId, accountRole: "marketplace" },
      ...(stripeAddress
        ? {
            address: stripeAddress,
            shipping: { name, address: stripeAddress },
          }
        : {}),
    });
    return customer.id;
  }

  const update: Stripe.CustomerUpdateParams = {};
  if (email) update.email = email;
  if (name !== "Customer") update.name = name;
  if (stripeAddress) {
    update.address = stripeAddress;
    update.shipping = { name, address: stripeAddress };
  }
  if (Object.keys(update).length > 0) {
    try {
      await stripe.customers.update(customerId, update);
    } catch (err) {
      if (!isNoSuchCustomerError(err)) throw err;
      const customer = await stripe.customers.create({
        ...(email ? { email } : {}),
        ...(name !== "Customer" ? { name } : {}),
        metadata: { memberId: params.memberId, accountRole: "marketplace" },
        ...(stripeAddress
          ? {
              address: stripeAddress,
              shipping: { name, address: stripeAddress },
            }
          : {}),
      });
      return customer.id;
    }
  }
  return customerId;
}

/**
 * When the member already has a marketplace Stripe Customer, push profile delivery address (best-effort).
 * Does not create customers — checkout does that — avoids orphan Stripe records.
 * Does not use billing-account customer ids.
 */
export async function syncStripeCustomerShippingFromProfileDelivery(
  stripe: Stripe,
  memberId: string,
  deliveryAddress: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    aptOrSuite?: string;
  } | null
): Promise<void> {
  if (
    !deliveryAddress ||
    !deliveryAddress.street?.trim() ||
    !deliveryAddress.city?.trim() ||
    !deliveryAddress.state?.trim() ||
    !deliveryAddress.zip?.trim()
  ) {
    return;
  }

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { email: true, firstName: true, lastName: true },
  });
  if (!member) return;

  const customerId = await findMarketplaceStripeCustomerId(stripe, {
    memberId,
    email: member.email,
  });
  if (!customerId) return;

  const shipTo: AppShippingAddressInput = {
    street: deliveryAddress.street.trim(),
    city: deliveryAddress.city.trim(),
    state: deliveryAddress.state.trim(),
    zip: deliveryAddress.zip.trim(),
    ...(deliveryAddress.aptOrSuite?.trim() ? { aptOrSuite: deliveryAddress.aptOrSuite.trim() } : {}),
  };
  const stripeAddress = appShippingToStripeAddress(shipTo);
  const name = shippingDisplayName(member.firstName, member.lastName, member.email);

  try {
    await stripe.customers.update(customerId, {
      address: stripeAddress,
      shipping: { name, address: stripeAddress },
    });
  } catch (err) {
    if (isNoSuchCustomerError(err)) return;
    throw err;
  }
}
