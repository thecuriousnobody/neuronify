// Per-category form schemas — one FormDefinition per taxonomy category. Once the
// triage turn LOCKS a category (see ./triage), the conversation loads that
// category's form and collects exactly its fields.
//
// Every form shares a BASE (location + description, then a photo where it
// matters) and adds its own category-specific fields, each carrying
// plain-language guidance in `prompt` — the point of the build: the department
// receives a complete, actionable report. Sourced from the proposal's field
// schemas (docs/intake-taxonomy-proposal.md §3). Pure data — the seed script
// (scripts/seed-taxonomy-forms.ts) writes these into nf_form_definitions.
//
// These field specifics are the part Blake's clarifications tune; because it's
// data, an added/removed field or a reworded choice is a one-line edit here.

import type { FormDefinition, FormField } from '../domain/types';
import { CATEGORIES, departmentFor, departmentFlowKey, type CategoryKey } from './taxonomy';

/** The template city these schemas are authored for. */
export const TEMPLATE_FORM_CITY = 'Peoria, IL';

/** Categories where a crew must see the condition before dispatch → photo required. */
const PHOTO_REQUIRED = new Set<CategoryKey>([
  'pothole',
  'graffiti',
  'illegal_dumping',
  'sidewalk_damage',
  'tall_grass_weeds',
  'property_maintenance',
  'abandoned_vehicle',
  'vacant_abandoned_property',
]);

/** Categories where a photo makes no sense (no attachment field at all). */
const NO_PHOTO = new Set<CategoryKey>(['noise_complaint', 'other_inquiry']);

/** The stable form key for a category, e.g. "pothole" → "pothole_report". */
export function categoryFormKey(category: CategoryKey): string {
  return `${category}_report`;
}

// Category-specific fields (beyond the shared base). Choice values are the
// human-readable strings the resident's words get mapped onto.
const EXTRA: Partial<Record<CategoryKey, FormField[]>> = {
  pothole: [
    { key: 'road_position', label: 'Where on the road?', type: 'choice', required: true, choices: ['travel lane', 'curb or edge', 'intersection', 'alley'] },
    { key: 'size', label: 'Roughly how big?', type: 'choice', required: true, choices: ['small', 'medium', 'large'], prompt: 'small = smaller than a dinner plate; medium = dinner-plate to car-tire; large = bigger than a car tire or spans the lane' },
    { key: 'hazard', label: 'Is it a safety hazard?', type: 'boolean', required: true, prompt: 'whether it’s dangerous to drive or walk over' },
  ],
  graffiti: [
    { key: 'surface', label: 'What’s it on?', type: 'choice', required: true, choices: ['building', 'fence', 'sidewalk or pavement', 'sign', 'utility box', 'underpass', 'other'] },
    { key: 'property', label: 'Public or private property?', type: 'choice', required: true, choices: ['public', 'private'] },
    { key: 'offensive', label: 'Offensive content?', type: 'boolean', required: false, prompt: 'whether it contains hate speech or offensive content (can raise priority)' },
  ],
  illegal_dumping: [
    { key: 'material', label: 'What was dumped?', type: 'choice', required: true, choices: ['household trash', 'construction debris', 'tires', 'appliances', 'furniture', 'hazardous or chemical'], prompt: 'pick the main type' },
    { key: 'volume', label: 'How much?', type: 'choice', required: true, choices: ['a few items', 'a pickup-truck load', 'more than that'] },
    { key: 'on_property', label: 'Where is it?', type: 'choice', required: true, choices: ['public land or right-of-way', 'private property'] },
  ],
  tree_issue: [
    { key: 'ownership', label: 'Where is the tree?', type: 'choice', required: true, choices: ['parkway (between sidewalk and street)', 'in a park', 'on private property'], prompt: 'the city handles public parkway and park trees; private-property trees are the owner’s responsibility' },
    { key: 'problem', label: 'What’s the problem?', type: 'choice', required: true, choices: ['fallen tree or limb blocking', 'dead or dying', 'needs trimming', 'debris to clear'] },
    { key: 'on_wires', label: 'Touching power lines?', type: 'boolean', required: false, prompt: 'whether it’s touching or hanging on power lines (safety escalation)' },
  ],
  street_light: [
    { key: 'pole_id', label: 'Pole number', type: 'text', required: false, prompt: 'the number on the pole tag, if you can see it' },
    { key: 'failure', label: 'What’s it doing?', type: 'choice', required: true, choices: ['fully out', 'on during the day', 'flickering'] },
  ],
  sidewalk_damage: [
    { key: 'problem', label: 'What’s wrong?', type: 'choice', required: true, choices: ['cracked or heaved', 'missing section', 'trip hazard', 'obstruction blocking the path'] },
  ],
  traffic_sign_signal: [
    { key: 'kind', label: 'Signal or sign?', type: 'choice', required: true, choices: ['signal fully out', 'signal malfunctioning', 'sign knocked down', 'sign missing or faded'] },
  ],
  snow_ice: [
    { key: 'where', label: 'Where?', type: 'choice', required: true, choices: ['street not plowed', 'sidewalk not cleared', 'bike lane', 'intersection'] },
  ],
  missed_collection: [
    { key: 'stream', label: 'Which pickup?', type: 'choice', required: true, choices: ['garbage', 'recycling', 'yard waste'] },
    { key: 'set_out_on_time', label: 'Out on time?', type: 'boolean', required: true, prompt: 'whether it was out by the collection deadline' },
    { key: 'collection_day', label: 'Your collection day', type: 'text', required: false, prompt: 'your normal collection day, if you know it' },
  ],
  cart_issue: [
    { key: 'cart', label: 'Which cart?', type: 'choice', required: true, choices: ['garbage', 'recycling', 'yard waste'] },
    { key: 'request', label: 'What do you need?', type: 'choice', required: true, choices: ['damaged', 'missing or stolen', 'new or additional', 'resize'] },
  ],
  rodent_pest: [
    { key: 'pest', label: 'What kind?', type: 'choice', required: true, choices: ['rats or mice', 'insects', 'mosquitoes', 'bees or wasps', 'other'] },
    { key: 'where', label: 'Where?', type: 'choice', required: true, choices: ['inside a building', 'outside or yard', 'alley'] },
  ],
  dead_animal: [
    { key: 'animal', label: 'What animal?', type: 'choice', required: true, choices: ['domestic pet', 'wild or other', 'rodent'] },
    { key: 'on_property', label: 'Where is it?', type: 'choice', required: true, choices: ['public roadway or right-of-way', 'private property'] },
  ],
  animal_concern: [
    { key: 'situation', label: 'What’s happening?', type: 'choice', required: true, choices: ['stray', 'injured', 'aggressive or dangerous', 'too many or nuisance'] },
    { key: 'kind', label: 'Domestic or wild?', type: 'choice', required: true, choices: ['domestic', 'wild'] },
  ],
  tall_grass_weeds: [
    { key: 'condition', label: 'What’s the condition?', type: 'choice', required: true, choices: ['tall grass or weeds', 'general overgrowth'], prompt: 'the city acts on grass over about 10 inches' },
  ],
  property_maintenance: [
    { key: 'issue', label: 'What’s the problem?', type: 'choice', required: true, choices: ['peeling paint', 'damaged siding', 'damaged gutters', 'rotting wood', 'boarded windows or doors', 'broken fence', 'damaged roof', 'other'] },
    { key: 'occupied', label: 'Is it occupied?', type: 'choice', required: true, choices: ['occupied', 'vacant', 'unknown'] },
  ],
  vacant_abandoned_property: [
    { key: 'kind', label: 'Building or lot?', type: 'choice', required: true, choices: ['building', 'vacant lot'] },
    { key: 'condition', label: 'Condition?', type: 'choice', required: true, choices: ['open or unsecured', 'overgrown', 'fire-damaged', 'other'] },
  ],
  water_sewer: [
    { key: 'problem', label: 'What’s wrong?', type: 'choice', required: true, choices: ['no water', 'low pressure', 'main break or water in the street', 'sewer backup', 'odor', 'discoloration or quality'] },
  ],
  flooding_drainage: [
    { key: 'problem', label: 'What’s happening?', type: 'choice', required: true, choices: ['standing water in the street', 'clogged catch basin', 'basement or property flooding'] },
  ],
  noise_complaint: [
    { key: 'source', label: 'Source of the noise?', type: 'choice', required: true, choices: ['residential', 'commercial', 'vehicle', 'construction', 'amplified music or event'] },
    { key: 'timing', label: 'Now or recurring?', type: 'choice', required: true, choices: ['happening now', 'recurring'] },
  ],
  park_maintenance: [
    { key: 'park', label: 'Which park?', type: 'text', required: true, prompt: 'the name of the park' },
    { key: 'issue', label: 'What needs attention?', type: 'choice', required: true, choices: ['damaged equipment', 'restroom', 'lighting', 'landscaping', 'water fountain'] },
  ],
  other_inquiry: [
    { key: 'suggested_department', label: 'Who might handle this?', type: 'text', required: false, prompt: 'the department or person you think should handle it, if you know' },
  ],
};

