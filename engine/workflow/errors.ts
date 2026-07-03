// Domain errors raised by workflow commands. Each carries a stable `code` the
// app layer can map to an HTTP status or a user-facing message. Commands throw
// these instead of returning; a thrown command produces NO events (fail closed).

export type WorkflowErrorCode =
  | 'FORM_NOT_FOUND'
  | 'WORKFLOW_DEF_NOT_FOUND'
  | 'SUBMISSION_NOT_FOUND'
  | 'INSTANCE_NOT_FOUND'
  | 'WORKFLOW_NOT_OPEN'
  | 'STEP_NOT_FOUND'
  | 'STEP_NOT_OPEN'
  | 'APPROVER_NOT_ON_STEP'
  | 'APPROVAL_NOT_PENDING'
  | 'REASON_REQUIRED'
  | 'RESUBMIT_SCOPE_REQUIRED'
  | 'RESUBMIT_SCOPE_OUT_OF_BOUNDS'
  | 'APPROVAL_NOT_AWAITING_RESUBMIT'
  // — graph (v2) —
  | 'GRAPH_INVALID' // malformed graph: dangling edge, no single entry, cycle, empty approval
  | 'GRAPH_BRANCHING_NOT_SUPPORTED' // condition/fan-out node — arrives with scenario B
  | 'GRAPH_SNAPSHOT_MISSING'; // a workflow.opened event with no frozen graph (pre-v2 log)

export class WorkflowError extends Error {
  constructor(public readonly code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export const fail = (code: WorkflowErrorCode, message: string): never => {
  throw new WorkflowError(code, message);
};
