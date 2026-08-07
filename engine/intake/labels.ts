// Turning internal keys into words people read.
//
// Form keys are namespaced (`intake_pothole`, and v1's `pothole_report`) so the
// two generations of forms can share a table without colliding. That namespace is
// a storage detail and belongs to nobody outside this repo — but copies of a
// naive prettifier had grown across the app, and the ones on the staff surfaces
// never stripped it, so crews were reading cases titled "Intake Pothole"
// (Blake 4.3). One helper now.
//
// It lives in the engine because the engine composes workflow TITLES from form
// keys, and the engine may not import from the app. `lib/labels` re-exports it.

/** A form key as a person should see it: "intake_pothole" → "Pothole". */
export function prettyFormKey(key: string): string {
  const bare = String(key ?? '')
    .replace(/^intake_/, '')
    .replace(/_report$/, '');
  return prettyKey(bare);
}

/** A field key, step key, or department as a person should see it. */
export function prettyKey(key: string): string {
  return String(key ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
