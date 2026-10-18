/**
 * Duplicated from apps/main/src/lib/business-categories.ts (preset list + getter only).
 * Keep in sync when editing directory categories on web.
 *
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
  {
    label: "Antique Retailer",
    subcategories: ["Furniture", "Jewelry", "Glass and China", "Collectibles", "Books and Paper", "Silver and Metalware", "Other"],
  },
  {
    label: "Clothing",
    subcategories: ["Women's", "Men's", "Kids", "Vintage", "Streetwear", "Activewear", "Accessories", "Other"],
  },
  {
    label: "Pottery and Ceramics",
    subcategories: ["Mugs and Drinkware", "Dinnerware", "Decorative", "Planters", "Sculpture", "Other"],
  },
  {
    label: "Jewelry",
    subcategories: ["Fine Jewelry", "Costume Jewelry", "Handmade", "Vintage", "Watches", "Beads and Findings", "Other"],
  },
  {
    label: "Home Decor",
    subcategories: ["Wall Art", "Textiles", "Lighting", "Seasonal", "Candles", "Furniture", "Other"],
  },
  {
    label: "Art and Prints",
    subcategories: ["Original Paintings", "Prints", "Photography", "Sculpture", "Digital Art", "Other"],
  },
  {
    label: "Handmade Goods",
    subcategories: ["Fiber and Knit", "Wood", "Candles and Soap", "Paper Goods", "Leather", "Other"],
  },
  {
    label: "Vintage and Collectibles",
    subcategories: ["Toys", "Trading Cards", "Coins and Stamps", "Comics", "Memorabilia", "Advertising", "Other"],
  },
  {
    label: "Beauty and Personal Care",
    subcategories: ["Skincare", "Makeup", "Hair Care", "Fragrance", "Bath and Body", "Other"],
  },
  {
    label: "Toys and Games",
    subcategories: ["Kids Toys", "Board Games", "Puzzles", "Outdoor Play", "Collectible Figures", "Other"],
  },
  {
    label: "Baby and Kids",
    subcategories: ["Clothing", "Nursery", "Toys", "Gear", "Keepsakes", "Other"],
  },
  {
    label: "Pet Supplies",
    subcategories: ["Toys", "Apparel", "Treats", "Beds", "Collars and Leashes", "Other"],
  },
  {
    label: "Shoes and Bags",
    subcategories: ["Shoes", "Handbags", "Wallets", "Luggage", "Other"],
  },
  {
    label: "Furniture",
    subcategories: ["Seating", "Tables", "Storage", "Bedroom", "Outdoor", "Other"],
  },
  {
    label: "Outdoor and Sporting Goods",
    subcategories: ["Camping", "Hunting and Fishing", "Cycling", "Fitness", "Team Sports", "Other"],
  },
  {
    label: "Electronics",
    subcategories: ["Audio", "Phone Accessories", "Computers", "Cameras", "Smart Home", "Refurbished", "Other"],
  },
  {
    label: "Books and Stationery",
    subcategories: ["Books", "Journals", "Stickers", "Planners", "Art Supplies", "Other"],
  },
  {
    label: "Craft Supplies",
    subcategories: ["Fabric", "Yarn", "Beads", "Paint", "Tools", "Paper", "Other"],
  },
  {
    label: "Garden and Plants",
    subcategories: ["Houseplants", "Seeds", "Planters", "Garden Decor", "Tools", "Other"],
  },
  {
    label: "Food and Specialty Pantry",
    subcategories: ["Coffee and Tea", "Baked Goods", "Sauces and Spices", "Candy", "Gift Baskets", "Other"],
  },
  {
    label: "Wedding and Party",
    subcategories: ["Invitations", "Decor", "Favors", "Attire", "Other"],
  },
  {
    label: "Music",
    subcategories: ["Instruments", "Accessories", "Records and CDs", "Sheet Music", "Other"],
  },
  {
    label: "Health Products",
    subcategories: ["Supplements", "Fitness Accessories", "Aromatherapy", "Mobility Aids", "Other"],
  },
  {
    label: "Auto Accessories",
    subcategories: ["Parts", "Interior Accessories", "Detailing", "Wheels and Tires", "Other"],
  },
];

const SELLER_RETAIL_START = "Antique Retailer";

/** Seller signup leads with shop categories, then the local-business list. */
export function sellerSignupCategories(): BusinessCategoryOption[] {
  const start = BUSINESS_CATEGORIES.findIndex((category) => category.label === SELLER_RETAIL_START);
  if (start < 0) return BUSINESS_CATEGORIES;
  const retail = BUSINESS_CATEGORIES.slice(start);
  const retailLabels = new Set(retail.map((category) => category.label));
  const rest = BUSINESS_CATEGORIES.filter((category) => !retailLabels.has(category.label));
  return [...retail, ...rest];
}

export const BUSINESS_CATEGORY_LABELS = BUSINESS_CATEGORIES.map((c) => c.label);

export function getSubcategoriesForBusinessCategory(categoryLabel: string): string[] {
  const cat = BUSINESS_CATEGORIES.find((c) => c.label === categoryLabel);
  return cat ? cat.subcategories : [];
}
