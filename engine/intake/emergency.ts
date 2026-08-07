// The hard stop.
//
// A 311 intake assistant will, left to itself, politely collect a service
// request for a gas leak. That is the failure this module exists to prevent: if
// someone describes a life-safety emergency, the conversation BREAKS and points
// them at 911 or their utility's emergency line instead of continuing to fill in
// a form.
//
// Three deliberate properties:
//
//  1. DETERMINISTIC, and it runs BEFORE the model. The stop is not a prompt rule
//     the model may weigh against being helpful — it is a branch the model never
//     sees. A prompt can be argued with; this cannot.
//
//  2. IT BREAKS, IT DOES NOT BLOCK. The resident can acknowledge and carry on
//     filing afterwards. Plenty of real emergencies also warrant a report, and a
//     dead end would just push them to give up or start over.
//
//  3. IT NEVER INVENTS A PHONE NUMBER. 911 is the one contact this code states
//     from its own knowledge. Utility emergency lines differ per city and a
//     wrong number in front of someone smelling gas is worse than no number, so
//     they come from configuration and the copy degrades honestly when unset.
//
// The bias is toward stopping: a false stop costs a resident one extra tap, a
// missed one costs something we cannot undo.

/** Who the resident needs, which is not always the city. */
export type EmergencyKind = 'life_safety' | 'gas' | 'power' | 'water';

export interface EmergencyContacts {
  /** Gas utility emergency line, e.g. Ameren Illinois for Peoria. */
  gas?: string | null;
  /** Electric utility emergency line — downed or arcing lines. */
  power?: string | null;
  /** Water utility emergency line. In Peoria this is a PRIVATE utility. */
  water?: string | null;
}

export interface EmergencyMatch {
  kind: EmergencyKind;
  /** The phrase that tripped it. Recorded so a false stop is debuggable. */
  trigger: string;
  /** What the resident is shown, in place of the next intake question. */
  message: string;
}

/**
 * Phrases that mean "this is not a service request".
 *
 * Kept as explicit phrases rather than loose single words on purpose: "fire"
 * alone matches "fire hydrant" and "fire lane", and an assistant that shouts
 * about 911 every time someone mentions a hydrant is one nobody will use — which
 * is its own safety problem.
 */
const PATTERNS: { kind: EmergencyKind; re: RegExp }[] = [
  // Gas. Smell of gas is the classic one people report to the wrong place.
  { kind: 'gas', re: /\b(?:smell(?:s|ing)?|smelt|odou?r) of (?:natural )?gas\b/i },
  { kind: 'gas', re: /\b(?:gas|propane) (?:leak|smell|odou?r)\b/i },
  { kind: 'gas', re: /\bsmell(?:s|ing)? (?:like )?(?:natural )?gas\b/i },
  { kind: 'gas', re: /\brotten egg smell\b/i },

  // Electricity. A downed line is lethal and is routinely reported as "a tree
  // came down" — the tree_issue category would happily take it.
  { kind: 'power', re: /\b(?:downed|down(?:ed)? live|fallen|hanging) (?:power |electric(?:al)? |utility )?(?:line|lines|wire|wires|cable)\b/i },
  { kind: 'power', re: /\b(?:power |electric(?:al)? |utility )(?:line|lines|wire|wires) (?:is |are )?(?:down|arcing|sparking|on fire)\b/i },
  { kind: 'power', re: /\barcing (?:wire|line|transformer)\b/i },
  { kind: 'power', re: /\btransformer (?:is )?(?:on fire|exploded|blew up)\b/i },

  // Water. A main break floods fast and is a private utility here.
  { kind: 'water', re: /\bwater main (?:break|broke|burst|bursting|rupture)\b/i },
  { kind: 'water', re: /\bmain (?:is )?(?:broken|burst)\b/i },
  { kind: 'water', re: /\bgeyser|water shooting (?:up|out)\b/i },

  // Everything that is simply 911.
  { kind: 'life_safety', re: /\b(?:someone|somebody|a (?:man|woman|child|kid|person)|he|she|they) (?:is |was |got )?(?:hurt|injured|bleeding|unconscious|trapped|drowning)\b/i },
  { kind: 'life_safety', re: /\b(?:call|called|need) (?:an )?ambulance\b/i },
  { kind: 'life_safety', re: /\b(?:house|building|car|brush|structure) fire\b/i },
  { kind: 'life_safety', re: /\b(?:building|house|structure) (?:is )?(?:on fire|collapsed|collapsing)\b/i },
  { kind: 'life_safety', re: /\bactive(?:ly)? flooding\b|\bflood(?:ing|water)s? (?:is |are )?(?:rising|in (?:the|my) (?:house|home|basement))\b/i },
  { kind: 'life_safety', re: /\bgun ?(?:shot|fire)|\bshooting\b|\bstabbed\b/i },
  { kind: 'life_safety', re: /\bmedical emergency\b|\bheart attack\b|\bnot breathing\b/i },
];

