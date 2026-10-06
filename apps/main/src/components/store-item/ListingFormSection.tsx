"use client";

import type { ReactNode } from "react";

type ListingFormSectionProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  id?: string;
};

export function ListingFormSection({ title, description, children, id }: ListingFormSectionProps) {
  return (
    <section
      id={id}
      className="rounded-xl bg-white p-5 shadow-sm space-y-4"
      style={{ border: "1.5px solid var(--color-primary)" }}
    >
      {title ? (
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description ? <p className="text-xs text-gray-500 mt-1">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
