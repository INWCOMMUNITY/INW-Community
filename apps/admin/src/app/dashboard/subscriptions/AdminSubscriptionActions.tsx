"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminPauseSubscriptionButton } from "../AdminPauseSubscriptionButton";

export function AdminSubscriptionActions({
  memberId,
  plan,
  status,
  profileRetained,
}: {
  memberId: string;
  plan: string;
  status: string;
  profileRetained: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  const accessStatuses = new Set(["active", "trialing", "past_due"]);
  const isBusinessPlan = plan === "sponsor" || plan === "seller";
  const canPause = isBusinessPlan && accessStatuses.has(status) && !done;

  if (!canPause && !profileRetained) {
    return <span className="text-gray-400 text-sm">—</span>;
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      {profileRetained && (
        <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-800">Profile retained</span>
      )}
      {canPause && (
        <AdminPauseSubscriptionButton
          memberId={memberId}
          onSuccess={() => {
            setDone(true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