/**
 * Negators that disarm a match.
 *
 * "There are no downed wires" and "I don't smell gas" are people ruling things
 * OUT, usually helpfully. Only a short window before the phrase counts, so
 * "no parking sign is down and a power line is down too" still stops.
 */
const NEGATORS = /\b(?:no|not|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|never|without|nothing)\b/i;
const NEGATION_WINDOW = 28; // characters before the match

function isNegated(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - NEGATION_WINDOW), matchIndex);
  return NEGATORS.test(before);
}

function messageFor(kind: EmergencyKind, contacts: EmergencyContacts): string {
  const utility = (line: string | null | undefined, who: string) =>
    line ? `${who} at ${line}` : `${who}'s emergency line`;

  switch (kind) {
    case 'gas':
      return [
        'Please stop and do this first: if you smell gas, leave the area straight away — don’t switch anything on or off, and don’t use your phone until you’re outside and away from the building.',
        `Then call 911, or ${utility(contacts.gas, 'the gas utility')}.`,
        'This isn’t something a service request can handle in time. I’ll still be here afterwards if you want to report it to the city as well.',
      ].join('\n\n');
    case 'power':
      return [
        'Please treat a downed line as live. Stay well back — at least the length of a bus — and keep others and any pets away from it, and from anything it’s touching.',
        `Then call 911, or ${utility(contacts.power, 'the electric utility')}.`,
        'A service request would sit in a queue; this needs someone dispatched now. I’ll still be here afterwards.',
      ].join('\n\n');
    case 'water':
      return [
        'A water main break needs the utility dispatched right away, not a service request.',
        `Please call ${utility(contacts.water, 'the water utility')} now — or 911 if water is entering a building or reaching electrical equipment.`,
        'Come back to me afterwards and I’ll take the report for the city.',
      ].join('\n\n');
    case 'life_safety':
    default:
      return [
        'Please call 911 now.',
        'From what you’ve described, this needs emergency services rather than a city service request — a report filed here goes into a queue and won’t reach anyone in time.',
        'I’ll still be here if you want to file something with the city once everyone is safe.',
      ].join('\n\n');
  }
}

/**
 * Check one resident message for anything that must interrupt intake.
 *
 * `acknowledged` carries the kinds this resident has already been shown and
 * dismissed, so the same warning doesn't wall off the rest of the conversation.
 * A DIFFERENT kind still stops them.
 */
export function detectEmergency(
  text: string,
  contacts: EmergencyContacts = {},
  acknowledged: readonly EmergencyKind[] = [],
): EmergencyMatch | null {
  const message = String(text ?? '');
  if (!message.trim()) return null;

  for (const { kind, re } of PATTERNS) {
    if (acknowledged.includes(kind)) continue;
    const m = re.exec(message);
    if (!m) continue;
    if (isNegated(message, m.index)) continue;
    return { kind, trigger: m[0], message: messageFor(kind, contacts) };
  }
  return null;
}

/**
 * Emergency contacts for a city.
 *
 * Deliberately empty until someone confirms the real numbers for a city — the
 * copy degrades to "the gas utility's emergency line" rather than printing a
 * number nobody verified. 911 is always offered regardless.
 *
 * BEFORE A PILOT: fill this in for the pilot city and have someone from that
 * city check every number by dialling it.
 */
export const EMERGENCY_CONTACTS: Record<string, EmergencyContacts> = {};

export function emergencyContactsFor(city: string): EmergencyContacts {
  return EMERGENCY_CONTACTS[city] ?? {};
}
