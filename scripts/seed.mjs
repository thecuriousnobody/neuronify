// Seeds a fresh session with realistic Peoria resident signals — a mix of
// grounded infrastructure asks and big-dream civic ideas — so the wall + brief
// can be rehearsed. Submits through the real /api/submit (real Agent A triage).
//
// Usage:  node scripts/seed.mjs            (hits localhost:3000)
//         SEED_BASE=https://neuronify.ai node scripts/seed.mjs

const BASE = process.env.SEED_BASE || 'http://localhost:3000';

const SIGNALS = [
  // — grounded infrastructure (anchors the cost data) —
  "There's a deep pothole on Knoxville Avenue near the Sheridan intersection that's been there for weeks. It already bent my rim once.",
  "The streetlights along Prospect Road by the park have been out for over a month. It's pitch black and feels unsafe walking home at night.",
  "The sidewalk on University Street is so cracked and heaved that my mother can't get her wheelchair down it at all.",
  "We badly need a crosswalk signal at Main and Sheridan. Kids cross there for school every morning and the cars do not stop.",
  "The storm drain on Sheridan floods the whole block every single time it rains hard.",
  "The trash and recycling cans downtown are always overflowing on the weekends. We need more of them and more frequent pickup.",
  "The bus shelter at Knoxville and War Memorial is broken and gives no protection from the rain or the cold.",
  "Graffiti has covered the Adams Street underpass for months and nobody has cleaned it.",
  "We need a stop sign at Sterling and Loucks. Cars blow through that corner and somebody is going to get hurt.",
  "The playground at Glen Oak Park has rusted, broken equipment. It isn't safe for little kids anymore.",

  // — quality of life / greening —
  "Could we plant more shade trees along the main corridors? The summers keep getting hotter and there's no shade downtown.",
  "I'd love a few more benches and some shade along the riverfront. There's nowhere to just sit and enjoy the river.",

  // — the big-dream ideas: arts, mobility, revitalization, opportunity —
  "I wish Peoria had way more public art. Murals, sculptures, something that makes downtown feel alive instead of empty and gray.",
  "Getting around Peoria without a car is rough. What if we had a trust-based, local-only carpooling system where neighbors help neighbors get to work and appointments safely?",
  "The south side of Peoria has so many boarded-up, dilapidated homes. We need a real plan to rehab those blocks instead of letting them rot.",
  "Other cities our size have figured out how to make their downtowns thrive. Why can't we borrow what's actually worked elsewhere and adapt it for Peoria?",
  "Downtown is full of empty buildings. Could we turn one into a free maker space where local kids build real things with AI and tools over the summer?",
  "Our downtown small businesses are struggling. Could the city run a recurring pop-up night market to bring people back downtown on weekends?",
  "Young people can't afford to stay in Peoria. We need more affordable housing near the downtown jobs and the river.",
  "Can we host a community art weekend and let residents paint murals on the blank walls and underpasses downtown? Turn the eyesores into landmarks.",
];

// Pekin, IL — authentic local signals. Run with: SEED_CITY=pekin node scripts/seed.mjs
const PEKIN_SIGNALS = [
  "Court Street downtown has too many empty storefronts. We need a real plan to bring shops and people back to the heart of Pekin.",
  "Mineral Springs Park is a gem but the lagoon and the old pavilion are run down. Could we restore it to what it used to be?",
  "Veterans Drive backs up badly near the bridge at rush hour. People crossing to Peoria for work sit in it every day.",
  "The Pekin riverfront along the Illinois River is underused. Imagine a real riverfront park and trail people would actually visit.",
  "Potholes all over Broadway and Derby are wrecking cars. They've been patched and re-opened for years.",
  "We need better bus connections between Pekin and Peoria for the people who work across the river and don't drive.",
  "Could Pekin throw a big downtown arts and music festival again, like the Marigold days, to draw people back?",
  "Spring flooding near the river keeps damaging the same homes. We need serious stormwater and levee investment.",
  "The empty buildings downtown could become a maker space or small-business incubator for Pekin's young people.",
  "Kids walking to Pekin Community High School need safer sidewalks and more streetlights along the route.",
  "The skate park and courts at the south side parks are worn out. Give kids somewhere safe to be.",
  "More trees and shade downtown — the summers are brutal and Court Street is all pavement.",
];

const CITY = (process.env.SEED_CITY || '').toLowerCase();
const SET = CITY === 'pekin' ? PEKIN_SIGNALS : SIGNALS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const today = new Date().toISOString().slice(0, 10);
const sres = await fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: `Dry run — ${today}`, city: CITY }),
});
const session = await sres.json();
console.log(`Fresh session (${CITY || 'peoria'}):`, session.id);

let ok = 0;
let other = 0;
for (let i = 0; i < SET.length; i++) {
  try {
    const r = await fetch(`${BASE}/api/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.31.0.${i}` },
      body: JSON.stringify({ raw_text: SET[i], session_id: session.id, city: CITY }),
    });
    const d = await r.json();
    if (d.status === 'triaged') {
      ok++;
      console.log(`✓ ${i + 1}/${SET.length}  ${d.category}/${d.severity}  $${d.cost_low_usd}-${d.cost_high_usd}  ${(d.summary || '').slice(0, 48)}`);
    } else {
      other++;
      console.log(`• ${i + 1}/${SET.length}  ${d.status || 'no-status'}`);
    }
  } catch (e) {
    other++;
    console.log(`✗ ${i + 1}  ${e.message}`);
  }
  await sleep(6500); // pace for Groq's free-tier tokens-per-minute ceiling
}

console.log(`\nDone: ${ok} triaged, ${other} other. Session ${session.id}`);
console.log(`View: ${BASE === 'http://localhost:3000' ? 'http://localhost:3000' : BASE}/wall  and  /brief/${session.id}`);
