// The reducer: fold the append-only audit log into the current workflow state.
//
// deriveInstance is a pure function of (events, definition). It NEVER mutates
// the events. Every command result is just more events appended to the log;
// re-deriving reflects them. This is what makes the audit trail authoritative
// and re-submits non-destructive — state is a view, the log is the truth.

import type {
  ApprovalStatus,
  AuditEvent,
  StepState,
  WorkflowDefinition,
  WorkflowInstance,
} from '../domain/types';

function freshSteps(def: WorkflowDefinition): StepState[] {
  return def.steps.map((s) => ({
    stepKey: s.key,
    status: 'not_started' as const,
    approvals: s.approvals.map((a) => ({
      approver: a.approver,
      scope: [...a.scope],
      status: 'pending' as ApprovalStatus, // becomes active only once the step opens
      loops: 0,
    })),
  }));
}

/** Returns null if the log contains no `workflow.opened` event yet. */
export function deriveInstance(
  events: AuditEvent[],
  def: WorkflowDefinition,
): WorkflowInstance | null {
  const opened = events.find((e) => e.type === 'workflow.opened');
  if (!opened) return null;

  const instance: WorkflowInstance = {
    id: opened.workflowInstanceId ?? '',
    submissionId: opened.submissionId,
    workflowKey: def.key,
    workflowVersion: def.version,
    status: 'open',
    openedAt: opened.at,
    steps: freshSteps(def),
  };

  for (const e of events) applyEvent(instance, e);
  return instance;
}

function applyEvent(inst: WorkflowInstance, e: AuditEvent): void {
  const p = e.payload as Record<string, unknown>;
  const findStep = (key: unknown) => inst.steps.find((s) => s.stepKey === key);

  switch (e.type) {
    case 'step.opened': {
      const st = findStep(p.stepKey);
      if (st) {
        st.status = 'open';
        st.openedAt = e.at;
      }
      break;
    }
    case 'decision.recorded': {
      const st = findStep(p.stepKey);
      const ap = st?.approvals.find((a) => a.approver === p.approver);
      if (!ap) break;
      ap.decidedAt = e.at;
      const decision = p.decision as string;
      if (decision === 'approved') {
        ap.status = 'approved';
        ap.reason = p.reason as string | undefined; // optional "what work was completed?" note
        ap.resubmitScope = undefined;
      } else if (decision === 'denied') {
        ap.status = 'denied';
        ap.reason = p.reason as string | undefined;
      } else if (decision === 'requires_resubmit') {
        ap.status = 'awaiting_resubmit';
        ap.resubmitScope = p.resubmitScope as string[] | undefined;
        ap.reason = p.reason as string | undefined;
      }
      break;
    }
    case 'resubmit.fulfilled': {
      const st = findStep(p.stepKey);
      const ap = st?.approvals.find((a) => a.approver === p.approver);
      if (!ap) break;
      ap.status = 'pending'; // back to the department for re-review (captured once: only this one)
      ap.loops += 1;
      ap.resubmitScope = undefined;
      break;
    }
    case 'approval.reassigned': {
      // Staff handed this step's sign-off to a different department. The frozen
      // graph is untouched (immutable) — we only re-point the DERIVED approval and
      // reset it so the new owner reviews afresh. Same scope (same fields, new owner).
      const st = findStep(p.stepKey);
      const ap = st?.approvals.find((a) => a.approver === p.fromApprover);
      if (!ap) break;
      ap.approver = p.toApprover as string;
      ap.status = 'pending';
      ap.reason = undefined;
      ap.resubmitScope = undefined;
      ap.decidedAt = undefined;
      break;
    }
    case 'step.closed': {
      const st = findStep(p.stepKey);
      if (st) {
        st.status = 'closed';
        st.closedAt = e.at;
      }
      break;
    }
    case 'workflow.closed': {
      inst.status = p.status as WorkflowInstance['status'];
      inst.closedAt = e.at;
      if (p.status === 'denied' && p.stepKey) {
        const st = findStep(p.stepKey);
        if (st) {
          st.status = 'denied';
          st.closedAt = e.at;
        }
      }
      break;
    }
    // submission.created / workflow.opened / communication.sent: no state change here
  }
}
