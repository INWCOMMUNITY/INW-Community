"use client";

import Link from "next/link";

export function MyCommunitySignInGate({ callbackUrl = "/my-community" }: { callbackUrl?: string }) {
  return (
    <>
      <div className="flex gap-4 mb-8 border-b opacity-60">
        <span className="py-2 px-4 border-b-2 border-gray-300 font-medium text-gray-500">
          Profile
        </span>
        <span className="py-2 px-4 text-gray-500">Saved</span>
        <span className="py-2 px-4 text-gray-500">Post Event</span>
      </div>
      <div className="max-w-xl rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
        <h2 className="text-xl font-semibold mb-2">Sign in to access your profile and saved items</h2>
        <p className="text-gray-600 mb-6">
          My Community is free for everyone. Sign in to edit your profile, save events and businesses, and post events.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="btn">
            Sign in
          </Link>
          <Link href="/signup" className="btn border border-gray-300 bg-white hover:bg-gray-50">
            Create an account
          </Link>
        </div>
      </div>
    </>
  );
}
