/**
 * Prebuilt business primary categories and subcategories (v2).
 * Signup/edit can pick from the list or use a custom primary/subcategory string.
 * Badge QR rules use primary labels only; see badge-category-scan.ts.
 */

export interface BusinessCategoryOption {
  label: string;
  subcategories: string[];
}

export const BUSINESS_CATEGORIES: BusinessCategoryOption[] = [
  { label: "Bar", subcategories: ["Sports Bar", "Wine Bar", "Pub", "Brewery Taproom", "Lounge", "Nightclub", "Other"] },
  { label: "Coffee Shop", subcategories: ["Café", "Drive-Thru", "Roaster", "Bakery Café", "Other"] },
  {
    label: "Restaurant",
    subcategories: [
      "Fine Dining",
      "Casual Dining",
      "Family",
      "Fast Casual",
      "Food Truck",
      "Pizza",
      "Bakery and Desserts",
      "Ethnic and International",
      "Deli",
      "Catering",
      "Other",
    ],
  },
  { label: "Bakery", subcategories: ["Retail Bakery", "Wholesale", "Custom Cakes", "Other"] },
  {
    label: "Grocery and Markets",
    subcategories: ["Grocery Store", "Farmers Market Vendor", "Specialty Foods", "Co-op", "Butcher", "Seafood Market", "Other"],
  },
  {
    label: "Mechanic",
    subcategories: ["General Auto Repair", "Transmission", "Brakes and Tires", "Oil and Lube", "Diagnostics", "Fleet", "Other"],
  },
  {
    label: "Automotive",
    subcategories: ["General Auto Service", "Diagnostics", "Body and Collision", "Detailing (Shop)", "Mobile Mechanic", "Other"],
  },
  { label: "Car Dealership", subcategories: ["New Vehicles", "Used Vehicles", "Both", "Other"] },
  { label: "Auto Parts and Tires", subcategories: ["Parts Store", "Tire Shop", "Accessories", "Other"] },
  { label: "Car Wash and Detailing", subcategories: ["Car Wash", "Detailing", "Both", "Other"] },
  { label: "Handyman", subcategories: ["General Repairs", "Assembly", "Minor Carpentry", "Painting (Small Jobs)", "Other"] },
  { label: "Plumber", subcategories: ["Residential", "Commercial", "Emergency", "Drains and Sewer", "Water Heater", "Other"] },
  { label: "Electrician", subcategories: ["Residential", "Commercial", "EV Charging", "Generator", "Lighting", "Other"] },
  { label: "Drywaller", subcategories: ["Install", "Repair", "Texture and Finish", "Other"] },
  { label: "HVAC", subcategories: ["Heating", "Cooling", "Both", "Commercial", "Other"] },
  {
    label: "Concrete",
    subcategories: ["Driveways and Flatwork", "Decorative and Stamped", "Foundations", "Repair and Leveling", "Other"],
  },
  { label: "General Contractor", subcategories: ["New Build", "Remodel", "Commercial", "Other"] },
  { label: "Roofing", subcategories: ["Residential", "Commercial", "Repair", "Other"] },
  {
    label: "Landscaping and Lawn",
    subcategories: ["Design", "Maintenance", "Irrigation", "Tree Service", "Snow Removal", "Other"],
  },
  { label: "Painter", subcategories: ["Interior", "Exterior", "Commercial", "Other"] },
  { label: "Flooring", subcategories: ["Install", "Refinish", "Sales", "Other"] },
  { label: "Windows and Doors", subcategories: ["Install", "Repair", "Glass", "Other"] },
  { label: "Pest Control", subcategories: ["Residential", "Commercial", "Wildlife", "Other"] },
  {
    label: "Cleaning Services",
    subcategories: ["Residential", "Commercial", "Carpet and Upholstery", "Post-Construction", "Other"],
  },
  { label: "Moving and Storage", subcategories: ["Local Moving", "Long Distance", "Storage", "Packing", "Other"] },
  {
    label: "Photographer",
    subcategories: ["Portrait", "Wedding and Events", "Commercial", "Real Estate", "Product", "Other"],
  },
  { label: "Salon and Barbershop", subcategories: ["Hair Salon", "Barber", "Nails", "Spa Services", "Other"] },
  {
    label: "Tattoo and Piercing Studio",
    subcategories: ["Tattoos", "Piercing", "Both", "Other"],
  },
  { label: "Spa and Massage", subcategories: ["Day Spa", "Medical Spa", "Massage Therapy", "Other"] },
  {
    label: "Fitness and Gym",
    subcategories: ["Gym", "Studio (Yoga, Pilates, etc.)", "CrossFit", "Personal Training", "Other"],
  },
  {
    label: "Health and Dental",
    subcategories: ["Dental", "Medical Clinic", "Chiropractor", "Optometry", "Physical Therapy", "Occupational Therapy", "Other"],
  },
  {
    label: "Therapists and Mental Health",
    subcategories: [
      "Licensed Therapist",
      "Counselor",
      "Psychologist",
      "Marriage and Family",
      "Social Worker",
      "Group Practice",
      "Solo Practice",
      "Other",
    ],
  },
  {
    label: "Coaching and Consulting",
    subcategories: [
      "Life and Personal Coaching",
      "Executive and Leadership Coaching",
      "Business Consulting",
      "Workshops and Speaking",
      "Other",
    ],
  },
  { label: "Pharmacy", subcategories: ["Retail Pharmacy", "Compounding", "Other"] },
  {
    label: "Pet Services",
    subcategories: ["Veterinary", "Grooming", "Boarding and Daycare", "Training", "Pet Retail", "Other"],
  },
  {
    label: "Childcare and Education",
    subcategories: ["Daycare", "Preschool", "Tutoring", "Dance and Music School", "Martial Arts", "Other"],
  },
  { label: "Hotel and Lodging", subcategories: ["Hotel", "Motel", "B&B", "Vacation Rental Office", "Campground", "Other"] },
  {
    label: "Accounting and Tax Services",
    subcategories: ["Bookkeeping", "Tax Preparation", "CPA Firm", "Payroll", "Audit", "Other"],
  },
  {
    label: "Legal Services",
    subcategories: ["General Practice", "Family Law", "Criminal Defense", "Estate Planning", "Business Law", "Real Estate Law", "Other"],
  },
  { label: "Insurance Services", subcategories: ["Auto", "Home", "Life", "Business", "Health", "Other"] },
  {
    label: "Financial Advisors and Services",
    subcategories: ["Financial Planning", "Investment Advisory", "Wealth Management", "Retirement Planning", "Other"],
  },
  {
    label: "Real Estate Agents and Services",
    subcategories: ["Buyer's Agent", "Listing Agent", "Brokerage", "Commercial Real Estate", "Property Management", "Team", "Solo Agent", "Other"],
  },
  {
    label: "Marketing and Advertising",
    subcategories: ["Digital Marketing", "Advertising Agency", "Branding", "Graphic Design", "SEO", "Other"],
  },
  {
    label: "Staffing and Recruiting",
    subcategories: [
      "Temporary Staffing",
      "Permanent Placement",
      "Industry-Specific Recruiting",
      "Skilled Trades Staffing",
      "Office and Professional Staffing",
      "Other",
    ],
  },
  { label: "Office Supplies and Services", subcategories: ["Print and Copy", "Shipping Center", "Office Retail", "Other"] },
  {
    label: "Retail (General Merchandise)",
    subcategories: [
      "Apparel",
      "Electronics",
      "Home Goods",
      "Health and Beauty",
      "Gifts",
      "Sporting Goods",
      "Hobby",
      "Thrift and Resale",
      "Other",
    ],
  },
  { label: "Arts and Culture", subcategories: ["Gallery", "Studio", "Performing Arts", "Museum", "Other"] },
  { label: "Entertainment and Recreation", subcategories: ["Bowling", "Arcade", "Venue", "Golf", "Pool Hall", "Other"] },
  { label: "Farm and Ranch", subcategories: ["Farm Stand", "Feed and Supply", "Equipment", "Other"] },
  {
    label: "Religious and Nonprofit Org",
    subcategories: ["Place of Worship", "Nonprofit Office", "Charity Retail", "Other"],
  },
  { label: "Government and Community", subcategories: ["Government Office", "Library", "Community Center", "Other"] },
  { label: "Funeral and Memorial", subcategories: ["Funeral Home", "Cremation", "Monument", "Other"] },
  { label: "Security and Locksmith", subcategories: ["Locksmith", "Security Systems", "Safe and Vault", "Other"] },
  { label: "Sign and Print", subcategories: ["Sign Shop", "Screen Printing", "Embroidery", "Other"] },
  { label: "Laundry and Dry Cleaning", subcategories: ["Dry Cleaner", "Laundromat", "Alterations", "Other"] },
];

