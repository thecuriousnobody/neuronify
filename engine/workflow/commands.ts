// Workflow commands — pure functions that VALIDATE an action and emit the
// resulting append-only events + communication intents. They perform NO I/O:
// the app's use-case layer persists the events (Repository.appendEvents) and
// delivers the comms (Notifier.send). Keeping them pure makes the entire state
// machine unit-testable with a fake clock and a seq id generator.
//
// Invariant this file enforces (the sketch, made executable):
//   • steps are sequential — you can only act on the one `open` step;
//   • a step is a parallel AND-gate — it closes only when EVERY approval is
//     approved, and only then does the next step open;
//   • approvals are portion-locked & captured once — an approved approval can't
//     be re-decided; a resubmit can only target fields in that approval's scope;
//   • denial is terminal and requires a reason;
//   • every outcome relays a communication to the submitter.

import type {
  AuditEvent,
  AuditEventType,
  ActorSide,
  CommunicationIntent,
  CommunicationReason,
  DecisionInput,
  Submission,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
} from '../domain/types';
import type { Clock, IdGenerator } from '../ports';
import { fail } from './errors';

export interface CommandCtx {
  clock: Clock;
  ids: IdGenerator;
}

export interface CommandResult {
  events: AuditEvent[];
  communications: CommunicationIntent[];
}

// ── internal builders ───────────────────────────────────────────────────────

interface EventDraft {
  submissionId: string;
  workflowInstanceId?: string;
  type: AuditEventType;
  actor: string;
  actorSide: ActorSide;
  payload: Record<string, unknown>;
}

function event(ctx: CommandCtx, d: EventDraft): AuditEvent {
  return { id: ctx.ids.next(), at: ctx.clock.now(), ...d };
}

/** step.opened carries its approvals so the log is self-describing (timing reads it). */
function stepOpenedPayload(step: WorkflowStep): Record<string, unknown> {
  return {
    stepKey: step.key,
    approvals: step.approvals.map((a) => ({ approver: a.approver, scope: a.scope })),
  };
}

/** Build a comm intent + its audit event together; push to the given arrays. */
function relay(
  ctx: CommandCtx,
  inst: { id: string; submissionId: string },
  reason: CommunicationReason,
  message: string,
  out: CommandResult,
): void {
  out.communications.push({ submissionId: inst.submissionId, to: 'submitter', reason, message });
  out.events.push(
    event(ctx, {
      submissionId: inst.submissionId,
      workflowInstanceId: inst.id,
      type: 'communication.sent',
      actor: 'system',
      actorSide: 'system',
      payload: { reason, message },
    }),
  );
}

// ── commands ────────────────────────────────────────────────────────────────

/**
 * Open the workflow for a freshly verified submission. Emits workflow.opened,
 * opens the first step, and relays a "we received it" note. Returns the new
 * instance id alongside the events so the caller can key future commands.
 */
export function startWorkflow(
  submission: Submission,
  def: WorkflowDefinition,
  ctx: CommandCtx,
): CommandResult & { instanceId: string } {
  const instanceId = ctx.ids.next();
  const inst = { id: instanceId, submissionId: submission.id };
  const out: CommandResult = { events: [], communications: [] };

  out.events.push(
    event(ctx, {
      submissionId: submission.id,
      workflowInstanceId: instanceId,
      type: 'workflow.opened',
      actor: 'system',
      actorSide: 'system',
      payload: { workflowKey: def.key, workflowVersion: def.version },
    }),
  );

  const first = def.steps[0];
  if (first) {
    out.events.push(
      event(ctx, {
        submissionId: submission.id,
        workflowInstanceId: instanceId,
        type: 'step.opened',
        actor: 'system',
        actorSide: 'system',
        payload: stepOpenedPayload(first),
      }),
    );
  }

  relay(ctx, inst, 'submitted', `We received your ${submission.formKey} and started review.`, out);
  return { ...out, instanceId };
}

/**
 * Record one department's decision on its portion of the current open step.
 * Advances the workflow (closes the step / opens the next / completes / denies)
 * as the gate dictates.
 */
