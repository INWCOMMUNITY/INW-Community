"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEventForm } from "./AdminEventForm";

export function AdminEventsAddButton() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  function handleClose() {
    setShowForm(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="rounded px-4 py-2 text-sm"
        style={{ backgroundColor: "#505542", color: "#fff" }}
      >
        Add event
      </button>
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">Add event</h2>
            </div>
            <AdminEventForm onClose={handleClose} />
          </div>
        </div>
      )}
    </>
  );
}
