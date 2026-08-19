"use client";

import { useState } from "react";
import { NWCRequestsModal } from "./NWCRequestsModal";

export function NWCRequestsTrigger({
  variant = "button",
}: {
  variant?: "button" | "link";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variant === "link" ? "hover:underline bg-transparent border-0 p-0 cursor-pointer" : "btn inline-block"}
        style={variant === "link" ? { font: "inherit", color: "inherit" } : undefined}
      >
        NWC Requests
      </button>
      <NWCRequestsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
