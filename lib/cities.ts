// Cities Neuronify can serve. Sessions are keyed by `db` (stored on the row);
// the UI is driven by a `?city=<slug>` query param. Adding a city is one entry.
export type City = { slug: string; short: string; db: string; prompt: string };

export const CITIES: Record<string, City> = {
  peoria: { slug: 'peoria', short: 'Peoria', db: 'Peoria, IL', prompt: 'Peoria, Illinois' },
  pekin: { slug: 'pekin', short: 'Pekin', db: 'Pekin, IL', prompt: 'Pekin, Illinois' },
};

export const DEFAULT_CITY = CITIES.peoria;

export function resolveCity(slug?: string | null): City {
  return CITIES[(slug || '').toLowerCase()] ?? DEFAULT_CITY;
}

export function cityByDb(db?: string | null): City {
  return Object.values(CITIES).find((c) => c.db === db) ?? DEFAULT_CITY;
}
