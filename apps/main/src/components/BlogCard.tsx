"use client";

import Link from "next/link";
import Image from "next/image";
import { ShareButton } from "./ShareButton";

interface BlogCardProps {
  blog: {
    id: string;
    slug: string;
    title: string;
    body: string;
    photos: string[];
    createdAt: Date;
    member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    category: { name: string; slug: string };
  };
}

export function BlogCard({ blog }: BlogCardProps) {
  const excerpt = blog.body.replace(/<[^>]*>/g, "").slice(0, 200);
  const date = new Date(blog.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <article className="border rounded-lg overflow-hidden bg-white relative">
      <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
        <ShareButton type="blog" id={blog.id} slug={blog.slug} title={blog.title} className="p-1.5 rounded-full bg-white/90 border border-gray-200 hover:bg-gray-50" />
      </div>
      <Link href={`/blog/${blog.slug}`} className="block">
        {blog.photos.length > 0 && (
          <div className="relative h-48 bg-gray-100">
            <Image
              src={blog.photos[0]}
              alt=""
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 400px"
            />
          </div>
        )}
        <div className="p-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{blog.category.name}</span>
          <h2 className="text-xl font-bold mt-1 mb-2">{blog.title}</h2>
          <p className="text-gray-600 text-sm line-clamp-2">{excerpt}…</p>
          <div className="flex items-center gap-3 mt-4">
            {blog.member.profilePhotoUrl ? (
              <Image
                src={blog.member.profilePhotoUrl}
                alt=""
                width={32}
                height={32}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                {blog.member.firstName?.[0]}{blog.member.lastName?.[0]}
              </div>
            )}
            <span className="text-sm text-gray-600">
              {blog.member.firstName} {blog.member.lastName}
            </span>
            <span className="text-sm text-gray-400">· {date}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
