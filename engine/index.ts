// Neuronify engine — public surface.
//
// The app imports from here (and only here). Internal modules can deep-import
// each other, but `app/` should treat this barrel as the contract.

export * from './domain/types';
export * from './domain/graph';
export * from './ports';

// Workflow engine
export { startWorkflow, decide, fulfillResubmit } from './workflow/commands';
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
  recordRevisionAndResubmit,
  loadInstance,
  getInstanceView,
  deskQueue,
  deskSubmissionDetail,
  deskDecide,
  computeMetrics,
} from './workflow/service';
export type {
  LoadedInstance,
  InstanceView,
  QueueItem,
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
