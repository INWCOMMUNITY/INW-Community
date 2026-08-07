"use client";

import { type ReactNode } from "react";

interface SkeletonProps {
  className?: string;
  children?: ReactNode;
}

/** Base skeleton with pulsing animation */
export function Skeleton({ className = "", children }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-gray-200 ${className}`} aria-hidden="true">
      {children}
    </div>
  );
}

/** Product card skeleton placeholder */
export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <Skeleton className="aspect-[4/5]" />
      <div className="p-2.5 space-y-2">
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
        <Skeleton className="h-5 w-1/3 rounded" />
      </div>
    </div>
  );
}

/** Feed post skeleton placeholder */
export function SkeletonFeedPost() {
  return (
    <div className="rounded-xl bg-white shadow-sm p-4 space-y-3">
      {/* Author row */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="h-3 w-1/4 rounded" />
        </div>
      </div>
      {/* Content */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-5/6 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
      {/* Image placeholder */}
      <Skeleton className="aspect-video rounded-lg" />
      {/* Actions */}
      <div className="flex gap-4 pt-2">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** Business card skeleton placeholder */
export function SkeletonBusinessCard() {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <Skeleton className="aspect-[3/2]" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Generic list skeleton placeholder */
export function SkeletonList({ count = 5, itemHeight = "h-16" }: { count?: number; itemHeight?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className={`${itemHeight === "h-16" ? "h-4" : "h-3"} w-2/3 rounded`} />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal carousel skeleton */
export function SkeletonCarousel({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="shrink-0 w-36 sm:w-44">
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}

/** Full page skeleton for detail pages */
export function SkeletonDetailPage() {
  return (
    <div className="space-y-6 p-4">
      {/* Hero image */}
      <Skeleton className="aspect-video rounded-xl" />
      {/* Title and info */}
      <div className="space-y-3">
        <Skeleton className="h-8 w-3/4 rounded" />
        <Skeleton className="h-5 w-1/2 rounded" />
        <Skeleton className="h-5 w-1/3 rounded" />
      </div>
      {/* Action buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-12 flex-1 rounded-full" />
        <Skeleton className="h-12 flex-1 rounded-full" />
      </div>
      {/* Description */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-5/6 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
    </div>
  );
}
