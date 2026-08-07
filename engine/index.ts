// Neuronify engine — public surface.
//
// The app imports from here (and only here). Internal modules can deep-import
// each other, but `app/` should treat this barrel as the contract.

export * from './domain/types';
export * from './domain/graph';
export * from './ports';

// Workflow engine
export { startWorkflow, decide, fulfillResubmit, reassignApproval } from './workflow/commands';
export type { CommandCtx, CommandResult } from './workflow/commands';
export { deriveInstance } from './workflow/state';

// v2 graph: compose → freeze → derive-from-log
export { compileGraph, startGraphWorkflow, loadGraphFlow, deriveInstanceFromLog } from './workflow/graph';
export type { GraphFlow } from './workflow/graph';
export { WorkflowError } from './workflow/errors';
export type { WorkflowErrorCode } from './workflow/errors';

// Use-case / service layer (async orchestration over the ports)
export {
  submitForm,
  submitGraph,
  recordDecision,
  recordResubmit,
  recordReassignment,
  recordRevisionAndResubmit,
  loadInstance,
  getInstanceView,
  deskQueue,
  deskAllCases,
  deskSubmissionDetail,
  deskDecide,
  deskReassign,
  computeMetrics,
} from './workflow/service';
export type {
  LoadedInstance,
  InstanceView,
  QueueItem,
  CaseRow,
  DeskDetail,
  TimelineEntry,
  Metrics,
} from './workflow/service';

// Timing
export { computeTiming } from './timing/index';
export type { TimingReport, TimingBucket, ApprovalTiming } from './timing/index';

// Intake (voice→form conversation)
export { runIntakeTurn } from './intake/conversation';
export type { ChatMessage, ChatRole, IntakeTurn } from './intake/conversation';

// Category-first triage (discern the category before a form exists)
export { discernCategory } from './intake/triage';
export type { TriageTurn } from './intake/triage';

// Per-category form schemas (loaded once triage locks a category)
export {
  CATEGORY_FORMS,
  formForCategory,
  categoryFormKey,
  allCategoryForms,
  TEMPLATE_FORM_CITY,
} from './intake/forms';

// Digestion pipeline (single voice drop → fill → classify → compose)
export { digestDrop, extractFields, classify, SEVERITIES } from './intake/digest';
export type { DigestResult, Classification, Severity } from './intake/digest';

// Report taxonomy (discrete categories + per-city department map)
export {
  CATEGORIES,
  CITY_DEPARTMENTS,
  FALLBACK_CATEGORY,
  TEMPLATE_CITY,
  resolveCategory,
  departmentFor,
  departmentFlowKey,
  normalizeCity,
} from './intake/taxonomy';
export type { CategoryKey, CategoryDef, DepartmentKey } from './intake/taxonomy';

// Per-department workflows (the flow a report runs is a property of its owner)
export {
  buildDepartmentFlow,
  allDepartmentFlows,
  allDepartments,
  SAFETY_CRITICAL,
} from './intake/flows';
export type { FlowOptions } from './intake/flows';
export { composeGraph } from './intake/compose';
export type { ComposeOptions } from './intake/compose';
export { isAllowedAttachmentUrl, attachmentPathname, missingRequiredFields } from './intake/attachments';
export { prettyFormKey, prettyKey } from './intake/labels';
