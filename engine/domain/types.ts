// Neuronify engine — domain vocabulary.
//
// Types only, no behavior. These names map 1:1 to the founding sketch; the
// comments cite the sketch so the model stays honest to the original intent.
// See ../README.md for the boundary rule.

// ────────────────────────────────────────────────────────────────────────────
// Definitions — authored once, versioned. The templates the runtime instances.
// ────────────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'location'
  | 'date'
  | 'attachment';

/** One field on a form. Drives both the intake conversation and validation. */
export interface FormField {
  /** Stable machine key, e.g. "location". Referenced by step scopes. */
  key: string;
  /** Human label, e.g. "Where is the pothole?" */
  label: string;
  type: FieldType;
  required: boolean;
  /** How the voice agent should ask for this, if different from `label`. */
  prompt?: string;
  /** Allowed values when `type === 'choice'`. */
  choices?: string[];
  /** This field is not satisfied until an attachment is present. */
  requiresAttachment?: boolean;
}

/** A form template, e.g. "Pothole Report". `VOICE → FORM FIELDS`. */
export interface FormDefinition {
  id: string;
  /** e.g. "pothole_report" */
  key: string;
  title: string;
  city: string;
  fields: FormField[];
  /** Which workflow opens when a submission of this form is verified. */
  workflowKey: string;
  version: number;
}

/**
 * One departmental sign-off required within a step. Several of these on one
 * step = "parallel approvals" (sketch): the departments act concurrently, each
 * owning its own portion of the fields.
 */
export interface StepApproval {
  /** The department / role that must sign off, e.g. "public_works", "fire". */
  approver: string;
  /**
   * The form-field keys this department reviews and signs off on — its portion.
   * A re-submit this department requests can only target fields in this scope.
   * That is what keeps approvals portion-locked: this department can bounce its
   * slice while every other department's approval stays frozen. (sketch)
   */
  scope: string[];
}

/**
 * A step in the workflow. Steps are SEQUENTIAL (see WorkflowDefinition.steps
 * order). A step is a parallel AND-gate: it holds one or more departmental
 * `approvals` that run concurrently, and it CLOSES only when EVERY approval has
 * reached `approved`. Any single approval can mark `requires_resubmit` and send
 * its portion back to the citizen; the other approvals remain locked, but the
 * step does not advance — and the next step does not open — until the bounced
 * portion returns and is approved. (sketch: parallel approvals + loop, gated)
 */
export interface WorkflowStep {
  /** e.g. "departmental_review" */
  key: string;
  title: string;
  /** The departmental sign-offs required here. All must approve to advance. */
  approvals: StepApproval[];
  /** Fields that must be present/non-empty for this step to be decidable. */
  requiresFields?: string[];
  /** Attachment field keys this step requires before it can advance. */
  requiresAttachments?: string[];
}

/**
 * A workflow template. `steps` are executed STRICTLY IN ARRAY ORDER — step N+1
 * does not open until step N has fully closed (all its approvals approved).
 */
