import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess, prismaWhereMemberSponsorPlanAccess } from "@/lib/nwc-paid-subscription";

const STEPS = ["account", "business", "contact", "subscribe", "shipping", "payouts", "import"] as const;
export type SellerOnboardingStep = (typeof STEPS)[number];

const BEFORE_PAYMENT: SellerOnboardingStep[] = ["account", "business", "contact", "subscribe"];

/** Steps that still need the seller. Import is optional, so it does not pull them back in. */
const RESUME_STEPS = new Set<SellerOnboardingStep>(["business", "subscribe", "shipping", "payouts"]);

export type OnboardingResumeStep = SellerOnboardingStep | "sponsor";

export function isSellerOnboardingStep(value: string | null): value is SellerOnboardingStep {
  return Boolean(value && (STEPS as readonly string[]).includes(value));
}

export function clampSellerOnboardingStep(
  furthest: SellerOnboardingStep,
  requested: string | null,
  hasSubscription: boolean
): SellerOnboardingStep {
  if (!isSellerOnboardingStep(requested)) return furthest;
  if (hasSubscription && BEFORE_PAYMENT.includes(requested)) return furthest;
  return STEPS.indexOf(requested) <= STEPS.indexOf(furthest) ? requested : furthest;
}

export function sellerOnboardingResumePath(step: SellerOnboardingStep): string | null {
  if (!RESUME_STEPS.has(step)) return null;
  return `/signup/seller?step=${step}`;
}

export async function getSellerOnboardingProgress(
  memberId: string,
  opts?: { localSkipShippingAndStripe?: boolean }
) {
  const [member, business, subscription, shippingOptionCount] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      select: {
        signupIntent: true,
        firstName: true,
        lastName: true,
        phone: true,
        shippoOAuthTokenEncrypted: true,
        stripeConnectAccountId: true,
        offerFreeShippingOnInw: true,
      },
    }),
    prisma.business.findFirst({
      where: { memberId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(memberId),
      select: { id: true },
    }),
    prisma.shippingOption.count({ where: { memberId, archivedAt: null } }),
  ]);

  const hasSubscription = Boolean(subscription);
  const shippoConnected = Boolean(member?.shippoOAuthTokenEncrypted);
  const stripeConnectStarted = Boolean(member?.stripeConnectAccountId);
  const freeShippingOnInw = Boolean(member?.offerFreeShippingOnInw);
  // Beans: remove localSkipShippingAndStripe, the localhost Continue buttons on
  // shipping and payouts, and /api/signup/seller/dev-skip. Shipping then requires
  // Shippo, and payouts require Stripe.
  const localSkip =
    opts?.localSkipShippingAndStripe === true && process.env.NODE_ENV === "development";
  const shippingStepDone =
    localSkip || (shippoConnected && (freeShippingOnInw || shippingOptionCount >= 1));
  const payoutsStepDone = localSkip || stripeConnectStarted;
  const hasBusiness = Boolean(business);

  if (member?.signupIntent === "business" && !hasSubscription) {
    const sponsor = await prisma.subscription.findFirst({
      where: prismaWhereMemberSponsorPlanAccess(memberId),
      select: { id: true },
    });
    if (!sponsor) {
      return {
        signupIntent: member.signupIntent,
        hasBusiness,
        hasSubscription: false,
        shippoConnected,
        shippingOptionCount,
        stripeConnectStarted,
        furthest: "import" as SellerOnboardingStep,
        onboardingStep: "sponsor" as OnboardingResumeStep,
        resumePath: "/signup/business",
        firstName: member.firstName ?? "",
        lastName: member.lastName ?? "",
        phone: member.phone ?? "",
      };
    }
  }

  let furthest: SellerOnboardingStep = "business";
  if (member?.signupIntent !== "seller") {
    furthest = "import";
  } else if (!hasSubscription) {
    furthest = hasBusiness ? "subscribe" : "business";
  } else if (!shippingStepDone) {
    furthest = "shipping";
  } else if (!payoutsStepDone) {
    furthest = "payouts";
  } else {
    furthest = "import";
  }

  const onboardingStep: OnboardingResumeStep | null =
    member?.signupIntent === "seller" && RESUME_STEPS.has(furthest) ? furthest : null;

  return {
    signupIntent: member?.signupIntent ?? null,
    hasBusiness,
    hasSubscription,
    shippoConnected,
    shippingOptionCount,
    stripeConnectStarted,
    furthest,
    onboardingStep,
    resumePath: onboardingStep ? sellerOnboardingResumePath(onboardingStep) : null,
    firstName: member?.firstName ?? "",
    lastName: member?.lastName ?? "",
    phone: member?.phone ?? "",
  };
}
