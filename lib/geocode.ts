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

export async function geocodeApprox(rawLocation: string, city: string): Promise<GeoMatch | null> {
  const cleaned = normalize(rawLocation);
  if (!cleaned) return null;

  // "Peoria, IL" style city strings ride along to anchor the search.
  const address = `${cleaned}, ${city}`;
  const url = new URL(CENSUS_URL);
  url.searchParams.set('address', address);
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
