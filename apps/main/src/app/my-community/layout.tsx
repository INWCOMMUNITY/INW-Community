import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CheckoutSuccessSessionSync } from "@/components/CheckoutSuccessSessionSync";
import { MyCommunitySignInGate } from "@/components/MyCommunitySignInGate";
import { EventInvitationsSidebar } from "@/components/EventInvitationsSidebar";
import { MyCommunitySidebar } from "@/components/MyCommunitySidebar";
import { MyCommunityRightSidebar } from "@/components/MyCommunityRightSidebar";
import { MyCommunityFloatingMenu } from "@/components/MyCommunityFloatingMenu";

export const dynamic = "force-dynamic";

export default async function MyCommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return (
      <section className="py-12 px-4 lg:pl-[0.5in] lg:pr-6" style={{ paddingTop: "calc(var(--section-padding) + 0.5in)", paddingBottom: "var(--section-padding)" }}>
        <Suspense fallback={null}>
          <CheckoutSuccessSessionSync />
        </Suspense>
        <div className="max-w-[min(100%,1400px)] mx-auto lg:ml-0 lg:mr-auto">
          <h1 className="text-3xl font-bold mb-8">Inland Northwest Community</h1>
          <Suspense fallback={null}>
            <MyCommunitySignInGate />
          </Suspense>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4 lg:pl-[0.5in] lg:pr-6 mt-[0.5in] lg:mb-[0.5in]" style={{ paddingTop: "calc(var(--section-padding) + 0.5in)", paddingBottom: "var(--section-padding)" }}>
      <Suspense fallback={null}>
        <CheckoutSuccessSessionSync />
      </Suspense>
      <div className="max-w-[min(100%,1400px)] mx-auto lg:ml-0 lg:mr-auto flex flex-col lg:flex-row lg:items-stretch gap-10 w-full">
        <aside className="w-full lg:w-56 shrink-0 order-2 lg:order-1 lg:self-stretch">
          <MyCommunitySidebar />
        </aside>
        <div className="flex flex-col flex-1 min-w-0 min-h-0 order-1 lg:order-2 w-full max-w-full lg:min-w-[calc(14rem+2in)]">
          {children}
        </div>
        <div className="w-full lg:w-56 shrink-0 order-3 flex flex-col gap-6 lg:self-stretch">
          <MyCommunityRightSidebar />
          <EventInvitationsSidebar />
        </div>
      </div>
      <MyCommunityFloatingMenu />
    </section>
  );
}