function buildForm(category: CategoryKey): FormDefinition {
  const label = CATEGORIES.find((c) => c.key === category)?.label ?? category;
  const fields: FormField[] = [];

  // Base: location (asked early, as the real 311s do) then description. The
  // catch-all is location-free — it may not be about a place.
  if (category !== 'other_inquiry') {
    fields.push({
      key: 'location',
      label: 'Where is it?',
      type: 'location',
      required: true,
      prompt: 'the street address or nearest cross-street or landmark',
    });
  }
  fields.push({
    key: 'description',
    label: 'What’s going on?',
    type: 'longtext',
    required: true,
    prompt: 'what the problem is and what it’s affecting',
  });

  fields.push(...(EXTRA[category] ?? []));

  if (!NO_PHOTO.has(category)) {
    fields.push({
      key: 'photo',
      label: 'A photo',
      type: 'attachment',
      required: PHOTO_REQUIRED.has(category),
      requiresAttachment: true,
      prompt: 'a photo of the issue',
    });
  }

  return {
    id: `form-${category}`,
    key: categoryFormKey(category),
    title: label,
    city: TEMPLATE_FORM_CITY,
    version: 1,
    // Flows are keyed by DEPARTMENT, not category: the flow a report runs is a
    // property of who owns it, and a step's approver is baked into the
    // definition, so one flow can't serve two departments. See ./flows.
    workflowKey: departmentFlowKey(departmentFor(TEMPLATE_FORM_CITY, category)),
    fields,
  };
}

/** Every category's form, keyed by category. The engine's source of truth. */
export const CATEGORY_FORMS: Record<CategoryKey, FormDefinition> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, buildForm(c.key)]),
) as Record<CategoryKey, FormDefinition>;

/** The form for a category. */
export function formForCategory(category: CategoryKey): FormDefinition {
  return CATEGORY_FORMS[category];
}

/** All category forms as a flat list (for seeding). */
export function allCategoryForms(): FormDefinition[] {
  return Object.values(CATEGORY_FORMS);
}
