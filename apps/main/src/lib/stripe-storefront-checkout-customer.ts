import Stripe from "stripe";
import { prisma } from "database";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";

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

/**
 * Resolve or create the platform Stripe Customer and sync shipping + billing address on the Customer
 * so hosted Checkout can use Stripe Tax without `shipping_address_collection`.
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
    select: { stripeCustomerId: true },
  });
  if (!member) {
    throw new Error("Member not found");
  }

  let customerId = member.stripeCustomerId?.trim() || null;
  if (!customerId) {
    customerId = await resolveStripeCustomerIdForMember(params.memberId);
    if (customerId) {
      await prisma.member.update({
        where: { id: params.memberId },
        data: { stripeCustomerId: customerId },
      });
    }
  }

  const email = params.email.includes("@") ? params.email.trim() : undefined;
  const name = shippingDisplayName(params.firstName, params.lastName, params.email);
  const stripeAddress = isCompleteShipTo(params.shipTo) ? appShippingToStripeAddress(params.shipTo) : undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      ...(email ? { email } : {}),
      ...(name !== "Customer" ? { name } : {}),
      metadata: { memberId: params.memberId },
      ...(stripeAddress
        ? {
            address: stripeAddress,
            shipping: { name, address: stripeAddress },
          }
        : {}),
    });
    await prisma.member.update({
      where: { id: params.memberId },
      data: { stripeCustomerId: customer.id },
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
    await stripe.customers.update(customerId, update);
  }
  return customerId;
}

/**
 * When the member already has a Stripe Customer, push profile delivery address to Stripe (best-effort).
 * Does not create customers — checkout does that — avoids orphan Stripe records.
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

  const customerId = await resolveStripeCustomerIdForMember(memberId);
  if (!customerId) return;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { email: true, firstName: true, lastName: true },
  });
  if (!member) return;

  const shipTo: AppShippingAddressInput = {
    street: deliveryAddress.street.trim(),
    city: deliveryAddress.city.trim(),
    state: deliveryAddress.state.trim(),
    zip: deliveryAddress.zip.trim(),
    ...(deliveryAddress.aptOrSuite?.trim() ? { aptOrSuite: deliveryAddress.aptOrSuite.trim() } : {}),
  };
  const stripeAddress = appShippingToStripeAddress(shipTo);
  const name = shippingDisplayName(member.firstName, member.lastName, member.email);

  await stripe.customers.update(customerId, {
    address: stripeAddress,
    shipping: { name, address: stripeAddress },
  });
}
