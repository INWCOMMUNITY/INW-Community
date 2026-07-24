/**
 * Listing Quality Score Engine
 * Analyzes listings and provides quality scores with actionable improvement tips.
 */

import type { ChannelProvider } from "./channels/types";
import { validateForProviders } from "./channels/validate-publish";

export interface ScoreBreakdown {
  score: number;
  max: number;
  tips: string[];
}

export interface PhotoAnalysisResult {
  url: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  format?: string;
  issues: string[];
  quality: "good" | "acceptable" | "poor";
}

export interface ChannelReadiness {
  ready: boolean;
  issues: string[];
}

export interface QualityScore {
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: {
    title: ScoreBreakdown;
    description: ScoreBreakdown;
    photos: ScoreBreakdown;
    pricing: ScoreBreakdown;
    completeness: ScoreBreakdown;
  };
  channelReadiness: Record<ChannelProvider, ChannelReadiness>;
  photoAnalysis?: PhotoAnalysisResult[];
}

export interface ListingData {
  title?: string | null;
  description?: string | null;
  photos?: string[];
  priceCents?: number;
  quantity?: number;
  category?: string | null;
  subcategory?: string | null;
  condition?: string | null;
  shippingCostCents?: number | null;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  variants?: unknown[] | null;
  aspects?: unknown;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  ebayCategoryId?: number | null;
}

function getGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

