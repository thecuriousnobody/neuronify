// The discrete citizen-report taxonomy — the engine's source of truth for
// "what kind of report is this?" and "which department owns it?".
//
// Sourced from real 311 systems (see docs/intake-taxonomy-proposal.md). Peoria
// (Peoria Cares / uReport) is the working TEMPLATE; a new municipality is added
// by copying the Peoria department map and adjusting owners — not by touching
// code. Evanston, Chicago 311, and the Open311 spec informed the category list
// but are deliberately NOT wired here.
//
// Pure data + pure functions — no I/O, no env, no model. The model only ever
// PROPOSES a category; `resolveCategory` constrains it and `departmentFor`
// derives routing deterministically. (see ../README.md — the boundary rule)

// ────────────────────────────────────────────────────────────────────────────
// Categories — the discrete vocabulary. `other_inquiry` is the catch-all every
// 311 system keeps, and the fail-safe when nothing else fits.
// ────────────────────────────────────────────────────────────────────────────

export type CategoryKey =
  | 'pothole'
  | 'street_light'
  | 'sidewalk_damage'
  | 'traffic_sign_signal'
  | 'snow_ice'
  | 'missed_collection'
  | 'cart_issue'
  | 'illegal_dumping'
  | 'tree_issue'
  | 'graffiti'
  | 'abandoned_vehicle'
  | 'tall_grass_weeds'
  | 'property_maintenance'
  | 'vacant_abandoned_property'
  | 'rodent_pest'
  | 'dead_animal'
  | 'animal_concern'
  | 'water_sewer'
  | 'flooding_drainage'
  | 'noise_complaint'
  | 'park_maintenance'
  | 'other_inquiry';

export interface CategoryDef {
  key: CategoryKey;
  /** Plain-language name shown to residents and staff. */
  label: string;
}

/** The canonical core (~22). Order is display order. */
export const CATEGORIES: CategoryDef[] = [
  { key: 'pothole', label: 'Pothole / road surface' },
  { key: 'street_light', label: 'Street light out or damaged' },
  { key: 'sidewalk_damage', label: 'Sidewalk damage / trip hazard' },
  { key: 'traffic_sign_signal', label: 'Traffic signal or sign problem' },
  { key: 'snow_ice', label: 'Snow / ice removal' },
  { key: 'missed_collection', label: 'Missed garbage, recycling, or yard-waste pickup' },
  { key: 'cart_issue', label: 'Cart or bin — damaged, missing, or new' },
  { key: 'illegal_dumping', label: 'Illegal dumping / litter' },
  { key: 'tree_issue', label: 'Tree down, limb, dead, or needs trimming' },
  { key: 'graffiti', label: 'Graffiti' },
  { key: 'abandoned_vehicle', label: 'Abandoned or inoperable vehicle' },
  { key: 'tall_grass_weeds', label: 'Tall grass / weeds / overgrowth' },
  { key: 'property_maintenance', label: 'Exterior property condition' },
  { key: 'vacant_abandoned_property', label: 'Vacant or unsecured building or lot' },
  { key: 'rodent_pest', label: 'Rodents, rats, or insects' },
  { key: 'dead_animal', label: 'Dead animal pickup' },
  { key: 'animal_concern', label: 'Stray, injured, or dangerous animal' },
  { key: 'water_sewer', label: 'Water main, no water, or sewer problem' },
  { key: 'flooding_drainage', label: 'Street flooding / catch basin' },
  { key: 'noise_complaint', label: 'Noise / amplified sound' },
  { key: 'park_maintenance', label: 'Park equipment, restroom, or fountain' },
  { key: 'other_inquiry', label: 'Something else / general question' },
];

/** The catch-all category; also the fail-safe classification. */
export const FALLBACK_CATEGORY: CategoryKey = 'other_inquiry';

const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((c) => c.key));

// ────────────────────────────────────────────────────────────────────────────
// Departments — the canonical owner vocabulary for the Peoria template.
// ────────────────────────────────────────────────────────────────────────────

