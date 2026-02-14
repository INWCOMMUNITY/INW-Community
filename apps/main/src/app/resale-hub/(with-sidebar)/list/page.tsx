"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { StoreItemForm } from "@/components/StoreItemForm";

type ExistingItem = React.ComponentProps<typeof StoreItemForm>["existing"];

function ResaleHubListContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const [existing, setExisting] = useState<ExistingItem>(undefined);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  useEffect(() => {
    if (!editId) {
      setExisting(undefined);
      setLoadingEdit(false);
      return;
    }
    setLoadingEdit(true);
    fetch(`/api/store-items/${editId}`)
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((item) => {
        if (item && item.memberId) setExisting(item);
        else setExisting(undefined);
      })
      .catch(() => setExisting(undefined))
      .finally(() => setLoadingEdit(false));
  }, [editId]);

  return (
    <div className="max-w-xl max-md:w-full max-md:mx-auto max-md:flex max-md:flex-col max-md:items-center">
      <Link
        href="/resale-hub"
        className="text-sm text-gray-600 hover:underline mb-4 inline-block max-md:block max-md:text-center"
      >
        ← Back to Resale Hub
      </Link>
      <h1 className="text-2xl font-bold mb-6 max-md:text-center">
        {existing ? "Edit resale item" : "List a resale item"}
      </h1>
      <p className="text-gray-600 mb-6 max-md:text-center">
        Your item will appear on Community Resale. Buyers can make offers and
        message you. You can offer shipping, local delivery, or pickup.
      </p>
      {loadingEdit ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <StoreItemForm
          existing={existing ?? undefined}
          resaleOnly
          successRedirect="/resale-hub/listings"
        />
      )}
    </div>
  );
}

export default function ResaleHubListPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
      <ResaleHubListContent />
    </Suspense>
  );
}
