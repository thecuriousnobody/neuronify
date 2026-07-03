// Map engine domain errors to HTTP responses for the v2 API routes. Unknown
// errors are logged and returned as a sanitized 500 (don't leak internals).

import { WorkflowError, type WorkflowErrorCode } from '@/engine';

const STATUS: Record<WorkflowErrorCode, number> = {
  FORM_NOT_FOUND: 404,
  WORKFLOW_DEF_NOT_FOUND: 404,
  SUBMISSION_NOT_FOUND: 404,
  INSTANCE_NOT_FOUND: 404,
  STEP_NOT_FOUND: 404,
  WORKFLOW_NOT_OPEN: 409,
  STEP_NOT_OPEN: 409,
  APPROVAL_NOT_PENDING: 409,
  APPROVAL_NOT_AWAITING_RESUBMIT: 409,
  APPROVER_NOT_ON_STEP: 403,
  REASON_REQUIRED: 400,
  RESUBMIT_SCOPE_REQUIRED: 400,
  RESUBMIT_SCOPE_OUT_OF_BOUNDS: 400,
  // graph (v2): malformed input is a 400; the not-yet-supported branch is a 422.
  GRAPH_INVALID: 400,
  GRAPH_BRANCHING_NOT_SUPPORTED: 422,
  GRAPH_SNAPSHOT_MISSING: 409,
};

export function errorResponse(err: unknown): Response {
  if (err instanceof WorkflowError) {
    return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
  }
  console.error('[engine] unexpected error:', err);
  return Response.json({ error: 'Something went wrong on our end.' }, { status: 500 });
}
