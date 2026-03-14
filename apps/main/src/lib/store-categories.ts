/**
 * Prebuilt store categories and subcategories for storefront listings.
 * Users can search/filter and select, or add a custom category.
 */

export interface StoreCategoryOption {
  label: string;
  subcategories: string[];
}

export const STORE_CATEGORIES: StoreCategoryOption[] = [
  { label: "Accessories", subcategories: ["Hats & Caps", "Scarves & Wraps", "Belts", "Sunglasses & Eyewear", "Gloves & Mittens", "Hair Accessories", "Ties & Pocket Squares", "Watches (Fashion)", "Other Accessories"] },
  { label: "Art & Collectibles", subcategories: ["Paintings & Prints", "Sculpture & Statues", "Photography", "Vintage & Antiques", "Memorabilia", "Coins & Currency", "Stamps", "Trading Cards", "Other Art & Collectibles"] },
  { label: "Baby & Kids", subcategories: ["Baby Clothing", "Kids Clothing", "Baby Gear & Nursery", "Strollers & Carriers", "Feeding & Nursing", "Diapering", "Toys for Baby & Toddler", "Kids Toys & Games", "Other Baby & Kids"] },
  { label: "Bags & Purses", subcategories: ["Handbags", "Backpacks", "Crossbody & Messenger", "Wallets & Card Holders", "Totes & Shopping Bags", "Other Bags & Purses"] },
  { label: "Bath & Beauty", subcategories: ["Skin Care", "Hair Care", "Makeup & Cosmetics", "Fragrances", "Soaps & Bath", "Nail Care", "Spa & Relaxation", "Other Bath & Beauty"] },
  { label: "Books, Movies & Music", subcategories: ["Books", "Movies & TV", "Music (CDs, Vinyl, etc.)", "Video Games", "Sheet Music & Scores", "Other Books, Movies & Music"] },
  { label: "Clothing", subcategories: ["Women's Clothing", "Men's Clothing", "Kids' Clothing", "Tops & Tees", "Dresses & Skirts", "Pants & Shorts", "Jackets & Coats", "Activewear", "Sleepwear & Loungewear", "Other Clothing"] },
  { label: "Craft Supplies & Tools", subcategories: ["Fabric & Sewing", "Yarn & Knitting", "Scrapbooking & Paper Craft", "Painting & Drawing Supplies", "Beading & Jewelry Making", "Woodworking Supplies", "Other Craft Supplies"] },
  { label: "Electronics & Accessories", subcategories: ["Phones & Accessories", "Computers & Tablets", "TV & Video", "Audio & Headphones", "Cameras & Photo", "Gaming Consoles & Accessories", "Smart Home", "Cables & Adapters", "Other Electronics"] },
  { label: "Furniture", subcategories: ["Living Room", "Bedroom", "Dining Room", "Office Furniture", "Outdoor Furniture", "Accent & Occasional", "Rugs & Carpets", "Other Furniture"] },
  { label: "Health & Personal Care", subcategories: ["Vitamins & Supplements", "First Aid & Medical", "Oral Care", "Personal Care Appliances", "Wellness & Fitness", "Other Health & Personal Care"] },
  { label: "Home & Garden", subcategories: ["Outdoor & Gardening", "Yard & Patio", "Plants & Seeds", "Outdoor Decor", "Grilling & BBQ", "Pool & Spa", "Seasonal Decor", "Other Home & Garden"] },
  { label: "Home & Kitchen", subcategories: ["Cookware & Bakeware", "Kitchen Appliances", "Dining & Serving", "Drinkware & Bar", "Kitchen Storage", "Kitchen Decor", "Small Appliances", "Other Home & Kitchen"] },
  { label: "Jewelry & Watches", subcategories: ["Necklaces & Pendants", "Bracelets", "Earrings", "Rings", "Fine Jewelry", "Fashion Jewelry", "Watches", "Jewelry Care & Storage", "Other Jewelry & Watches"] },
  { label: "Luggage & Travel", subcategories: ["Suitcases & Luggage", "Travel Bags", "Travel Accessories", "Packing Organizers", "Other Luggage & Travel"] },
  { label: "Musical Instruments", subcategories: ["Guitars & Bass", "Keyboards & Pianos", "Drums & Percussion", "Band & Orchestra", "Pro Audio & Recording", "Accessories & Parts", "Other Musical Instruments"] },
  { label: "Office & School Supplies", subcategories: ["Office Supplies", "School Supplies", "Stationery", "Filing & Organization", "Desk Accessories", "Other Office & School"] },
  { label: "Pet Supplies", subcategories: ["Dog", "Cat", "Fish & Aquarium", "Bird", "Small Animal", "Beds & Carriers", "Toys & Treats", "Other Pet Supplies"] },
  { label: "Shoes", subcategories: ["Women's Shoes", "Men's Shoes", "Kids' Shoes", "Athletic & Sneakers", "Boots", "Sandals & Flats", "Heels & Dress", "Other Shoes"] },
  { label: "Sports & Outdoors", subcategories: ["Camping & Hiking", "Fitness & Exercise", "Cycling", "Water Sports", "Winter Sports", "Team Sports", "Hunting & Fishing", "Outdoor Gear", "Other Sports & Outdoors"] },
  { label: "Tools & Home Improvement", subcategories: ["Hand Tools", "Power Tools", "Hardware", "Electrical", "Plumbing", "Paint & Supplies", "Storage & Organization", "Safety & Security", "Other Tools & Home Improvement"] },
  { label: "Toys & Games", subcategories: ["Action Figures & Collectibles", "Building & Construction", "Board Games & Puzzles", "Dolls & Stuffed Animals", "Educational Toys", "Outdoor Play", "Video Games (physical)", "Other Toys & Games"] },
  { label: "Vehicles & Parts", subcategories: ["Car & Truck Parts", "Motorcycle & ATV", "Wheels, Tires & Rims", "Interior & Exterior", "Tools & Equipment", "Other Vehicles & Parts"] },
  { label: "Wedding", subcategories: ["Bridal & Gowns", "Bridesmaid & Party", "Groom & Menswear", "Invitations & Paper", "Favors & Gifts", "Decor & Centerpieces", "Cake & Catering Supplies", "Other Wedding"] },
];

/** All top-level category labels. */
export const STORE_CATEGORY_LABELS = STORE_CATEGORIES.map((c) => c.label);

/** Get subcategories for a category label, or empty array. */
export function getSubcategoriesForCategory(categoryLabel: string): string[] {
  const cat = STORE_CATEGORIES.find((c) => c.label === categoryLabel);
  return cat ? cat.subcategories : [];
}

/** Filter category labels by search (case-insensitive). */
export function filterStoreCategories(search: string): StoreCategoryOption[] {
  const q = search.trim().toLowerCase();
  if (!q) return STORE_CATEGORIES;
  return STORE_CATEGORIES.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.subcategories.some((s) => s.toLowerCase().includes(q))
  );
}
