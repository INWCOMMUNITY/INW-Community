import { describe, expect, it } from "vitest";
import { syncContentHash } from "./sync-baseline";

describe("syncContentHash", () => {
  it("ignores Wix CDN file-id churn at the same photo count", () => {
    const a = syncContentHash({
      title: "Shadow Gate",
      description: "<p>Complete in box.</p>",
      priceCents: 6000,
      photos: ["https://static.wixstatic.com/media/2bdd49_aaa~mv2.jpg"],
    });
    const b = syncContentHash({
      title: "Shadow Gate",
      description: "Complete in box.",
      priceCents: 6000,
      photos: ["https://static.wixstatic.com/media/2bdd49_bbb~mv2.jpg"],
    });
    expect(a).toBe(b);
  });

  it("changes when INW Blob photo URLs change", () => {
    const a = syncContentHash({
      title: "Shadow Gate",
      description: "CIB",
      priceCents: 6000,
      photos: ["https://abc.public.blob.vercel-storage.com/old.jpg"],
    });
    const b = syncContentHash({
      title: "Shadow Gate",
      description: "CIB",
      priceCents: 6000,
      photos: ["https://abc.public.blob.vercel-storage.com/new.jpg"],
    });
    expect(a).not.toBe(b);
  });
});
