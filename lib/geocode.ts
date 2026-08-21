// Approximate-address matching for resident reports, via the free US Census
// geocoder (no key, no billing — the same service swych-box uses). Given the
// agent-extracted location ("the junction of Knoxville Avenue and Giles
// Avenue"), returns the nearest recognized address + coordinates, or null.
//
// This is deliberately a *verification* step, not autocomplete-as-you-type —
// prototype-appropriate. A city's parcel/GIS layer can replace this behind the
// same function seam later. Fail-soft: any error or non-match returns null and
// the UI simply shows the resident's own words.

export interface GeoMatch {
  /** Normalized address, e.g. "N KNOXVILLE AVE & W GILES LN, PEORIA, IL, 61614" */
  matched: string;
  lat: number;
  lon: number;
  /** True when the resident named a CORNER but this match is only
   *  street-grade — the pin sits at an arbitrary point along a whole road,
   *  shown with the same confidence as a real corner match. Observed live
   *  (2026-08-19): "Knoxville and Wall, near War Memorial" pinned the middle
   *  of W War Memorial Dr. The UI owes the resident that honesty. */
  approximate?: boolean;
}

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** Strip spoken filler so the geocoder sees a plain address/intersection.
 *  Careful with directions: "north side" is filler, but "North University
 *  Street" is a real street — only compound descriptors are dropped.
 *  (Observed live: "…, north side median" partial-matched to "North St,
 *  Rome, IL", 15 miles out of town.) */
export function normalizeLocation(raw: string): string {
  return raw
    .replace(/\b(the\s+)?(junction|corner|intersection)\s+of\b/gi, '')
    .replace(/\b(near|by|at|around)\b/gi, '')
    .replace(/\b(north|south|east|west)\s*-?\s*(side|bound|end)\b/gi, '')
    .replace(/\b(median|shoulder|crosswalk|middle\s+of\s+the\s+road)\b/gi, '')
    .replace(/\s*,\s*(?=,|$)/g, '') // collapse comma debris left by stripping
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/** A match that names a different town than the one we anchored the query to
 *  is worse than no match — the crew would drive there. Conservative: the
 *  formatted address must mention the city (covers "Peoria" and
 *  "Peoria Heights"; a suburb that doesn't say the name fails soft to the
 *  resident's own words). */
export function matchInCity(formattedAddress: string, city: string): boolean {
  const head = city.split(',')[0].trim().toLowerCase();
  return !head || formattedAddress.toLowerCase().includes(head);
}

/**
 * Resolve a resident's location to a matched address + coordinates.
 * Uses Google Geocoding when GOOGLE_MAPS_API_KEY is set (handles intersections
 * like "Fry & Knoxville", landmarks, and partial/messy input); otherwise falls
 * back to the free Census geocoder. Fail-soft: any error / non-match → null and
 * the UI just shows the resident's own words.
 */
/** Google place types that describe an AREA, not a spot. A phrase the geocoder
 *  can't place ("behind the big oak tree by the creek") falls back to the
 *  locality — which resolves to the city centroid and looks exactly like a
 *  successful match. Pinning that is worse than not pinning at all: it tells a
 *  crew "here" while carrying no more information than the city name we already
 *  anchored the query with. Denylist rather than allowlist so an unusual but
 *  genuine place type (a park, a bridge, an establishment) still pins. */
const AREA_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'postal_code',
  'postal_code_prefix',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
]);

/** Is this result a place a crew could drive to, rather than a region? */
export function isPinnablePlace(types: string[] | undefined): boolean {
  if (!types || types.length === 0) return true; // unknown shape — don't over-reject
  return !types.some((t) => AREA_TYPES.has(t));
}

/** A `route` match is a whole street, not a spot — pinnable (crews drive on
 *  streets) but only street-grade. The middle case between a real point
 *  (intersection / street_address / premise) and the area shrugs above. */
export function isStreetGrade(types: string[] | undefined): boolean {
  return Boolean(types?.includes('route'));
}

/** Did the resident's phrase name a CORNER ("A and B", with or without a
 *  trailing ", landmark" clause)? Only then is a street-grade match a missed
 *  corner worth flagging — a plain street name pinned as a street is faithful. */
export function cornerShaped(cleaned: string): boolean {
  return /\s(?:and|&)\s/i.test(cleaned.split(',')[0]);
}

/** In-city, deduped, capped — the shape both providers' raw results reduce to.
 *  Order is preserved (providers rank by confidence). */
export function pickCandidates(matches: GeoMatch[], city: string, max = 4): GeoMatch[] {
  const seen = new Set<string>();
  const out: GeoMatch[] = [];
  for (const m of matches) {
    if (!matchInCity(m.matched, city)) {
      console.warn(`[geocode] out-of-city match dropped: "${m.matched}"`);
      continue; // no pin beats a wrong pin
    }
    const key = m.matched.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length === max) break;
  }
  return out;
}

