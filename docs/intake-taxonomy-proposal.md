# Smart Intake — 311 Taxonomy & Data-Model Proposal

**Status:** Draft for Rajeev + Blake to react to. **No code yet.**
**Date:** 2026-07-17
**Purpose:** Replace the current free-text `category` with a *discrete, 311-sourced* taxonomy so a citizen report can be routed straight to the owning department, and define the *category-specific required fields* the conversation collects. This is the greenlit first step of the **Smart Intake** build.

---

## 0. TL;DR — the two findings that shape everything

1. **Real 311 systems are two-level and department-owned.**
   - **Peoria** ("Peoria Cares" / uReport, QScend-style): `Category → Issue Type`, auto-emailed to "the appropriate department." Portal URLs literally carry `category_id` + `issueType_id`.
   - **Evanston** (Catalis/QScend, live form read verbatim 2026-07-17): **17 top-level options that *are* the owning departments**, each expanding into request types.
   - So the native shape everywhere is **`category → owning department → fields`.** That's exactly what we should model.

2. **Neither city collects category-specific fields today.** Both are *flat* forms: **location + description + photo + contact**, identical for every request type. That means our **per-category required fields** (pothole size, tree public-vs-private, dumping material, dead-vs-alive) plus the **conversational refinement** are a genuine **product differentiator** — not table stakes we're catching up on. Lead with that in the pitch.

**Design consequence:** the LLM's job shrinks to **discerning the discrete CATEGORY**. Code does the rest — category → department is a **per-city lookup table** (data, not model), and category → required-field schema is a **form definition** (data, not model). The model proposes one enum value; everything downstream is deterministic and defensible.

---

## 1. How this maps onto what we already have

Almost none of this is new primitives — it's assembly on the existing engine.

