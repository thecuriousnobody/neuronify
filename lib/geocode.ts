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

/** Strip spoken filler so the geocoder sees a plain address/intersection. */
function normalize(raw: string): string {
  return raw
    .replace(/\b(the\s+)?(junction|corner|intersection)\s+of\b/gi, '')
    .replace(/\b(near|by|at|around)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a resident's location to a matched address + coordinates.
 * Uses Google Geocoding when GOOGLE_MAPS_API_KEY is set (handles intersections
 * like "Fry & Knoxville", landmarks, and partial/messy input); otherwise falls
 * back to the free Census geocoder. Fail-soft: any error / non-match → null and
 * the UI just shows the resident's own words.
 */
export async function geocodeApprox(rawLocation: string, city: string): Promise<GeoMatch | null> {
  const cleaned = normalize(rawLocation);
  if (!cleaned) return null;
  const hasGoogle = !!process.env.GOOGLE_MAPS_API_KEY;
  console.log(`[geocode] provider=${hasGoogle ? 'google' : 'census'} query="${cleaned}, ${city}"`);
  return hasGoogle ? geocodeGoogle(cleaned, city) : geocodeCensus(cleaned, city);
}

// Google Geocoding — strong on intersections, landmarks, and loose phrasing.
async function geocodeGoogle(cleaned: string, city: string): Promise<GeoMatch | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', `${cleaned}, ${city}`);
  url.searchParams.set('key', key);
  // Anchor to US; the ", <city>" in the address carries the locality/state.
  url.searchParams.set('components', 'country:US');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data?.status !== 'OK') {
      // Surface WHY (REQUEST_DENIED = key/API/billing; ZERO_RESULTS = no match).
      console.warn(`[geocode] google status=${data?.status} msg=${data?.error_message ?? ''}`);
      return null;
    }
    const m = data.results?.[0];
    const loc = m?.geometry?.location;
    if (!m?.formatted_address || typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null;
    return { matched: m.formatted_address, lat: loc.lat, lon: loc.lng };
  } catch {
    return null; // fail-soft
  }
}

// Free US Census geocoder — address-oriented fallback (weak on intersections).
async function geocodeCensus(cleaned: string, city: string): Promise<GeoMatch | null> {
  const url = new URL(CENSUS_URL);
  url.searchParams.set('address', `${cleaned}, ${city}`);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000); // never hold up the preview
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    const m = data?.result?.addressMatches?.[0];
    if (!m?.matchedAddress || !m?.coordinates) return null;
    return { matched: m.matchedAddress, lat: Number(m.coordinates.y), lon: Number(m.coordinates.x) };
  } catch {
    return null; // fail-soft — approximate matching is a bonus, never a blocker
  }
}
