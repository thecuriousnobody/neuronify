// Does a map pin still belong to the words on screen?
//
// A resolved pin is only ever an interpretation of a location the resident
// typed. The two travel separately — the field keeps the resident's own words,
// the pin rides alongside as coordinates — so nothing stops them drifting apart
// when the resident edits the address on the review screen. A report whose text
// says "Main and Adams" and whose pin sits at Knoxville & Frye sends a crew to
// the wrong corner, and no screen ever shows the contradiction.
//
// So: one rule, applied everywhere a pin is displayed or filed. If the pin
// wasn't resolved from the text currently in the field, it does not apply.
//
// Deliberately in its own module rather than in lib/geocode.ts — the review
// screen is a client component, and importing the geocoder would pull provider
// fetch code into the browser bundle for the sake of a string comparison.

/** How two location strings are compared: case and spacing are noise, because
 *  they can't change what the geocoder returns. Anything else is a real edit. */
function canonical(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a pin resolved from `resolvedFrom` may still be shown against, or
 * filed with, `currentText`.
 *
 * Fails closed: empty text has no pin, and an unknown origin (a pin from before
 * we tracked what produced it) is treated as stale rather than assumed good.
 */
export function pinStillApplies(
  resolvedFrom: string | null | undefined,
  currentText: string | null | undefined,
): boolean {
  const from = canonical(resolvedFrom);
  const now = canonical(currentText);
  return from !== '' && from === now;
}
