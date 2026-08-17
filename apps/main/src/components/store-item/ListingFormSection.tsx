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
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
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