export interface WorkflowDefinition {
  id: string;
  key: string;
  title: string;
  steps: WorkflowStep[];
  version: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Records — the Record of Truth. Created at human verify-and-submit. The values
// are versioned by appended audit events; the row itself is never rewritten.
// ────────────────────────────────────────────────────────────────────────────

export type FieldValuePrimitive = string | number | boolean | null;

export interface FieldValue {
  fieldKey: string;
  value: FieldValuePrimitive;
  /** Ids of attachments satisfying this field, if any. */
  attachmentIds?: string[];
}

/**
 * The Record of Truth root. Its creation timestamp is when the audit trail
 * begins. `values` is the materialized latest version of every field; the
 * authoritative history lives in the audit log.
 */
export interface Submission {
  id: string;
  formKey: string;
  formVersion: number;
  city: string;
  /** ISO. The moment of human verify-and-submit — audit trail begins here. */
  submittedAt: string;
  values: FieldValue[];
  source: 'voice' | 'text';
}

// ────────────────────────────────────────────────────────────────────────────
// Workflow runtime — the live state of one submission moving through one
// workflow. State is a fold over the append-only audit log.
// ────────────────────────────────────────────────────────────────────────────

/** A single department's verdict. (sketch: the three outcomes) */
export type StepDecision =
  | 'approved' // approved / completed
  | 'denied' // denied / not present — TERMINAL, requires a reason
  | 'requires_resubmit'; // bounce a portion back to the citizen

/** The input a department submits when it decides on its portion. */
export interface DecisionInput {
  stepKey: string;
  approver: string;
  decision: StepDecision;
  /** REQUIRED when decision is 'denied'; an optional note otherwise. */
  reason?: string;
  /**
   * For 'requires_resubmit': the field keys (⊆ this department's scope) the
   * citizen must redo. Only this portion loops; everything else stays put.
   */
  resubmitScope?: string[];
}

/** Per-department status within a step — the unit that locks "captured once". */
export type ApprovalStatus =
  | 'pending' // awaiting this department — time here is INTERNAL (city)
  | 'approved' // locked; will not re-run
  | 'awaiting_resubmit' // bounced its portion — time here is EXTERNAL (citizen)
  | 'denied'; // terminal-negative; carries a required reason

/** Derived state of one department's sign-off within a step. */
export interface ApprovalState {
  approver: string;
  scope: string[];
  status: ApprovalStatus;
  /** Reason — present (and required) when status is 'denied'; else optional note. */
  reason?: string;
  /** When awaiting_resubmit: the portion (⊆ scope) the citizen must redo. */
  resubmitScope?: string[];
  /** How many resubmit cycles this department has driven. */
  loops: number;
  /** ISO of this department's latest verdict. */
  decidedAt?: string;
}

export type StepStatus =
  | 'not_started' // an earlier step is still open — sequential gate
  | 'open' // currently accepting departmental decisions
  | 'closed' // every approval approved — workflow advanced past it
  | 'denied'; // a department denied — terminal

export interface StepState {
  stepKey: string;
  status: StepStatus;
  /** One per departmental sign-off the step requires. */
  approvals: ApprovalState[];
  /** ISO — when this step opened. */
  openedAt?: string;
  /** ISO — when it reached a terminal status (closed/denied). */
  closedAt?: string;
}

export type WorkflowStatus = 'open' | 'completed' | 'denied';

export interface WorkflowInstance {
  id: string;
  submissionId: string;
  workflowKey: string;
  workflowVersion: number;
  status: WorkflowStatus;
  steps: StepState[];
  openedAt: string;
  closedAt?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// The audit ledger — append-only spine. Every state change is one event.
// `actorSide` is recorded so `timing` can split external vs internal time.
// ────────────────────────────────────────────────────────────────────────────

export type ActorSide = 'external' | 'internal' | 'system';

export type AuditEventType =
  | 'submission.created'
  | 'workflow.opened'
  | 'step.opened'
  | 'decision.recorded'
  | 'resubmit.requested'
  | 'resubmit.fulfilled'
  | 'step.closed'
  | 'workflow.closed'
  | 'communication.sent';

/** Immutable. Re-submits APPEND new events; nothing here is ever updated. */
export interface AuditEvent {
  id: string;
  submissionId: string;
  workflowInstanceId?: string;
  type: AuditEventType;
  /** Citizen id, approver id, or "system". */
  actor: string;
  /** Which side acted — the basis for external/internal timing. */
  actorSide: ActorSide;
  /** ISO, from the Clock port. */
  at: string;
  payload: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Communications — the relay. The engine never DOES the work; on every outcome
// it emits an intent and the app's Notifier adapter delivers it.
// ────────────────────────────────────────────────────────────────────────────

// Communication cadence (the "happy medium"): one message when the submission
// is received, one each time a whole step/box closes and hands off to the next,
// one on the terminal outcome (completed/denied), plus the resubmit ask (which
// must go out immediately since the citizen has to act). NOT one per department.
export type CommunicationReason =
  | 'submitted' // received
  | 'step_completed' // a whole review step closed; handing off to the next
  | 'requires_resubmit' // citizen must redo a portion — sent immediately
  | 'denied' // terminal
  | 'completed'; // terminal

export interface CommunicationIntent {
  submissionId: string;
  to: 'submitter';
  reason: CommunicationReason;
  message: string;
}
