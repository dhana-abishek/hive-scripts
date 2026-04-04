// Zone A: named merchants that appear directly in flow data
export const zoneANamedMerchants = [
  "Horl", "ela mo", "MagicHolz", "Hydraid", "Beyond Drinks",
  "Dr. Emi", "Shyne", "Dr. Massing",
  "Yummyeats -Smarter Choices GmbH", "HAFERLÖWE",
  "Matchday Nutrition", "Inkster", "Lotuscrafts GmbH",
];

// Zone A grouped merchants
export const zoneAGroups: Record<string, string[]> = {
  "Multi Small": [
    "Waschies", "LediBelle (Appenzeller)", "Natüür (Azadivine GmbH)",
    "AMA Studios GmbH", "SPL Premium Nutrition", "ORS Hydration",
    "Rawstar LTD", "SGIN Cosmetics", "Studio Pranique", "Vedix",
    "Neurobites", "Remus Nation", "obics", "HomageSpot",
    "Athletes Eyewear", "Coaching Cards", "Creator Journal", "Kekz",
    "Vaud", "THYSOL Group BV", "Hello Inside", "Mikito", "nouxx",
    "Hedoine", "Ankerherz Verlag GmbH", "This Place", "Living Root",
    "DUEROS", "Buttz", "CASALEO", "FEATHERSHADE", "Better Performance",
    "Good Day Sunshine", "Swifiss", "CureTape", "Boodies GmbH",
    "Sternzeichen Arzt", "Goldies Worldwide GmbH", "Anita Hass",
    "Ladneri GmbH", "MiniVet", "Onors", "MyBodyAdvice", "ORGNZ",
    "Revitalash", "Spark Up", "sun matters",
  ],
  "Multi Big": [
    "Kernpunkt Connect UG", "Koona UG", "terra peak", "Venna",
    "WarMag", "YY VERTICAL SAS", "Samthus", "Nürburger Hund & Wild",
    "Harvest Republic GmbH", "maxsquare GmbH", "Djuce", "Turtle",
    "Williamify", "Gymbud", "KatKare",
  ],
  "SIOP": [
    "Babycar", "Baroni Home DE", "QuickplaySports DE", "Sawyerbikes", "Trunki",
  ],
};

// Zone B: named merchants that appear directly in flow data
export const zoneBNamedMerchants = [
  "AVA & MAY", "thebettercat",
];

// Zone B grouped merchants
export const zoneBGroups: Record<string, string[]> = {
  "Multi": [
    "biogrine", "Aleck", "Bluedenta", "X6 Innovations SAS", "Crack List",
    "Caye", "EH", "FC Viktoria Berlin", "DockATot", "Court 7 GmbH",
    "Beba Toys GmbH", "Meina Naturkosmetik", "Biotulin", "calm-don",
    "Ayawa", "Artem Oral Care GmbH", "Adonis Foods", "Fantastic Frames",
    "Authentic Ayurveda", "blueocean ind.", "Flavona", "Formgut",
    "Fraisie", "Gaudy-Foods (Milano Vice)", "GROW WITH ANNA", "Hairoine",
    "Hashtag You", "Herborea", "ICLC Academy", "Ingarden", "Klarheit",
    "L Complex", "LIFETIME", "Matcha Plus", "Medical Inn", "Montaray",
    "MyClarella", "NYTE", "Nordmut", "Nutrientify", "objective nutrition",
    "Perform+", "Plantsalt", "ProDGtal", "PURMEO", "RCFIMPEX", "reeleef",
    "SanaExpert", "Savana", "SOYMOMO", "spomedis GmbH", "sweet spot",
    "Yamnaya", "WWF", "Ventra", "Triggerdinger", "KIBGame", "TrueGum",
    "DIE RINGE", "Gymondo-onlineshop", "CYCLITE", "Mooniq",
    "wonderhealth.de", "matcharepublic", "Zola Nutrition", "Vanillekiste",
    "Vertellis", "Lybbie", "OYL Foods", "ROAM", "Charles",
    "Calisi Beauty", "Fruehlingszwiebel", "Pomelo", "Power Sprotte",
    "hörtm", "Hatwebtrade", "Health Bar", "Soulhouse", "Phiala",
    "halm-club", "Patronus", "BORA",
  ],
  "Multi Sizzlepak": [
    "Viva Maia", "Skinny Dip", "SwissVitalWorld", "Into Life",
    "Shavent", "Facial Room Skincare GmbH", "Rosental Organics", "Glücks Krone",
  ],
  "Multi Critical": [
    "Supplenatura Rheinland", "DayOne", "Nordlust", "Glucose Goddess",
    "WP Energy Sniff", "Ancora Pacific GmbH", "Health and You",
    "Embelly", "Hunter & Gather Foods", "Natch", "Purish Marketplaces",
  ],
};

// Build a lookup: merchant_name -> { zone, group? }
export interface ZoneAssignment {
  zone: "A" | "B";
  group?: string; // if part of a group, name of group
}

export function buildZoneLookup(): Record<string, ZoneAssignment> {
  const lookup: Record<string, ZoneAssignment> = {};

  for (const m of zoneANamedMerchants) {
    lookup[m] = { zone: "A" };
  }
  for (const [group, merchants] of Object.entries(zoneAGroups)) {
    for (const m of merchants) {
      lookup[m] = { zone: "A", group };
    }
  }
  for (const m of zoneBNamedMerchants) {
    lookup[m] = { zone: "B" };
  }
  for (const [group, merchants] of Object.entries(zoneBGroups)) {
    for (const m of merchants) {
      lookup[m] = { zone: "B", group };
    }
  }

  return lookup;
}
