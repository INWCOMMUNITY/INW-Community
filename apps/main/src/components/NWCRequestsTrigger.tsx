"use client";

import { useState } from "react";
import { NWCRequestsModal } from "./NWCRequestsModal";

export function NWCRequestsTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn inline-block"
      >
        NWC Requests
      </button>
      <NWCRequestsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
