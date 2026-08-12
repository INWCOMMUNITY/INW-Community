/**
 * Prebuilt store categories and subcategories for storefront listings.
 * Users can search/filter and select, or add a custom category.
 */

export interface StoreCategoryOption {
  label: string;
  subcategories: string[];
}

export const STORE_CATEGORIES: StoreCategoryOption[] = [
  {
    label: "Accessories",
    subcategories: [
      "Hats & Caps", "Scarves & Wraps", "Belts", "Sunglasses & Eyewear", "Gloves & Mittens",
      "Hair Accessories", "Ties & Pocket Squares", "Keychains & Lanyards", "Pins & Badges",
      "Watches (Fashion)", "Costume Accessories", "Fascinators", "Patches", "Umbrellas",
      "Face Masks", "Boutonnieres", "Corsages", "Other Accessories"
    ]
  },
  {
    label: "Art & Collectibles",
    subcategories: [
      "Paintings & Prints", "Drawing & Illustration", "Sculpture & Statues", "Photography",
      "Fiber Arts", "Glass Art", "Digital Prints", "Vintage & Antiques", "Memorabilia",
      "Dolls & Miniatures", "Coins & Currency", "Stamps", "Trading Cards", "Animation Art",
      "Folk Art", "Mixed Media & Collage", "Posters", "Maps & Atlases", "Maritime & Nautical",
      "Scientific Antiques", "Silver & Silverplate", "Advertising Collectibles", "Breweriana",
      "Casino Collectibles", "Disney Collectibles", "Fantasy Collectibles", "Historical Memorabilia",
      "Military Collectibles", "Sports Memorabilia", "Vintage Electronics", "Rocks & Minerals",
      "Sci-Fi & Horror", "Tobacciana", "Promotional Collectibles", "Decorative Collectibles",
      "Cultural Collectibles", "Bottles & Insulators", "Arcade & Gaming", "Knives & Swords",
      "Transportation Collectibles", "Postcards", "Linens & Textiles", "Other Art & Collectibles"
    ]
  },
  {
    label: "Baby & Kids",
    subcategories: [
      "Baby Clothing", "Kids Clothing", "Baby Gear & Nursery", "Strollers & Carriers",
      "Feeding & Nursing", "Diapering", "Toys for Baby & Toddler", "Kids Toys & Games",
      "Baby Safety", "Baby Feeding", "Baby Bath & Grooming", "Car Seats", "Nursery Bedding",
      "Nursery Decor", "Nursery Furniture", "Other Baby & Kids"
    ]
  },
  {
    label: "Bags & Purses",
    subcategories: [
      "Handbags", "Backpacks", "Crossbody & Messenger", "Wallets & Card Holders",
      "Totes & Shopping Bags", "Cosmetic Bags", "Clutches & Evening Bags", "Messenger Bags",
      "Luggage & Travel", "Other Bags & Purses"
    ]
  },
  {
    label: "Bath & Beauty",
    subcategories: [
      "Skin Care", "Hair Care", "Makeup & Cosmetics", "Fragrances", "Soaps & Bath",
      "Nail Care", "Spa & Relaxation", "Bath Accessories", "Bath Bombs", "Body Oils",
      "Essential Oils", "Lip Care", "Body Lotion", "Personal Care", "Salves & Balms",
      "Scrubs & Exfoliators", "Shaving & Grooming", "Spa & Gift Sets", "Sun Care",
      "Vintage Beauty", "Other Bath & Beauty"
    ]
  },
  /** Aligns with eBay Business & Industrial top-level. */
  {
    label: "Business & Industrial",
    subcategories: [
      "Office Equipment", "Industrial Supplies", "Healthcare & Lab", "Material Handling",
      "Safety Equipment", "Restaurant & Food Service", "Heavy Equipment", "Other Business & Industrial"
    ]
  },
  {
    label: "Books, Movies & Music",
    subcategories: [
      "Books", "Comics & Graphic Novels", "Movies & TV", "Music (CDs, Vinyl, etc.)",
      "Video Games", "Sheet Music & Scores", "Magazines & Periodicals", "Audiobooks",
      "Zines", "Other Books, Movies & Music"
    ]
  },
  {
    label: "Clothing",
    subcategories: [
      "Women's Clothing", "Men's Clothing", "Kids' Clothing", "Tops & Tees", "Dresses & Skirts",
      "Pants & Shorts", "Jackets & Coats", "Activewear", "Sleepwear & Loungewear",
      "Intimates & Sleepwear", "Maternity", "Vintage", "Uniforms & Work Clothing", "Costumes",
      "Dancewear", "Cultural & Traditional", "Jeans", "Shorts", "Sweaters", "Swimwear",
      "Suits & Blazers", "Unisex", "Hoodies & Sweatshirts", "Other Clothing"
    ]
  },
  {
    label: "Craft Supplies & Tools",
    subcategories: [
      "Fabric & Sewing", "Yarn & Knitting", "Scrapbooking & Paper Craft", "Painting & Drawing Supplies",
      "Beading & Jewelry Making", "Woodworking Supplies", "Clay & Molding", "Embroidery & Cross Stitch",
      "Quilting", "Felting", "Stamping & Embossing", "Leather Craft", "Ceramics & Pottery",
      "Mosaics", "Candle & Soap Making", "Vintage Sewing", "Glass Art", "Floral Supplies",
      "Canvas", "Doll Making", "Drawing Supplies", "Embellishments", "Frames & Hoops",
      "Adhesives", "Knitting", "Crochet", "Molds", "Resin", "Paints", "Stamps", "Raw Materials",
      "Sculpting", "Tools", "Weaving", "Spinning", "Wood", "Other Craft Supplies"
    ]
  },
  {
    label: "Electronics & Accessories",
    subcategories: [
      "Phones & Accessories", "Computers & Tablets", "TV & Video", "Audio & Headphones",
      "Cameras & Photo", "Gaming Consoles & Accessories", "Smart Home", "Cables & Adapters",
      "Wearables", "Drones & RC", "Security & Surveillance", "VR & AR", "Batteries & Chargers",
      "Cables & Connectors", "Printers & Scanners", "Phone Cases", "Headphones", "Speakers",
      "Car Electronics", "Computer Accessories", "Gaming", "Tablet Cases", "Laptop Cases",
      "Chargers", "Camera Accessories", "Other Electronics"
    ]
  },
  {
    label: "Furniture",
    subcategories: [
      "Living Room", "Bedroom", "Dining Room", "Office Furniture", "Outdoor Furniture",
      "Accent & Occasional", "Rugs & Carpets", "Vintage & Antique", "Other Furniture"
    ]
  },
  {
    label: "Health & Personal Care",
    subcategories: [
      "Vitamins & Supplements", "First Aid & Medical", "Oral Care", "Personal Care Appliances",
      "Wellness & Fitness", "Vision Care", "Medical & Mobility", "Other Health & Personal Care"
    ]
  },
  /** Aligns with Etsy's Home & Living top-level (decor, bedding, lighting, storage). */
  {
    label: "Home & Living",
    subcategories: [
      "Home Decor", "Wall Decor", "Bedding", "Bathroom", "Lighting", "Home Storage",
      "Cleaning & Laundry", "Spiritual & Religious", "Food & Drink (home)", "Candles & Holders",
      "Clocks", "Curtains & Window Treatments", "Pillows", "Blankets & Throws", "Mirrors",
      "Frames & Displays", "Vases", "Linens & Textiles", "Home Fragrances", "Cleaning Supplies",
      "Spirituality & Religion", "Other Home & Living"
    ]
  },
  {
    label: "Home & Garden",
    subcategories: [
      "Outdoor & Gardening", "Yard & Patio", "Plants & Seeds", "Outdoor Decor",
      "Grilling & BBQ", "Pool & Spa", "Seasonal Decor", "Other Home & Garden"
    ]
  },
  {
    label: "Home & Kitchen",
    subcategories: [
      "Cookware & Bakeware", "Kitchen Appliances", "Dining & Serving", "Drinkware & Bar",
      "Kitchen Storage", "Kitchen Decor", "Small Appliances", "Coffee & Tea", "Dinnerware",
      "Flatware", "Drinkware", "Kitchen Tools", "Food Storage", "Bar & Barware",
      "Table Linens", "Food & Drink", "Other Home & Kitchen"
    ]
  },
  {
    label: "Jewelry & Watches",
    subcategories: [
      "Necklaces & Pendants", "Bracelets", "Earrings", "Rings", "Fine Jewelry",
      "Fashion Jewelry", "Body Jewelry", "Watches", "Jewelry Care & Storage", "Anklets",
      "Brooches", "Charms", "Cufflinks", "Engagement & Wedding", "Ethnic Jewelry",
      "Hair Jewelry", "Jewelry Boxes", "Loose Gemstones", "Men's Jewelry", "Vintage Jewelry",
      "Watch Accessories", "Tie Accessories", "Jewelry Sets", "Memorial Jewelry",
      "Other Jewelry & Watches"
    ]
  },
  {
    label: "Luggage & Travel",
    subcategories: [
      "Suitcases & Luggage", "Travel Bags", "Travel Accessories", "Packing Organizers",
      "Other Luggage & Travel"
    ]
  },
  {
    label: "Musical Instruments",
    subcategories: [
      "Guitars & Bass", "Keyboards & Pianos", "Drums & Percussion", "Band & Orchestra",
      "Pro Audio & Recording", "Accessories & Parts", "Other Musical Instruments"
    ]
  },
  {
    label: "Office & School Supplies",
    subcategories: [
      "Office Supplies", "School Supplies", "Stationery", "Filing & Organization",
      "Desk Accessories", "Pens & Writing", "Other Office & School"
    ]
  },
  /** Aligns with Etsy's Paper & Party Supplies top-level. */
  {
    label: "Paper & Party Supplies",
    subcategories: [
      "Greeting Cards", "Invitations", "Gift Wrap & Packaging", "Party Decorations",
      "Party Favors", "Stickers & Labels", "Calendars & Planners", "Holiday Decorations",
      "Journals & Notebooks", "Other Paper & Party"
    ]
  },
  {
    label: "Pet Supplies",
    subcategories: [
      "Dog", "Cat", "Fish & Aquarium", "Bird", "Small Animal", "Beds & Carriers",
      "Toys & Treats", "Collars & Leashes", "Reptile", "Pet Carriers", "Pet Feeding",
      "Pet Grooming", "Pet ID Tags", "Other Pet Supplies"
    ]
  },
  {
    label: "Shoes",
    subcategories: [
      "Women's Shoes", "Men's Shoes", "Kids' Shoes", "Athletic & Sneakers", "Boots",
      "Sandals & Flats", "Heels & Dress", "Flats", "Heels", "Loafers & Slip-Ons",
      "Oxfords", "Slippers", "Athletic Shoes", "Other Shoes"
    ]
  },
  {
    label: "Sports & Outdoors",
    subcategories: [
      "Camping & Hiking", "Fitness & Exercise", "Cycling", "Water Sports", "Winter Sports",
      "Team Sports", "Hunting & Fishing", "Outdoor Gear", "Golf", "Racquet Sports",
      "Combat Sports", "Action Sports", "Equestrian", "Other Sports & Outdoors"
    ]
  },
  /** Aligns with eBay Tickets & Experiences top-level. */
  {
    label: "Tickets & Experiences",
    subcategories: [
      "Event Tickets", "Gift Experiences", "Travel Vouchers", "Other Tickets & Experiences"
    ]
  },
  {
    label: "Tools & Home Improvement",
    subcategories: [
      "Hand Tools", "Power Tools", "Hardware", "Electrical", "Plumbing", "Paint & Supplies",
      "Storage & Organization", "Safety & Security", "Automotive Tools", "Other Tools & Home Improvement"
    ]
  },
  {
    label: "Toys & Games",
    subcategories: [
      "Action Figures & Collectibles", "Building & Construction", "Board Games & Puzzles",
      "Dolls & Stuffed Animals", "Educational Toys", "Outdoor Play", "Video Games (physical)",
      "Diecast & Toy Vehicles", "Model Trains", "RC & Drones", "Preschool Toys", "Pretend Play",
      "Puppets", "Musical Toys", "Ride-Ons", "Other Toys & Games"
    ]
  },
  {
    label: "Vehicles & Parts",
    subcategories: [
      "Car & Truck Parts", "Motorcycle & ATV", "Wheels, Tires & Rims", "Interior & Exterior",
      "Tools & Equipment", "Other Vehicles & Parts"
    ]
  },
  {
    label: "Wedding",
    subcategories: [
      "Bridal & Gowns", "Bridesmaid & Party", "Groom & Menswear", "Invitations & Paper",
      "Favors & Gifts", "Decor & Centerpieces", "Accessories", "Cake & Catering Supplies",
      "Bridal Gowns & Separates", "Invitations & Stationery", "Bridesmaids", "Groomsmen",
      "Guest Books", "Ring Pillows & Boxes", "Veils", "Ceremony Supplies", "Reception",
      "Groom Accessories", "Flowers & Bouquets", "Cake Toppers", "Other Wedding"
    ]
  },
];

/** All top-level category labels. */
export const STORE_CATEGORY_LABELS = STORE_CATEGORIES.map((c) => c.label);

/** Get subcategories for a category label, or empty array. */
export function getSubcategoriesForCategory(categoryLabel: string): string[] {
  const cat = STORE_CATEGORIES.find((c) => c.label === categoryLabel);
  return cat ? cat.subcategories : [];
}

/**
 * Canonical slug for storefront category URLs.
 * "Jewelry & Watches" → "jewelry-watches"
 */
export function slugifyStoreCategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