function scoreTitle(title: string | null | undefined): ScoreBreakdown {
  const max = 20;
  const tips: string[] = [];
  let score = 0;

  if (!title) {
    tips.push("Add a title to your listing");
    return { score: 0, max, tips };
  }

  const len = title.trim().length;

  // Length scoring (0-8 points)
  if (len >= 50 && len <= 80) {
    score += 8;
  } else if (len >= 30 && len <= 100) {
    score += 6;
    if (len < 50) tips.push("Consider a more descriptive title (50-80 characters is optimal)");
    if (len > 80) tips.push("Title is a bit long - keep it under 80 characters for better readability");
  } else if (len >= 10) {
    score += 3;
    if (len < 30) tips.push("Title is too short - add more details about your item");
    if (len > 100) tips.push("Title is too long - shorten it to under 100 characters");
  } else {
    tips.push("Title is very short - describe your item in more detail");
  }

  // Capitalization (0-4 points)
  const words = title.split(/\s+/).filter((w) => w.length > 0);
  const allCapsWords = words.filter((w) => w === w.toUpperCase() && w.length > 1);
  const allCapsRatio = words.length > 0 ? allCapsWords.length / words.length : 0;

  if (allCapsRatio > 0.5) {
    tips.push("Avoid using ALL CAPS - it can seem like shouting");
  } else if (allCapsRatio > 0.2) {
    score += 2;
    tips.push("Reduce the use of all-caps words for better readability");
  } else {
    score += 4;
  }

  // Keyword richness (0-4 points) - basic check for common filler
  const hasFillerWords = /\b(nice|good|great|amazing|awesome)\b/i.test(title);
  const hasSpecificDetails = /\b(\d+|size|color|brand|model|vintage|new|used)\b/i.test(title);

  if (hasSpecificDetails) {
    score += 4;
  } else {
    score += 2;
    tips.push("Include specific details like brand, size, color, or model in your title");
  }

  if (hasFillerWords && !hasSpecificDetails) {
    tips.push("Replace generic words like 'nice' or 'great' with specific product details");
  }

  // Punctuation check (0-4 points)
  const hasBadPunctuation = /[!]{2,}|\${2,}|[*#@]+/.test(title);
  if (hasBadPunctuation) {
    tips.push("Avoid excessive punctuation or special characters in your title");
  } else {
    score += 4;
  }

  return { score: Math.min(score, max), max, tips };
}

function scoreDescription(description: string | null | undefined): ScoreBreakdown {
  const max = 20;
  const tips: string[] = [];
  let score = 0;

  if (!description) {
    tips.push("Add a description to help buyers understand your item");
    return { score: 0, max, tips };
  }

  // Strip HTML tags for length calculation
  const plainText = description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const len = plainText.length;

  // Length scoring (0-10 points)
  if (len >= 200) {
    score += 10;
  } else if (len >= 100) {
    score += 7;
    tips.push("Consider adding more detail to your description (200+ characters recommended)");
  } else if (len >= 50) {
    score += 4;
    tips.push("Description is short - add more details about condition, features, or uses");
  } else {
    score += 1;
    tips.push("Description is very short - buyers need more information to make a decision");
  }

  // Formatting check (0-5 points)
  const hasFormatting = /<(p|br|ul|ol|li|b|strong|em|i)[^>]*>/i.test(description);
  const hasLineBreaks = description.includes("\n") || description.includes("<br");

  if (hasFormatting) {
    score += 5;
  } else if (hasLineBreaks) {
    score += 3;
    tips.push("Use bullet points or bold text to highlight key features");
  } else if (len > 200) {
    tips.push("Break up long descriptions with paragraphs or bullet points");
    score += 1;
  }

  // Content quality (0-5 points)
  const hasConditionInfo = /\b(condition|new|used|like new|mint|excellent|good|fair)\b/i.test(plainText);
  const hasDimensions = /\b(\d+\s*(x|by)\s*\d+|\d+\s*(inch|cm|mm|"|')|size|length|width|height)\b/i.test(plainText);
  const hasMaterial = /\b(cotton|wool|leather|plastic|metal|wood|ceramic|glass|fabric|polyester)\b/i.test(plainText);

  let qualityPoints = 0;
  if (hasConditionInfo) qualityPoints += 2;
  else tips.push("Mention the condition of your item");

  if (hasDimensions) qualityPoints += 2;
  else if (len > 100) tips.push("Include measurements or dimensions when relevant");

  if (hasMaterial) qualityPoints += 1;

  score += qualityPoints;

  // Check for spam signals
  const hasUrlSpam = /(https?:\/\/|www\.)[^\s]+/gi.test(description);
  const hasContactInfo = /\b(email|call|text|whatsapp|telegram)\s*(me|us)?\s*[:\-@]/i.test(plainText);

  if (hasUrlSpam || hasContactInfo) {
    score = Math.max(0, score - 5);
    tips.push("Avoid including external links or contact information in descriptions");
  }

  return { score: Math.min(score, max), max, tips };
}

function scorePhotos(photos: string[] | undefined, photoAnalysis?: PhotoAnalysisResult[]): ScoreBreakdown {
  const max = 30;
  const tips: string[] = [];
  let score = 0;

  const count = photos?.length ?? 0;

  if (count === 0) {
    tips.push("Add photos to your listing - items with photos sell much better");
    return { score: 0, max, tips };
  }

  // Photo count scoring (0-15 points)
  if (count >= 5) {
    score += 15;
  } else if (count >= 3) {
    score += 12;
    tips.push("Add more photos (5+ recommended) to show different angles");
  } else if (count >= 2) {
    score += 8;
    tips.push("Add more photos to help buyers see your item from different angles");
  } else {
    score += 4;
    tips.push("Single photo listings get fewer views - add 3-5 photos minimum");
  }

  // Photo quality scoring from analysis (0-15 points)
  if (photoAnalysis && photoAnalysis.length > 0) {
    const goodPhotos = photoAnalysis.filter((p) => p.quality === "good").length;
    const poorPhotos = photoAnalysis.filter((p) => p.quality === "poor").length;

    const qualityScore = Math.round((goodPhotos / photoAnalysis.length) * 15);
    score += qualityScore;

    if (poorPhotos > 0) {
      tips.push(`${poorPhotos} photo(s) have quality issues - consider replacing them`);
    }

    // Collect specific issues
    const issues = new Set<string>();
    for (const photo of photoAnalysis) {
      for (const issue of photo.issues) {
        issues.add(issue);
      }
    }
    for (const issue of issues) {
      if (!tips.some((t) => t.includes(issue.substring(0, 20)))) {
        tips.push(issue);
      }
    }
  } else {
    // No analysis available, give partial credit
    score += 8;
  }

  return { score: Math.min(score, max), max, tips };
}

function scorePricing(listing: ListingData): ScoreBreakdown {
  const max = 15;
  const tips: string[] = [];
  let score = 0;

  const price = listing.priceCents ?? 0;

  if (price <= 0) {
    tips.push("Set a price for your listing");
    return { score: 0, max, tips };
  }

  // Price reasonableness (0-10 points)
  // Very low prices might indicate errors, very high might scare buyers
  const priceDollars = price / 100;

  if (priceDollars >= 1 && priceDollars <= 10000) {
    score += 10;
  } else if (priceDollars > 0 && priceDollars < 1) {
    score += 5;
    tips.push("Very low price - make sure this is intentional");
  } else if (priceDollars > 10000) {
    score += 7;
    tips.push("High-value item - consider detailed documentation of authenticity/condition");
  }

  // Shipping pricing (0-5 points)
  if (listing.shippingDisabled) {
    if (listing.localDeliveryAvailable || listing.inStorePickupAvailable) {
      score += 5;
    } else {
      score += 2;
      tips.push("Enable at least one fulfillment option (shipping, delivery, or pickup)");
    }
  } else {
    const shippingCost = listing.shippingCostCents ?? 0;
    if (shippingCost === 0) {
      score += 5; // Free shipping is great
    } else if (shippingCost <= price * 0.2) {
      score += 4;
    } else if (shippingCost <= price * 0.5) {
      score += 3;
      tips.push("Shipping cost is relatively high compared to item price");
    } else {
      score += 1;
      tips.push("Shipping cost seems high - buyers may be deterred");
    }
  }

  return { score: Math.min(score, max), max, tips };
}

function scoreCompleteness(listing: ListingData): ScoreBreakdown {
  const max = 15;
  const tips: string[] = [];
  let score = 0;

  // Category (0-4 points)
  if (listing.category) {
    score += 3;
    if (listing.subcategory) {
      score += 1;
    } else {
      tips.push("Add a subcategory for better discoverability");
    }
  } else {
    tips.push("Select a category to help buyers find your item");
  }

  // Condition (0-3 points)
  if (listing.condition) {
    score += 3;
  } else {
    tips.push("Specify the item condition (new or used)");
  }

  // Quantity (0-2 points)
  if (listing.quantity && listing.quantity > 0) {
    score += 2;
  } else {
    tips.push("Set quantity to at least 1");
  }

  // Fulfillment options (0-3 points)
  const fulfillmentOptions = [
    !listing.shippingDisabled,
    listing.localDeliveryAvailable,
    listing.inStorePickupAvailable,
  ].filter(Boolean).length;

  if (fulfillmentOptions >= 2) {
    score += 3;
  } else if (fulfillmentOptions === 1) {
    score += 2;
    tips.push("Offering multiple fulfillment options (shipping + local pickup) increases sales");
  } else {
    tips.push("Enable at least one fulfillment option");
  }

  // Variants/Aspects (0-3 points)
  const hasVariants = listing.variants && Array.isArray(listing.variants) && listing.variants.length > 0;
  const hasAspects = listing.aspects && typeof listing.aspects === "object";

  if (hasVariants || hasAspects) {
    score += 3;
  } else {
    // Only suggest if it seems appropriate
    if (listing.title && /\b(size|color|style)\b/i.test(listing.title)) {
      tips.push("Consider adding variants if your item comes in different sizes or colors");
    }
  }

  return { score: Math.min(score, max), max, tips };
}

/**
 * Calculate overall quality score for a listing.
 */
export async function calculateQualityScore(
  listing: ListingData,
  options?: {
    photoAnalysis?: PhotoAnalysisResult[];
    checkChannelReadiness?: boolean;
    memberConnections?: Array<{ provider: string; status: string; etsyShippingProfileId?: string | null; config?: unknown }>;
  }
): Promise<QualityScore> {
  const titleScore = scoreTitle(listing.title);
  const descriptionScore = scoreDescription(listing.description);
  const photosScore = scorePhotos(listing.photos, options?.photoAnalysis);
  const pricingScore = scorePricing(listing);
  const completenessScore = scoreCompleteness(listing);

  const overall =
    titleScore.score +
    descriptionScore.score +
    photosScore.score +
    pricingScore.score +
    completenessScore.score;

  // Channel readiness
  let channelReadiness: Record<ChannelProvider, ChannelReadiness> = {
    ebay: { ready: false, issues: ["Not checked"] },
    etsy: { ready: false, issues: ["Not checked"] },
    shopify: { ready: false, issues: ["Not checked"] },
    wix: { ready: false, issues: ["Not checked"] },
  };

  if (options?.checkChannelReadiness) {
    const providers: ChannelProvider[] = ["ebay", "etsy", "shopify", "wix"];
    const validationResults = await validateForProviders(
      {
        title: listing.title ?? "",
        description: listing.description ?? "",
        photos: listing.photos ?? [],
        priceCents: listing.priceCents ?? 0,
        quantity: listing.quantity ?? 0,
        category: listing.category ?? undefined,
        condition: listing.condition ?? "new",
        etsyWhoMade: listing.etsyWhoMade ?? undefined,
        etsyWhenMade: listing.etsyWhenMade ?? undefined,
        etsyIsSupply: listing.etsyIsSupply ?? undefined,
        ebayCategoryId: listing.ebayCategoryId ?? undefined,
        aspects: listing.aspects as Record<string, string> | undefined,
      },
      providers,
      options?.memberConnections
    );

    for (const provider of providers) {
      const result = validationResults.byProvider[provider];
      channelReadiness[provider] = {
        ready: result.valid,
        issues: [...result.errors.map((e) => e.message), ...result.warnings.map((w) => w.message)],
      };
    }
  }

  return {
    overall,
    grade: getGrade(overall),
    breakdown: {
      title: titleScore,
      description: descriptionScore,
      photos: photosScore,
      pricing: pricingScore,
      completeness: completenessScore,
    },
    channelReadiness,
    photoAnalysis: options?.photoAnalysis,
  };
}

/**
 * Get a quick summary of quality issues for display.
 */
export function getQualityIssueSummary(score: QualityScore): string[] {
  const issues: string[] = [];

  // Get top 3 most impactful tips
  const allTips = [
    ...score.breakdown.photos.tips,
    ...score.breakdown.title.tips,
    ...score.breakdown.description.tips,
    ...score.breakdown.pricing.tips,
    ...score.breakdown.completeness.tips,
  ];

  return allTips.slice(0, 5);
}
