/**
 * Resident search phrases → canonical primary labels (must match BUSINESS_CATEGORIES labels).
 * Used by directory + seller search expansion. Keep tests in business-directory-search.test.ts.
 */
export type SynonymPrimaryRule = { test: (lower: string) => boolean; primaries: string[] };

export const DIRECTORY_SEARCH_SYNONYM_PRIMARIES: SynonymPrimaryRule[] = [
  // HVAC & climate (detail rules also in business-directory-search.ts trade-name OR)
  {
    test: (l) =>
      /\b(hvac|a\/c|a\.c\.)\b/.test(l) ||
      l.includes("air conditioning") ||
      l.includes("air conditioner") ||
      l.includes("heat pump") ||
      l.includes("heating and cooling") ||
      l.includes("central air") ||
      (l.includes("furnace") && (l.includes("repair") || l.includes("install") || l.includes("service"))),
    primaries: ["HVAC"],
  },
  // Food & drink
  {
    test: (l) =>
      /\b(pub|tavern|taproom|nightclub|sports bar|wine bar|cocktail lounge)\b/.test(l) ||
      (l.includes("bar") && (l.includes("drinks") || l.includes("beer") || l.includes("wine"))),
    primaries: ["Bar"],
  },
  {
    test: (l) =>
      l.includes("coffee") ||
      l.includes("espresso") ||
      l.includes("café") ||
      l.includes("cafe") ||
      l.includes("coffeehouse") ||
      l.includes("coffee shop"),
    primaries: ["Coffee Shop"],
  },
  {
    test: (l) =>
      /\b(restaurant|eatery|bistro|diner|brunch|catering)\b/.test(l) ||
      l.includes("food truck") ||
      l.includes("fine dining") ||
      (l.includes("pizza") && !l.includes("parts")) ||
      (l.includes("deli") && (l.includes("sandwich") || l.includes("lunch") || l.includes("food"))),
    primaries: ["Restaurant"],
  },
  {
    test: (l) =>
      l.includes("bakery") ||
      l.includes("cupcake") ||
      l.includes("pastries") ||
      l.includes("custom cakes") ||
      l.includes("donuts"),
    primaries: ["Bakery"],
  },
  {
    test: (l) =>
      l.includes("grocery") ||
      l.includes("butcher") ||
      l.includes("seafood market") ||
      l.includes("farmers market") ||
      l.includes("co-op grocery") ||
      /\bcoop\b/.test(l),
    primaries: ["Grocery and Markets"],
  },
  // Auto cluster
  {
    test: (l) =>
      /\b(mechanic|auto repair|car repair|oil change|transmission shop|brake shop)\b/.test(l) ||
      (l.includes("auto") && l.includes("repair") && !l.includes("body")),
    primaries: ["Mechanic"],
  },
  {
    test: (l) =>
      l.includes("body shop") ||
      l.includes("collision") ||
      l.includes("auto body") ||
      (l.includes("detailing") && l.includes("shop")),
    primaries: ["Automotive"],
  },
  {
    test: (l) =>
      /\b(car dealership|auto dealer|used cars|new cars|pre-owned)\b/.test(l) ||
      (l.includes("dealer") && l.includes("vehicle")),
    primaries: ["Car Dealership"],
  },
  {
    test: (l) =>
      l.includes("tire shop") ||
      l.includes("auto parts") ||
      l.includes("parts store") ||
      (l.includes("tires") && !l.includes("hair")),
    primaries: ["Auto Parts and Tires"],
  },
  {
    test: (l) => l.includes("car wash") || (l.includes("detailing") && l.includes("car")),
    primaries: ["Car Wash and Detailing"],
  },
  // Trades
  {
    test: (l) =>
      l.includes("handyman") ||
      l.includes("odd jobs") ||
      l.includes("small repairs") ||
      l.includes("honey-do"),
    primaries: ["Handyman"],
  },
  {
    test: (l) => /\b(plumb|drain|sewer|rooter|water heater)\b/.test(l) || l.includes("plumber"),
    primaries: ["Plumber"],
  },
  {
    test: (l) =>
      /\b(electrician|electrical contractor)\b/.test(l) ||
      (l.includes("electric") &&
        (l.includes("wiring") ||
          l.includes("outlet") ||
          l.includes("panel") ||
          l.includes("lighting") ||
          l.includes("ev charger") ||
          l.includes("ev charging"))),
    primaries: ["Electrician"],
  },
  {
    test: (l) => l.includes("drywall") || l.includes("sheetrock") || l.includes("tape and bed"),
    primaries: ["Drywaller"],
  },
  {
    test: (l) =>
      l.includes("concrete") ||
      l.includes("driveway") ||
      l.includes("stamped concrete") ||
      l.includes("flatwork"),
    primaries: ["Concrete"],
  },
  {
    test: (l) =>
      /\b(general contractor|\bgc\b|remodel|renovation|home improvement)\b/.test(l) ||
      (l.includes("contractor") && !l.includes("electrical") && !l.includes("roofing")),
    primaries: ["General Contractor"],
  },
  {
    test: (l) =>
      /\b(roofer|roofing|roof leak|shingle)\b/.test(l) || (l.includes("roof") && (l.includes("repair") || l.includes("replace"))),
    primaries: ["Roofing"],
  },
  {
    test: (l) =>
      l.includes("landscap") ||
      l.includes("lawn care") ||
      l.includes("lawn mowing") ||
      l.includes("tree service") ||
      l.includes("irrigation") ||
      l.includes("sprinkler") ||
      l.includes("snow removal"),
    primaries: ["Landscaping and Lawn"],
  },
  {
    test: (l) =>
      l.includes("house painter") ||
      l.includes("interior paint") ||
      l.includes("exterior paint") ||
      (l.includes("painter") && !l.includes("photographer")),
    primaries: ["Painter"],
  },
  {
    test: (l) =>
      l.includes("flooring") ||
      l.includes("hardwood floor") ||
      l.includes("carpet install") ||
      l.includes("tile install"),
    primaries: ["Flooring"],
  },
  {
    test: (l) =>
      l.includes("window replacement") ||
      l.includes("new windows") ||
      (l.includes("doors") && l.includes("install")) ||
      l.includes("glass repair"),
    primaries: ["Windows and Doors"],
  },
  {
    test: (l) =>
      /\b(exterminator|pest control|termite|bed bug)\b/.test(l) || (l.includes("pest") && l.includes("control")),
    primaries: ["Pest Control"],
  },
  {
    test: (l) =>
      l.includes("house cleaning") ||
      l.includes("maid service") ||
      l.includes("janitorial") ||
      l.includes("carpet cleaning") ||
      l.includes("deep clean"),
    primaries: ["Cleaning Services"],
  },
  {
    test: (l) =>
      /\b(movers|moving company|moving service)\b/.test(l) ||
      l.includes("storage unit") ||
      l.includes("self storage"),
    primaries: ["Moving and Storage"],
  },
  // Personal & creative
  {
    test: (l) =>
      l.includes("photographer") ||
      l.includes("photography") ||
      l.includes("headshots") ||
      l.includes("wedding photos") ||
      l.includes("senior photos"),
    primaries: ["Photographer"],
  },
  {
    test: (l) =>
      l.includes("haircut") ||
      l.includes("barber") ||
      l.includes("hair salon") ||
      l.includes("nail salon") ||
      l.includes("manicure") ||
      l.includes("barbershop"),
    primaries: ["Salon and Barbershop"],
  },
  {
    test: (l) => /\b(tattoo|tattoos|piercing studio|body art)\b/.test(l),
    primaries: ["Tattoo and Piercing Studio"],
  },
  {
    test: (l) =>
      l.includes("day spa") ||
      l.includes("massage therapy") ||
      (l.includes("massage") && !l.includes("chair massage kiosk")) ||
      l.includes("med spa"),
    primaries: ["Spa and Massage"],
  },
  {
    test: (l) =>
      /\b(gym|fitness center|crossfit|yoga studio|pilates|personal trainer)\b/.test(l) ||
      (l.includes("workout") && l.includes("class")),
    primaries: ["Fitness and Gym"],
  },
  // Health & wellness
  {
    test: (l) =>
      l.includes("dentist") ||
      l.includes("dental") ||
      l.includes("orthodont") ||
      l.includes("chiropractor") ||
      l.includes("chiro") ||
      l.includes("optometrist") ||
      l.includes("eye doctor") ||
      l.includes("physical therapy") ||
      l.includes("occupational therapy") ||
      (l.includes("medical") && l.includes("clinic")),
    primaries: ["Health and Dental"],
  },
  {
    test: (l) =>
      /\b(therapist|counselor|counseling|psychologist|lmft|mental health)\b/.test(l) ||
      l.includes("psychotherapy"),
    primaries: ["Therapists and Mental Health"],
  },
  {
    test: (l) =>
      l.includes("life coach") ||
      l.includes("business coach") ||
      l.includes("executive coach") ||
      (l.includes("consulting") && l.includes("business")),
    primaries: ["Coaching and Consulting"],
  },
  {
    test: (l) => l.includes("pharmacy") || l.includes("drugstore") || l.includes("prescription"),
    primaries: ["Pharmacy"],
  },
  // Family & hospitality
  {
    test: (l) =>
      /\b(vet|veterinary|dog grooming|pet grooming|dog boarding|kennel|pet daycare)\b/.test(l) ||
      (l.includes("pet") && l.includes("training")),
    primaries: ["Pet Services"],
  },
  {
    test: (l) =>
      l.includes("daycare") ||
      l.includes("childcare") ||
      l.includes("preschool") ||
      l.includes("tutoring") ||
      l.includes("tutor") ||
      l.includes("martial arts school"),
    primaries: ["Childcare and Education"],
  },
  {
    test: (l) =>
      /\b(hotel|motel|inn|b&b|bed and breakfast|campground)\b/.test(l) ||
      l.includes("lodging"),
    primaries: ["Hotel and Lodging"],
  },
  // Professional services
  {
    test: (l) =>
      l.includes("cpa") ||
      l.includes("bookkeeping") ||
      l.includes("tax prep") ||
      l.includes("accountant") ||
      l.includes("payroll service"),
    primaries: ["Accounting and Tax Services"],
  },
  {
    test: (l) =>
      /\b(lawyer|attorney|law firm|law office)\b/.test(l) ||
      (l.includes("legal") && l.includes("services")),
    primaries: ["Legal Services"],
  },
  {
    test: (l) =>
      l.includes("insurance agent") ||
      l.includes("insurance broker") ||
      (l.includes("insurance") && (l.includes("auto") || l.includes("home") || l.includes("life"))),
    primaries: ["Insurance Services"],
  },
  {
    test: (l) =>
      l.includes("financial advisor") ||
      l.includes("wealth management") ||
      l.includes("financial planning") ||
      l.includes("investment advisor"),
    primaries: ["Financial Advisors and Services"],
  },
  {
    test: (l) =>
      /\b(realtor|real estate agent|realty|property management)\b/.test(l) ||
      (l.includes("real estate") && (l.includes("sell") || l.includes("buy") || l.includes("list"))),
    primaries: ["Real Estate Agents and Services"],
  },
  {
    test: (l) =>
      l.includes("digital marketing") ||
      l.includes("seo") ||
      l.includes("advertising agency") ||
      (l.includes("marketing") && l.includes("agency")),
    primaries: ["Marketing and Advertising"],
  },
  {
    test: (l) =>
      l.includes("staffing") ||
      l.includes("recruiter") ||
      l.includes("temp agency") ||
      l.includes("headhunter"),
    primaries: ["Staffing and Recruiting"],
  },
  {
    test: (l) =>
      l.includes("shipping center") ||
      l.includes("print and copy") ||
      l.includes("copy center") ||
      (l.includes("fedex") && l.includes("store")),
    primaries: ["Office Supplies and Services"],
  },
  {
    test: (l) =>
      l.includes("thrift") ||
      l.includes("boutique") ||
      (l.includes("hobby shop") && !l.includes("tattoo")),
    primaries: ["Retail (General Merchandise)"],
  },
  {
    test: (l) => l.includes("art gallery") || l.includes("museum") || l.includes("performing arts"),
    primaries: ["Arts and Culture"],
  },
  {
    test: (l) =>
      l.includes("bowling") ||
      l.includes("arcade") ||
      (l.includes("mini golf") && !l.includes("landscap")),
    primaries: ["Entertainment and Recreation"],
  },
  {
    test: (l) => l.includes("feed store") || l.includes("farm stand") || l.includes("ranch supply"),
    primaries: ["Farm and Ranch"],
  },
  {
    test: (l) =>
      /\b(church|temple|mosque|synagogue|ministry)\b/.test(l) ||
      l.includes("place of worship"),
    primaries: ["Religious and Nonprofit Org"],
  },
  {
    test: (l) =>
      l.includes("city hall") ||
      l.includes("county office") ||
      l.includes("library") ||
      l.includes("community center"),
    primaries: ["Government and Community"],
  },
  {
    test: (l) => l.includes("funeral home") || l.includes("cremation") || l.includes("monument"),
    primaries: ["Funeral and Memorial"],
  },
  {
    test: (l) =>
      l.includes("locksmith") ||
      l.includes("security system") ||
      l.includes("alarm company") ||
      l.includes("home security"),
    primaries: ["Security and Locksmith"],
  },
  {
    test: (l) =>
      l.includes("sign shop") ||
      l.includes("screen printing") ||
      l.includes("embroidery") ||
      l.includes("vehicle wrap"),
    primaries: ["Sign and Print"],
  },
  {
    test: (l) => l.includes("dry cleaner") || l.includes("laundromat") || l.includes("laundry") || l.includes("alterations"),
    primaries: ["Laundry and Dry Cleaning"],
  },
];