/** "A and B" names the same corner as "B and A" — but the provider is
 *  word-order sensitive. Probed live (Finding 5, 2026-08-18): Peoria has two
 *  Knoxville/Frye intersections ~5.8 miles apart, and "Knoxville and Frye"
 *  returns both while "Frye and Knoxville" returns only one — so the resident
 *  who says it in the "wrong" order is never shown the corner they meant (the
 *  alternates row has nothing to render). For an intersection-shaped phrase,
 *  return both orders so both get queried. Comma-bearing phrases are left
 *  alone: "Fry and Knoxville, Peoria" would swap into nonsense. */
const STREET_TYPE_RE =
  /\s+(avenue|ave|street|st|road|rd|drive|dr|boulevard|blvd|lane|ln|parkway|pkwy|court|ct|place|pl|terrace|ter|highway|hwy)\.?$/i;

/** "Frye Avenue" → "Frye". A resident names the suffix from memory, not a map
 *  — Rajeev's filed "Frye Avenue and Knoxville Avenue" excluded the N Frye RD
 *  corner in both word orders purely because he guessed "Avenue". */
function bareStreet(part: string): string {
  return part.trim().replace(STREET_TYPE_RE, '');
}

export function intersectionVariants(cleaned: string): string[] {
  const m = cleaned.match(/^([^,]+?)\s+(?:and|&)\s+([^,]+)$/i);
  if (!m) return [cleaned];
  const a = m[1].trim();
  const b = m[2].trim();
  const bareA = bareStreet(a);
  const bareB = bareStreet(b);
  const variants = [cleaned, `${b} and ${a}`];
  if (bareA !== a || bareB !== b) variants.push(`${bareA} and ${bareB}`, `${bareB} and ${bareA}`);
  return [...new Set(variants)];
}

/** All plausible in-city pins for a resident's phrase, best first. The top one
 *  is the auto-pin; the rest are offered as "not this spot?" alternates. */
export async function geocodeCandidates(rawLocation: string, city: string): Promise<GeoMatch[]> {
  const cleaned = normalizeLocation(rawLocation);
  if (!cleaned) return [];
  // The agent often already includes the city ("... , Peoria, IL"); don't append
  // it twice — Google tolerates it, but the query stays cleaner this way.
  const head = city.split(',')[0].trim().toLowerCase();
  const variants = intersectionVariants(cleaned).map((v) =>
    head && v.toLowerCase().includes(head) ? v : `${v}, ${city}`,
  );
  // Resident's own word order first: its top result stays the auto-pin, the
  // swapped order only ever ADDS candidates (pickCandidates dedups the overlap).
  const perVariant = await Promise.all(
    variants.map((v) => (process.env.GOOGLE_MAPS_API_KEY ? geocodeGoogle(v) : geocodeCensus(v))),
  );
  const picked = pickCandidates(perVariant.flat(), city);
  // `approximate` only means something when a corner was asked for; a plain
  // street name matched as a street is exactly what they said.
  return cornerShaped(cleaned) ? picked : picked.map(({ approximate: _drop, ...rest }) => rest);
}

export async function geocodeApprox(rawLocation: string, city: string): Promise<GeoMatch | null> {
  return (await geocodeCandidates(rawLocation, city))[0] ?? null;
}

// Google Geocoding — strong on intersections, landmarks, and loose phrasing.
// Also typo-tolerant: "Fry & Knoxville" → "Knoxville Ave & E Frye Ave".
// Returns ALL results (ranked); the caller filters and caps.
async function geocodeGoogle(address: string): Promise<GeoMatch[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', key);
  // Anchor to US; the ", <city>" in the address carries the locality/state.
  url.searchParams.set('components', 'country:US');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data?.status !== 'OK') {
      // ZERO_RESULTS is normal; REQUEST_DENIED means the Geocoding API isn't
      // enabled on the key's Cloud project — worth surfacing, never silent.
      if (data?.status !== 'ZERO_RESULTS') {
        console.warn(`[geocode] google status=${data?.status} msg=${data?.error_message ?? ''}`);
      }
      return [];
    }
    return (data.results ?? [])
      .map((m: any) => {
        const loc = m?.geometry?.location;
        if (!m?.formatted_address || typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number')
          return null;
        // A city/ZIP centroid is the geocoder shrugging, not a location.
        if (!isPinnablePlace(m?.types)) {
          console.warn(`[geocode] area-level match dropped: "${m.formatted_address}" (${(m.types ?? []).join(',')})`);
          return null;
        }
        return {
          matched: m.formatted_address,
          lat: loc.lat,
          lon: loc.lng,
          ...(isStreetGrade(m?.types) ? { approximate: true } : {}),
        } as GeoMatch;
      })
      .filter(Boolean) as GeoMatch[];
  } catch {
    return []; // fail-soft
  }
}

// Free US Census geocoder — address-oriented fallback (weak on intersections).
async function geocodeCensus(address: string): Promise<GeoMatch[]> {
  const url = new URL(CENSUS_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000); // never hold up the preview
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.result?.addressMatches ?? [])
      .map((m: any) =>
        m?.matchedAddress && m?.coordinates
          ? { matched: m.matchedAddress, lat: Number(m.coordinates.y), lon: Number(m.coordinates.x) }
          : null,
      )
      .filter(Boolean) as GeoMatch[];
  } catch {
    return []; // fail-soft — approximate matching is a bonus, never a blocker
  }
}