export type DepartmentKey =
  | 'public_works'
  | 'code_enforcement'
  | 'police'
  | 'parks_rec'
  // NOT a city desk — Peoria's drinking water is Illinois American Water
  // (private). `water_sewer` reports are referred OUT, not routed to a desk.
  | 'water_external'
  // General queue / catch-all — the "Ask a Question" fallback.
  | 'clerk';

// ────────────────────────────────────────────────────────────────────────────
// category → owning department, per city. Peoria is the TEMPLATE map; unknown
// cities fall back to it. Where a real 311 splits ownership (e.g. "Code Enf. /
// Police"), the comment records the split and the map picks the most common
// owner — reassignment (already built) handles the exceptions. This is DATA:
// tuning an owner is a one-line edit, never a code change.
// ────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_CITY = 'peoria';

export const CITY_DEPARTMENTS: Record<string, Record<CategoryKey, DepartmentKey>> = {
  peoria: {
    pothole: 'public_works',
    street_light: 'public_works',
    sidewalk_damage: 'public_works',
    traffic_sign_signal: 'public_works',
    snow_ice: 'public_works',
    missed_collection: 'public_works', // collection is contracted (GFL), routed via PW
    cart_issue: 'public_works',
    illegal_dumping: 'code_enforcement', // Environmental
    tree_issue: 'public_works', // forestry/removal; CE clears downed-limb debris
    graffiti: 'police', // Peoria groups graffiti under "Crime/Graffiti"
    abandoned_vehicle: 'police', // on-street; CE owns inoperable vehicles on private property
    tall_grass_weeds: 'code_enforcement', // Environmental (acts on grass over ~10 in.)
    property_maintenance: 'code_enforcement', // Housing
    vacant_abandoned_property: 'code_enforcement',
    rodent_pest: 'code_enforcement', // Peoria rat abatement (Evanston routes this to Health)
    dead_animal: 'public_works', // PW pickup; Police for animal-on-street reports
    animal_concern: 'police', // Police / Animal Control
    water_sewer: 'water_external', // Illinois American Water (private) — refer out
    flooding_drainage: 'public_works', // Operations / Engineering stormwater
    noise_complaint: 'police',
    park_maintenance: 'parks_rec',
    other_inquiry: 'clerk',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers.
// ────────────────────────────────────────────────────────────────────────────

/** "Peoria, IL" → "peoria". Unknown/empty → the template city. */
export function normalizeCity(city: string): string {
  const head = (city || '').split(',')[0].trim().toLowerCase();
  return head || TEMPLATE_CITY;
}

/**
 * Constrain a model-proposed category to a canonical key. Matches the key
 * verbatim (what the classify prompt asks for) or an exact plain-language
 * label; anything unrecognized fails safe to the catch-all. Prompts are
 * suggestions — this is the enforcement.
 */
export function resolveCategory(raw: string): CategoryKey {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return FALLBACK_CATEGORY;
  if (CATEGORY_KEYS.has(s)) return s as CategoryKey;
  const byLabel = CATEGORIES.find((c) => c.label.toLowerCase() === s);
  return byLabel ? byLabel.key : FALLBACK_CATEGORY;
}

/**
 * The department that owns a category in a city — the canonical owner. Unknown
 * cities fall back to the Peoria template. Reconciling this owner to a desk that
 * is actually staffed (DESK_PASSCODES) is the caller's concern, not the map's.
 */
export function departmentFor(city: string, category: CategoryKey): DepartmentKey {
  const map = CITY_DEPARTMENTS[normalizeCity(city)] ?? CITY_DEPARTMENTS[TEMPLATE_CITY];
  return map[category];
}

/**
 * The workflow a department's reports run. Flows are keyed by DEPARTMENT, not
 * category — see ./flows. It lives here rather than in ./flows so that ./forms
 * can name its workflowKey without importing ./flows (which imports ./forms).
 */
export function departmentFlowKey(department: DepartmentKey): string {
  return `${department}_flow`;
}
