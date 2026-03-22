import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      isSubscriber?: boolean;
      /** Active Subscribe (Resident) plan — Resale Hub + coupon book; not Business/Seller alone */
      canAccessResaleHub?: boolean;
      isAdmin?: boolean;
    };
  }
}