export const BUSINESS_CATEGORY_LABELS = BUSINESS_CATEGORIES.map((c) => c.label);

export function getSubcategoriesForBusinessCategory(categoryLabel: string): string[] {
  const cat = BUSINESS_CATEGORIES.find((c) => c.label === categoryLabel);
  return cat ? cat.subcategories : [];
}

export function filterBusinessCategories(search: string): BusinessCategoryOption[] {
  const q = search.trim().toLowerCase();
  if (!q) return BUSINESS_CATEGORIES;
  return BUSINESS_CATEGORIES.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.subcategories.some((s) => s.toLowerCase().includes(q))
  );
}

/** Multiple subs per primary: map primary label -> sub labels (stored as JSON on Business). */
export type SubcategoriesByPrimary = Record<string, string[]>;

const MAX_SUBS_PER_PRIMARY = 30;

export function parseSubcategoriesByPrimary(raw: unknown): SubcategoriesByPrimary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SubcategoriesByPrimary = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (Array.isArray(v)) {
      const arr = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
      if (arr.length) out[key] = arr.slice(0, MAX_SUBS_PER_PRIMARY);
    }
  }
  return out;
}

/** Keep only keys that appear in categories; cap list length. */
export function normalizeSubcategoriesByPrimary(categories: string[], input: unknown): SubcategoriesByPrimary {
  const catSet = new Set(categories.map((c) => c.trim()).filter(Boolean));
  const parsed = parseSubcategoriesByPrimary(input);
  const out: SubcategoriesByPrimary = {};
  for (const c of catSet) {
    const list = parsed[c] ?? [];
    out[c] = list.slice(0, MAX_SUBS_PER_PRIMARY);
  }
  return out;
}

/** Directory filter: optional sub must appear under that primary's list. */
export function businessMatchesCategoryAndSub(
  categories: string[],
  subcategoriesByPrimary: unknown,
  primary: string,
  sub?: string | null
): boolean {
  const primaries = categories ?? [];
  if (!primary || !primaries.includes(primary)) return false;
  if (!sub?.trim()) return true;
  const map = parseSubcategoriesByPrimary(subcategoriesByPrimary);
  const list = map[primary] ?? [];
  return list.includes(sub.trim());
}
