// The candidate map, as a URL. When the geocoder returns more than one
// plausible spot (Finding 5: two Knoxville/Frye corners, 5.8 miles apart), the
// resident picks from PINS ON A MAP — never from formal street names they
// can't resolve while standing at the corner (Finding 7). The Google key stays
// server-side: the client asks our /api/v2/staticmap proxy, which builds this
// URL and streams the image back.

export interface MapPoint {
  lat: number;
  lon: number;
}

/** The alternates row caps at 4 candidates (pickCandidates), so the map does too. */
export const MAX_PINS = 4;

/** Marker letters, in candidate order — the same letters the pick buttons show. */
export const PIN_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** The `pins` query param the client sends: "lat,lon|lat,lon|…". */
export function pinsParam(pins: MapPoint[]): string {
  return pins.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
}

/** Parse and validate the client's `pins` param. Null on anything malformed —
 *  this is a public endpoint proxying a paid API, so nothing unvalidated may
 *  reach the upstream URL. */
export function parsePins(raw: string | null): MapPoint[] | null {
  if (!raw) return null;
  const parts = raw.split('|').filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_PINS) return null;
  const out: MapPoint[] = [];
  for (const part of parts) {
    const pieces = part.split(',');
    if (pieces.length !== 2) return null;
    const lat = Number(pieces[0]);
    const lon = Number(pieces[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    out.push({ lat, lon });
  }
  return out;
}

/** The upstream Google Static Maps URL. With several pins there is no
 *  center/zoom — the API auto-fits them, which is exactly right for "how far
 *  apart are these really?". A single pin is a CONFIRMATION map ("yes, that's
 *  the spot I mean"), so it gets a fixed street-level zoom and no letter. */
export function staticMapUrl(pins: MapPoint[], key: string): string {
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('size', '600x300');
  url.searchParams.set('scale', '2');
  url.searchParams.set('maptype', 'roadmap');
  if (pins.length === 1) {
    url.searchParams.set('zoom', '15');
    url.searchParams.append('markers', `${pins[0].lat.toFixed(6)},${pins[0].lon.toFixed(6)}`);
  } else {
    pins.forEach((p, i) => {
      url.searchParams.append(
        'markers',
        `label:${PIN_LETTERS[i] ?? ''}|${p.lat.toFixed(6)},${p.lon.toFixed(6)}`,
      );
    });
  }
  url.searchParams.set('key', key);
  return url.toString();
}