export function decide(
  instance: WorkflowInstance,
  def: WorkflowDefinition,
  input: DecisionInput,
  ctx: CommandCtx,
): CommandResult {
  if (instance.status !== 'open') fail('WORKFLOW_NOT_OPEN', `workflow is ${instance.status}`);

  const stepDef = def.steps.find((s) => s.key === input.stepKey);
  if (!stepDef) fail('STEP_NOT_FOUND', `no step "${input.stepKey}"`);

  const stepState = instance.steps.find((s) => s.stepKey === input.stepKey)!;
  if (stepState.status !== 'open')
    fail('STEP_NOT_OPEN', `step "${input.stepKey}" is ${stepState.status} (steps are sequential)`);

  const approval = stepState.approvals.find((a) => a.approver === input.approver);
  if (!approval) fail('APPROVER_NOT_ON_STEP', `"${input.approver}" is not an approver on this step`);
  if (approval!.status !== 'pending')
    fail('APPROVAL_NOT_PENDING', `"${input.approver}" is already ${approval!.status} (captured once)`);

  const inst = { id: instance.id, submissionId: instance.submissionId };
  const out: CommandResult = { events: [], communications: [] };
  const base = { submissionId: instance.submissionId, workflowInstanceId: instance.id };

  // ── DENIED — terminal, reason mandatory ──
  if (input.decision === 'denied') {
    const reason = (input.reason ?? '').trim();
    if (!reason) fail('REASON_REQUIRED', 'a denial requires a reason');
    out.events.push(
      event(ctx, {
        ...base,
        type: 'decision.recorded',
        actor: input.approver,
        actorSide: 'internal',
        payload: { stepKey: input.stepKey, approver: input.approver, decision: 'denied', reason },
      }),
    );
    out.events.push(
      event(ctx, {
        ...base,
        type: 'workflow.closed',
        actor: 'system',
        actorSide: 'system',
        payload: { status: 'denied', stepKey: input.stepKey },
      }),
    );
    relay(ctx, inst, 'denied', `Your submission was not approved. Reason: ${reason}`, out);
    return out;
  }

  // ── REQUIRES RESUBMIT — bounce this portion only ──
  if (input.decision === 'requires_resubmit') {
    const scope = input.resubmitScope ?? [];
    if (scope.length === 0)
      fail('RESUBMIT_SCOPE_REQUIRED', 'a resubmit request must name which fields to redo');
    const outOfBounds = scope.filter((f) => !approval!.scope.includes(f));
    if (outOfBounds.length)
      fail(
        'RESUBMIT_SCOPE_OUT_OF_BOUNDS',
        `"${input.approver}" can only request resubmit on its own fields; not: ${outOfBounds.join(', ')}`,
      );
    out.events.push(
      event(ctx, {
        ...base,
        type: 'decision.recorded',
        actor: input.approver,
        actorSide: 'internal',
        payload: {
          stepKey: input.stepKey,
          approver: input.approver,
          decision: 'requires_resubmit',
          resubmitScope: scope,
          reason: input.reason,
        },
      }),
    );
    const what = scope.join(', ');
    relay(ctx, inst, 'requires_resubmit', `Please update the following and resubmit: ${what}.`, out);
    return out;
  }

  // ── APPROVED — may close the step and advance ──
  out.events.push(
    event(ctx, {
      ...base,
      type: 'decision.recorded',
      actor: input.approver,
      actorSide: 'internal',
      payload: { stepKey: input.stepKey, approver: input.approver, decision: 'approved' },
    }),
  );

  // Does approving this make ALL approvals on the step approved? (the AND-gate)
  const allApproved = stepState.approvals.every((a) =>
    a.approver === input.approver ? true : a.status === 'approved',
  );

  if (allApproved) {
    out.events.push(
      event(ctx, { ...base, type: 'step.closed', actor: 'system', actorSide: 'system', payload: { stepKey: input.stepKey } }),
    );
    const idx = def.steps.findIndex((s) => s.key === input.stepKey);
    const next = def.steps[idx + 1];
    if (next) {
      out.events.push(
        event(ctx, { ...base, type: 'step.opened', actor: 'system', actorSide: 'system', payload: stepOpenedPayload(next) }),
      );
      // One message per closed step/box — the "happy medium" cadence.
      relay(ctx, inst, 'step_completed', `Update: "${stepDef!.title}" is complete. Your request is now with "${next.title}".`, out);
    } else {
      out.events.push(
        event(ctx, { ...base, type: 'workflow.closed', actor: 'system', actorSide: 'system', payload: { status: 'completed' } }),
      );
      relay(ctx, inst, 'completed', 'Your submission has completed all reviews.', out);
    }
  }

  return out;
}

/**
 * The citizen returns the bounced portion. Flips ONLY that department's approval
 * back to pending for re-review; all other approvals stay locked.
 */
export function fulfillResubmit(
  instance: WorkflowInstance,
  input: { stepKey: string; approver: string; actor?: string },
  ctx: CommandCtx,
): CommandResult {
  if (instance.status !== 'open') fail('WORKFLOW_NOT_OPEN', `workflow is ${instance.status}`);

  const stepState = instance.steps.find((s) => s.stepKey === input.stepKey);
  if (!stepState) fail('STEP_NOT_FOUND', `no step "${input.stepKey}"`);
  if (stepState!.status !== 'open') fail('STEP_NOT_OPEN', `step "${input.stepKey}" is ${stepState!.status}`);

  const approval = stepState!.approvals.find((a) => a.approver === input.approver);
  if (!approval) fail('APPROVER_NOT_ON_STEP', `"${input.approver}" is not an approver on this step`);
  if (approval!.status !== 'awaiting_resubmit')
    fail('APPROVAL_NOT_AWAITING_RESUBMIT', `"${input.approver}" is not awaiting a resubmit`);

  return {
    events: [
      event(ctx, {
        submissionId: instance.submissionId,
        workflowInstanceId: instance.id,
        type: 'resubmit.fulfilled',
        actor: input.actor ?? 'citizen',
        actorSide: 'external',
        payload: { stepKey: input.stepKey, approver: input.approver },
      }),
    ],
    communications: [],
  };
}