| Need | Already exists | Change |
|---|---|---|
| Typed, required, guided fields per category | `FormField` (`engine/domain/types.ts`): `text/longtext/number/boolean/choice/location/date/attachment`, `required`, `choices`, per-field `prompt` guidance, `requiresAttachment` | none — schemas fit as-is (one small gap, §5) |
| Per-category schemas as data | Forms live in `nf_form_definitions` (JSONB) | author N category forms instead of one |
| One-question-at-a-time collection, code-enforced completeness, review-before-submit | `runIntakeTurn` (`engine/intake/conversation.ts`) | reuse verbatim, once the category (=form) is chosen |
| Constrain a model choice to an allow-list, fail-safe | `classify()` already clamps `department` to an allow-list and defaults safely (`engine/intake/digest.ts`) | apply the **same pattern to `category`** (today it's free text) |
| Address completion | Census geocode (`lib/geocode.ts`, already on `/report`) | wire into the conversation |

**The one genuinely new step:** today `formKey` is fixed *up front*. In Smart Intake the agent must **discern the category first**, then load *that* category's schema and run the existing collection loop over it.

### Open311 gives us a proven grammar for the field schemas
The Open311 GeoReport v2 spec models exactly `category → ordered list of typed, individually-required fields with option sets` — i.e. a JSON form schema, portable to any Open311 backend (SeeClickFix, CivicPlus, FixMyStreet). Its `datatype` values map cleanly onto our `FieldType`:

| Open311 datatype | Our `FieldType` |
|---|---|
| `string` | `text` |
| `text` | `longtext` |
| `number` | `number` |
| `datetime` | `date` |
| `singlevaluelist` (choose one) | `choice` (+ `choices`) |
| `multivaluelist` (choose several) | ⚠️ **no equivalent — see §5** |
| `media_url` (photo on the request) | `attachment` (+ `requiresAttachment`) |

---

## 2. Proposed CORE taxonomy (~22 categories)

One **shared canonical core** across cities (the memory's "curated core, grow later"), grounded in the Peoria + Evanston overlap and the common-core reference (Chicago's 110 live SR types, CivicPlus defaults). Each row: a stable **category key** (the enum the LLM picks), plus the **owning department per city** — which genuinely differs, which is why the map is data.

> Legend for department cells: **PW** = Public Works, **CE** = Code Enforcement, **CD** = Community Development, **HHS** = Health & Human Services, **PD** = Police (non-emergency), **WU** = Water Utility, **P&R** = Parks & Rec, **→util** = private utility / out of city scope.

| # | `category_key` | Plain name | Peoria owner | Evanston owner | Notes / divergence |
|---|---|---|---|---|---|
| 1 | `pothole` | Pothole / road surface | PW – Operations | PW Agency | IDOT/County roads redirect (Peoria) |
| 2 | `street_light` | Street light out/damaged | PW | PW Agency | |
| 3 | `sidewalk_damage` | Sidewalk / trip hazard | PW | PW Agency | |
| 4 | `traffic_sign_signal` | Traffic signal / sign | PW | PW Agency | |
| 5 | `snow_ice` | Snow / ice removal | PW | PW Agency | |
| 6 | `missed_collection` | Missed garbage/recycling/yard-waste | PW (hauled by GFL) | PW Agency | |
| 7 | `cart_issue` | Cart/bin damaged/missing/new | PW | PW Agency | |
| 8 | `illegal_dumping` | Illegal dumping / litter | CE – Environmental | HHS / PW | |
| 9 | `tree_issue` | Tree down/limb/dead/trim | CE (limbs) / PW | PW Agency (Forestry) | **public-vs-private ownership gates city responsibility** |
| 10 | `graffiti` | Graffiti | PD ("Crime/Graffiti") | PD | both cities → Police |
| 11 | `abandoned_vehicle` | Abandoned/inoperable vehicle | CE (private) / PD | PD | |
| 12 | `tall_grass_weeds` | Tall grass / weeds / overgrowth | CE – Environmental | CD (Exterior Conditions) | **divergent owner** |
| 13 | `property_maintenance` | Exterior property condition | CE – Housing | CD | siding/gutters/paint/boarded/roof/fence |
| 14 | `vacant_abandoned_property` | Vacant / unsecured building or lot | CE | CD | |
| 15 | `rodent_pest` | Rodents / rats / insects / mosquitoes | CE (rat abatement) | **HHS** | **divergent owner** |
| 16 | `dead_animal` | Dead animal pickup | PW / PD | **PD** (public property) | dead *rodent* → HHS in Evanston |
| 17 | `animal_concern` | Stray / injured / dangerous animal | PD / Animal Control | PD | |
| 18 | `water_sewer` | Water main / no water / sewer / drainage | **→util (Illinois American Water)** | **WU (Water Production)** | **Peoria water is a private utility — route OUT, not to a dept** |
| 19 | `flooding_drainage` | Street flooding / catch basin | PW / Engineering | PW Agency | can fold into #18; kept separate for stormwater |
| 20 | `noise_complaint` | Noise / amplified sound | PD | PD (amplified → HHS) | |
| 21 | `park_maintenance` | Park equipment / restroom / fountain | P&R | P&R | |
| 22 | `other_inquiry` | Anything else / general question | Clerk / general queue | Dept "Ask a Question" | **catch-all fallback — every system keeps one** |

**Notable divergences to confirm (these are why the department map must be per-city data, not intuition):**
- **Rodents/pests:** Peoria → Code Enforcement; Evanston → Health & Human Services.
- **Dead animal:** Evanston → Police (public property), but dead *rodent* → Health.
- **Tall grass / exterior conditions:** Peoria → Code Enforcement; Evanston → Community Development.
- **Water/sewer:** Evanston has a Water Production dept; **Peoria's drinking water is Illinois American Water (private)** — `water_sewer` in Peoria should route to a "contact your water utility" outcome, *not* a city department.

---

## 3. Category-specific field schemas (the differentiator)

Every category shares a **base schema**, then adds its own attributes. Base fields (from both live systems; note Evanston **gates the category picker behind location**, so we ask location early):

- `location` — `location`, **required**. prompt: *"the street address or nearest cross-street / landmark."* (Census geocode autofills partials.)
- `description` — `longtext`, **required**. prompt: *"what's wrong and what it's affecting."*
- `photo` — `attachment`. **required only for the photo-critical cluster** (below).
- *(contact is optional / anonymous-allowed — matches the anonymous-intake goal; collected at the end, not part of routing.)*

**Photo-critical cluster (hard-require a photo):** `graffiti`, `pothole`, `illegal_dumping`, `sidewalk_damage`, `tall_grass_weeds`, `property_maintenance`, `abandoned_vehicle`, `vacant_abandoned_property`. These are all "a crew must see the condition at a location before dispatch" reports.
⚠️ **Dependency:** photo upload is currently **stubbed** ("submit without it"; `/api/v2/submit` defers attachments). Real image upload + storage **must** be built before any category can hard-require a photo. (See §6.)

Below, the per-category attributes. `choice` fields carry plain-language guidance in `prompt` (the point of the build — the department gets an actionable report). Format mirrors `FormField` so this doubles as a seed spec.

### `pothole`
- `road_position` — choice `[travel lane | curb/edge | intersection | alley]`, required
- `size` — choice `[small | medium | large]`, required. prompt: *"small = smaller than a dinner plate; medium = dinner-plate to car-tire; large = bigger than a car tire or spans the lane."*
- `hazard` — boolean, required. prompt: *"dangerous to drive or walk over?"*
- `photo` — attachment, **required**

### `graffiti`
- `surface` — choice `[building | fence | sidewalk/pavement | sign | utility box | underpass | other]`, required
- `property` — choice `[public | private]`, required
- `offensive` — boolean. prompt: *"does it contain hate speech or offensive content?"* (may raise priority)
- `photo` — attachment, **required**

### `illegal_dumping`
- `material` — choice `[household trash | construction debris | tires | appliances | furniture | hazardous/chemical]`, required *(candidate multi-select — see §5)*
- `volume` — choice `[a few items | a pickup-truck load | more than that]`, required
- `on_property` — choice `[public land / right-of-way | private property]`, required
- `photo` — attachment, **required**

### `tree_issue`
- `ownership` — choice `[parkway (between sidewalk & street) | in a park | on private property]`, required. prompt: *"the city handles trees on public parkways and in parks; private-property trees are the owner's responsibility."*
- `problem` — choice `[fallen tree/limb blocking | dead or dying | needs trimming | debris to clear]`, required
- `on_wires` — boolean. prompt: *"is it touching or hanging on power lines?"* (safety escalation)
- `photo` — attachment, optional

### `street_light`
- `pole_id` — text, optional. prompt: *"the number on the pole tag, if you can see it."*
- `failure` — choice `[fully out | on during the day | flickering]`, required

### `sidewalk_damage`
- `problem` — choice `[cracked/heaved | missing section | trip hazard | obstruction blocking path]`, required
- `photo` — attachment, **required**

### `abandoned_vehicle`
- `plate` — text, required
- `vehicle` — text. prompt: *"make, model, color."*
- `days_parked` — choice `[under 3 days | 3–7 days | over a week]`, required
- `on_property` — choice `[public street | private lot]`, required
- `photo` — attachment, **required**

### `missed_collection`
- `stream` — choice `[garbage | recycling | yard waste]`, required
- `set_out_on_time` — boolean, required. prompt: *"was it out by the collection deadline?"*
- `collection_day` — text, optional

### `cart_issue`
- `cart` — choice `[garbage | recycling | yard waste]`, required
- `request` — choice `[damaged | missing/stolen | new or additional | resize]`, required

### `rodent_pest`
- `pest` — choice `[rats/mice | insects | mosquitoes | bees/wasps | other]`, required
- `where` — choice `[inside a building | outside / yard | alley]`, required

### `dead_animal`
- `animal` — choice `[domestic pet | wild / other | rodent]`, required *(routes differently — rodent → Health in Evanston)*
- `on_property` — choice `[public roadway / right-of-way | private property]`, required

### `animal_concern`
- `situation` — choice `[stray | injured | aggressive / dangerous | too many / nuisance]`, required
- `kind` — choice `[domestic | wild]`, required

### `tall_grass_weeds`
- `address` — location, required
- `condition` — choice `[tall grass/weeds | general overgrowth]`, required. prompt (Peoria): *"the city acts on grass over ~10 inches."*
- `photo` — attachment, **required**

### `property_maintenance`
- `issue` — choice `[peeling paint | damaged siding | damaged gutters | rotting wood | boarded windows/doors | broken fence | damaged roof | other]`, required *(candidate multi-select — §5)*
- `occupied` — choice `[occupied | vacant | unknown]`, required
- `photo` — attachment, **required**

### `vacant_abandoned_property`
- `type` — choice `[building | vacant lot]`, required
- `condition` — choice `[open / unsecured | overgrown | fire-damaged | other]`, required
- `photo` — attachment, **required**

### `water_sewer`
- `problem` — choice `[no water | low pressure | main break / water in street | sewer backup | odor | discoloration / quality]`, required
- `photo` — attachment, optional
- **Peoria special-case:** route to "contact Illinois American Water" outcome, not a city department.

### `flooding_drainage`
- `problem` — choice `[standing water in street | clogged catch basin | basement/property flooding]`, required
- `photo` — attachment, optional

### `traffic_sign_signal`
- `type` — choice `[signal fully out | signal malfunctioning | sign knocked down | sign missing/faded]`, required
- `photo` — attachment, optional

### `snow_ice`
- `where` — choice `[street not plowed | sidewalk not cleared | bike lane | intersection]`, required

### `noise_complaint`
- `source` — choice `[residential | commercial | vehicle | construction | amplified music / event]`, required
- `timing` — choice `[happening now | recurring]`, required

### `park_maintenance`
- `park` — text/location, required. prompt: *"which park?"*
- `issue` — choice `[damaged equipment | restroom | lighting | landscaping | water fountain]`, required

### `other_inquiry`
- `description` — longtext, required (base field carries it)
- `suggested_department` — text, optional — routes to a general/clerk queue and can be triaged by staff.

---

## 4. How routing changes (before → after)

**Today** (`classify()` in `engine/intake/digest.ts`): the LLM emits **free-text `category`** *and* picks `department` (constrained to an allow-list). Category is decorative; the model owns the routing decision.

**Proposed:**
1. LLM discerns **`category_key`** from the discrete core (constrained + fail-safe to `other_inquiry`, exactly like `department` is clamped today).
2. **Code** looks up `department = CITY_DEPARTMENT_MAP[city][category_key]` — deterministic, auditable, per-city.
3. **Code** loads `FORM_BY_CATEGORY[category_key]` and runs the existing `runIntakeTurn` collection loop over that schema.
4. Severity stays the existing auto-classified 4-level scale, but can now be *sharpened* by category fields (e.g. `pothole.hazard === true` → at least `high`; `tree_issue.on_wires === true` → `safety_critical`).

This is **more** defensible than today: routing is a lookup keyed on a validated enum, not a free model choice.

---

## 5. Known model gaps to decide on

1. **`multivaluelist` has no `FieldType`.** Two categories want "choose several" (`illegal_dumping.material`, `property_maintenance.issue`). Options: (a) add a `multichoice` FieldType to the engine, or (b) keep them single-select ("pick the main one"). Recommend **(b) for v1** to avoid touching the engine, revisit if departments want multiples.
2. **Category confidence / disambiguation.** When the report is ambiguous ("there's junk and tall grass in the vacant lot next door" → dumping? tall grass? vacant property?), does the agent ask a clarifying question, or pick highest-confidence and let staff reassign? Reassign is already built — recommend **pick + allow reassign**, with a clarifying question only when confidence is low.
3. **Anonymous + required photo tension.** Some photo-critical categories (graffiti, dumping) are exactly the ones anonymous users report. If photo upload isn't built yet, either (a) soft-require (strongly ask, allow skip) until upload ships, or (b) block those categories from anonymous submit. Recommend **(a)**.

---

## 6. Dependencies & sequencing (for when we DO build)

1. **Photo upload + storage** — currently stubbed. Blocks every hard-required photo. Highest-priority enabling work.
2. **Category-first conversation step** — the one new engine piece; everything else is reuse.
3. **Per-city department map** — a small data table; confirm the divergent rows (§2) and the Peoria water special-case with the cities if possible.
4. **Seed N category forms** into `nf_form_definitions` (extend `scripts/seed-engine.mjs`, which today seeds only `pothole_report`).
5. **Retire `/desk/intake`** — LAST. It's the only bridge for anonymous voice reports today; don't remove it until the direct-route path lands.

---

## 7. Open questions for Rajeev + Blake

1. **Granularity** — is ~22 the right core? Any to split (street vs. alley pothole, like Chicago) or merge (`water_sewer` + `flooding_drainage`)?
2. **Photo policy** — agree with the photo-critical cluster hard-requiring a photo (once upload exists)? Anything added/removed?
3. **Department map** — confirm the divergent owners (rodents, dead animal, tall grass) and the **Peoria water = private utility route-out**. Ideally verify against each city's real routing.
4. **Auto-route vs. confirm** — the plan is route-straight-to-department. Keep a light staff confirm for `safety_critical` only, or fully auto?
5. **`other_inquiry` fallback** — keep a catch-all that lands in a general queue? (Both cities do — every dept has "Ask a Question.")
6. **Two cities now, or Peoria first?** — nail Peoria end-to-end, then add Evanston's map, or model both maps from day one?

---

## Appendix — sources

**Peoria (Peoria Cares / uReport):** peoriagov.org/903 (Peoria-Cares), /180 (uReport), /423 (Request-a-City-Service), /813 (Common Code Violations — the Environmental/Housing split), /173 (Code Enforcement), /508 (Streets-Sidewalks); csesoftware.com (vendor writeup); ureport.peoriagov.org (live portal — `category_id`/`issueType_id` params confirm two-level; bot-blocked to automated fetch). *Live dropdown not machine-enumerable; category names + ownership from official department pages.*

**Evanston (Catalis/QScend):** evanstonil.qscend.com/311/request/add — **live form read verbatim 2026-07-17**; 17 department groups + request types + field set (location-first, type, comments, up to 5 photos, optional/anonymous contact). cityofevanston.org 311 pages; data.cityofevanston.org (311 dataset, now on ArcGIS Hub — legacy API dead).

**Reference:** data.cityofchicago.org (311 Service Requests — 110 live `SR_TYPE` values); civicplus.help/seeclickfix (default categories by department); wiki.open311.org GeoReport v2 + Service Definition Attributes (datatypes, `required`, `media_url`); NYC/Boston 311 for volume signal.
