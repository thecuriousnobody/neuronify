// Resident-friendly names for ambiguous map candidates.
//
// Finding 7 (Rajeev, 2026-08-18): "Did you mean N Frye Rd or E Frye Ave?" is
// unanswerable by the person standing at the corner — the sign just says Frye.
// When candidates need telling apart, anchor each to something a resident
// actually holds: the nearest named place ("near Northwoods Mall"), or failing
// that a plain-language direction ("north Peoria"). Formal street names are
// the LAST resort, used only when two candidates would otherwise read the same.
//
// Fail-soft everywhere: labels are a courtesy on top of the map pins, never a
// blocker. No key / no Places result / timeout → the directional fallback.

export interface GeoCandidate {
  matched: string;
  lat: number;
  lon: number;
}

export interface LabeledCandidate extends GeoCandidate {
  /** Resident-friendly anchor, e.g. "near Northwoods Mall" or "north Peoria". */
  label: string;
}

/** City centers for the directional fallback. Peoria's is the Main/Adams
 *  downtown core, not the municipal-boundary centroid (which sits well north
 *  of what anyone calls "downtown"). */
const CITY_CENTERS: Record<string, { lat: number; lon: number }> = {
  'Peoria, IL': { lat: 40.6936, lon: -89.589 },
};

/** "north Peoria" / "near downtown Peoria" from coordinates alone — the label
 *  of last resort before street names, so it must always produce something. */
export function areaLabel(lat: number, lon: number, city: string): string {
  const head = city.split(',')[0].trim();
  const center = CITY_CENTERS[city];
  if (!center) return head;
  const dLat = lat - center.lat;
  const dLon = (lon - center.lon) * Math.cos((lat * Math.PI) / 180);
  const km = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
  if (km < 1.6) return `near downtown ${head}`;
  const direction =
    Math.abs(dLat) >= Math.abs(dLon)
      ? dLat > 0
        ? 'north'
        : 'south'
      : dLon > 0
        ? 'east'
        : 'west';
  return `${direction} ${head}`;
}

/** First Places result that reads as a landmark. Accepts both the v1 shape
 *  ({ displayName: { text } }) and a bare { name } for tests. Street-address
 *  "names" are skipped — "near 123 Main St" anchors nothing. */
export function pickLandmarkName(results: unknown): string | null {
  if (!Array.isArray(results)) return null;
  for (const r of results as any[]) {
    const raw = typeof r?.displayName?.text === 'string' ? r.displayName.text : r?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    if (/^\d+\s/.test(name)) continue;
    return name;
  }
  return null;
}

// Per-instance memo: candidates repeat across turns of one conversation, and a
// Places call per repeat would be pure waste. Keyed at ~100m resolution.
const landmarkCache = new Map<string, string | null>();

/** Nearest named place via Google Places. Null on any failure — the caller
 *  falls back to areaLabel. */
export async function nearbyLandmark(lat: number, lon: number): Promise<string | null> {
  // Both keys are tried: the dedicated Places key 403s on the v1 API today
  // (probed live 2026-08-19) while the Maps key is entitled — but if Rajeev
  // later fixes the Places key's permissions, it takes over without a deploy.
  const keys = [process.env.GOOGLE_PLACES_API_KEY, process.env.GOOGLE_MAPS_API_KEY].filter(
    (k): k is string => Boolean(k),
  );
  if (!keys.length) return null;
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (landmarkCache.has(cacheKey)) return landmarkCache.get(cacheKey)!;
  for (const key of keys) {
    try {
      // Places API v1 (the legacy nearbysearch endpoint is not enabled on this
      // project). POPULARITY, not DISTANCE: the nearest POI to a corner is a
      // random office listing ("Buckingham Jeffrey K"); the popular one is the
      // Kroger everyone actually navigates by. Probed live on both Frye corners.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.displayName',
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lon }, radius: 700 },
          },
          rankPreference: 'POPULARITY',
          maxResultCount: 5,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue; // wrong entitlement on this key — try the next
      const data: any = await res.json();
      const name = pickLandmarkName(data?.places);
      landmarkCache.set(cacheKey, name);
      return name;
    } catch {
      // timeout / network — the next key won't do better; fall through to null
      break;
    }
  }
  landmarkCache.set(cacheKey, null);
  return null;
}

/** De-duplicate labels: two candidates reading "north Peoria" tell the
 *  resident nothing. Duplicates fall back to the cleaned street name — the
 *  last resort, but at least a DISTINCT one, and the map pins still carry the
 *  real disambiguation. Pure and exported for tests. */
export function dedupeLabels(labeled: LabeledCandidate[]): LabeledCandidate[] {
  const counts = new Map<string, number>();
  for (const c of labeled) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return labeled.map((c) =>
    (counts.get(c.label) ?? 0) > 1 ? { ...c, label: c.matched.replace(/, USA$/, '') } : c,
  );
}

/** Attach a resident-friendly label to every candidate. Only worth calling
 *  when there is more than one — a single candidate never needs telling apart. */
export async function labelCandidates(
  candidates: GeoCandidate[],
  city: string,
): Promise<LabeledCandidate[]> {
  const labeled = await Promise.all(
    candidates.map(async (c) => {
      const landmark = await nearbyLandmark(c.lat, c.lon);
      return { ...c, label: landmark ? `near ${landmark}` : areaLabel(c.lat, c.lon, city) };
    }),
  );
  return dedupeLabels(labeled);
}
