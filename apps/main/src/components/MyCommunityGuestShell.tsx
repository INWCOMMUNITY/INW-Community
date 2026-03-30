import { Suspense } from "react";
import { CheckoutSuccessSessionSync } from "@/components/CheckoutSuccessSessionSync";

/** Minimal chrome for signed-out visitors on allowlisted /my-community/* routes (e.g. feed). */
export function MyCommunityGuestShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="py-12 px-4 lg:pl-[0.5in] lg:pr-6"
      style={{
        paddingTop: "calc(var(--section-padding) + 0.5in)",
        paddingBottom: "var(--section-padding)",
      }}
    >
      <Suspense fallback={null}>
        <CheckoutSuccessSessionSync />
      </Suspense>
      <div className="max-w-[min(100%,1400px)] mx-auto lg:ml-0 lg:mr-auto">{children}</div>
    </section>
  );
}
