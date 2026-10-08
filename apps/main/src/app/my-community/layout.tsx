import { Suspense } from "react";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CheckoutSuccessSessionSync } from "@/components/CheckoutSuccessSessionSync";
import { MyCommunitySignInGate } from "@/components/MyCommunitySignInGate";
import { MyCommunityGuestSidebar } from "@/components/MyCommunityGuestSidebar";
import { EventInvitationsSidebar } from "@/components/EventInvitationsSidebar";
import { MyCommunitySidebar } from "@/components/MyCommunitySidebar";
import { MyCommunityRightSidebar } from "@/components/MyCommunityRightSidebar";
import { MyCommunityFloatingMenu } from "@/components/MyCommunityFloatingMenu";
import { MyCommunityNavGrid } from "@/components/SiteNavAlignedColumn";
import { isGuestAllowedMyCommunityPath } from "@/lib/guest-access-paths";

export const dynamic = "force-dynamic";

export default async function MyCommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const pathname = headers().get("x-pathname") ?? "";
    if (pathname && isGuestAllowedMyCommunityPath(pathname)) {
      return (
        <section
          className="py-12 mt-[0.5in] lg:mb-[0.5in] overflow-visible"
          style={{
            paddingTop: "calc(var(--section-padding) + 0.5in)",
            paddingBottom: "var(--section-padding)",
          }}
        >
          <Suspense fallback={null}>
            <CheckoutSuccessSessionSync />
          </Suspense>
          <MyCommunityNavGrid sidebar={<MyCommunityGuestSidebar />}>{children}</MyCommunityNavGrid>
        </section>
      );
    }
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

  const pathname = headers().get("x-pathname") ?? "";
  const isMessages = pathname.startsWith("/my-community/messages");

  return (
    <section
      className={
        isMessages
          ? "max-md:!p-0 max-md:!m-0 max-md:overflow-hidden max-md:h-[calc(100dvh-var(--site-header-height))] max-md:flex max-md:flex-col py-12 mt-[0.5in] lg:mb-[0.5in] overflow-visible"
          : "py-12 mt-[0.5in] lg:mb-[0.5in] overflow-visible"
      }
      style={{
        paddingTop: "calc(var(--section-padding) + 0.5in)",
        paddingBottom: "var(--section-padding)",
      }}
    >
      <Suspense fallback={null}>
        <CheckoutSuccessSessionSync />
      </Suspense>
      <MyCommunityNavGrid
        fullBleedMobile={isMessages}
        className={isMessages ? "max-md:flex-1 max-md:min-h-0 max-md:h-full" : undefined}
        sidebar={<MyCommunitySidebar />}
        asideRight={
          <>
            <MyCommunityRightSidebar />
            <EventInvitationsSidebar />
          </>
        }
      >
        {children}
      </MyCommunityNavGrid>
      <MyCommunityFloatingMenu />
    </section>
  );
}
