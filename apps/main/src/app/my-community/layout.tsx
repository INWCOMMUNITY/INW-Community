import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <h1 className="text-3xl font-bold mb-8">My Community</h1>
          <MyCommunitySignInGate callbackUrl="/my-community" />
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-56 shrink-0 order-2 lg:order-1">
          <MyCommunitySidebar />
        </aside>
        <div className="flex-1 min-w-0 order-1 lg:order-2">{children}</div>
        <div className="w-full lg:w-56 shrink-0 order-3 flex flex-col gap-6">
          <MyCommunityRightSidebar />
          <EventInvitationsSidebar />
        </div>
      </div>
      <MyCommunityFloatingMenu />
    </section>
  );
}
