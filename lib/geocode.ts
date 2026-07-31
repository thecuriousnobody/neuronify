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

/** All plausible in-city pins for a resident's phrase, best first. The top one
 *  is the auto-pin; the rest are offered as "not this spot?" alternates. */
export async function geocodeCandidates(rawLocation: string, city: string): Promise<GeoMatch[]> {
  const cleaned = normalizeLocation(rawLocation);
  if (!cleaned) return [];
  // The agent often already includes the city ("... , Peoria, IL"); don't append
  // it twice — Google tolerates it, but the query stays cleaner this way.
  const head = city.split(',')[0].trim().toLowerCase();
  const anchored = head && cleaned.toLowerCase().includes(head) ? cleaned : `${cleaned}, ${city}`;
  const matches = await (process.env.GOOGLE_MAPS_API_KEY
    ? geocodeGoogle(anchored)
    : geocodeCensus(anchored));
  return pickCandidates(matches, city);
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
        return { matched: m.formatted_address, lat: loc.lat, lon: loc.lng } as GeoMatch;
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
