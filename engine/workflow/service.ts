// The use-case layer: async orchestration over the ports. This is what the app
// calls. It is still framework-agnostic — it depends only on EngineEnv (ports)
// and the pure command/reducer functions, never on Next.js or a concrete DB.
//
// The shape of every mutating use-case is the same three beats:
//   1. load the event log and DERIVE current state,
//   2. run a PURE command (which validates and returns events + comms),
//   3. persist: append the events, then relay the comms.
// Nothing mutates state in place; state is always re-derived from the log.

import type {
  ApprovalStatus,
  AuditEvent,
  DecisionInput,
  FieldValue,
  FormDefinition,
  FormField,
  Submission,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStatus,
} from '../domain/types';
import type { WorkflowGraph } from '../domain/graph';
import type { EngineEnv } from '../ports';
import { computeTiming, type TimingReport } from '../timing/index';
import { decide, fulfillResubmit, reviseAndResubmit, startWorkflow, type CommandResult } from './commands';
import { compileGraph, startGraphWorkflow } from './graph';
import { deriveInstance } from './state';
import { fail } from './errors';

export interface LoadedInstance {
  submission: Submission;
  def: WorkflowDefinition;
  instance: WorkflowInstance;
  events: AuditEvent[];
}

export interface InstanceView extends LoadedInstance {
  timing: TimingReport;
}

/** Append events then relay comms. Order matters: durable record first. */
async function commit(env: EngineEnv, result: CommandResult): Promise<void> {
  await env.repo.appendEvents(result.events);
  for (const intent of result.communications) await env.notifier.send(intent);
}

/** Reconstruct a submission's workflow from its event log. */
export async function loadInstance(
  env: EngineEnv,
  submissionId: string,
): Promise<LoadedInstance | null> {
  const events = await env.repo.getEvents(submissionId);
  const opened = events.find((e) => e.type === 'workflow.opened');
  if (!opened) return null;

  const submission = await env.repo.getSubmission(submissionId);
  if (!submission) return null;

  const p = opened.payload as Record<string, unknown>;
  // v2: the composed graph is FROZEN in the opened event — compile it from the
  // log, no external definition to fetch. v1: fall back to the versioned def.
  const def = p.graph
    ? compileGraph(p.graph as WorkflowGraph)
    : await env.repo.getWorkflowDefinition(p.workflowKey as string, p.workflowVersion as number | undefined);
  if (!def) return null;

  const instance = deriveInstance(events, def);
  if (!instance) return null;
  return { submission, def, instance, events };
}

/**
 * The human-verify-and-submit moment: persist the Record of Truth and open its
 * workflow. The form definition names which workflow runs. Returns the new
 * submission + workflow instance ids.
 */
export async function submitForm(
  env: EngineEnv,
  input: Omit<Submission, 'id' | 'submittedAt' | 'formVersion'> & { formVersion?: number },
): Promise<{ submissionId: string; instanceId: string }> {
  const form: FormDefinition | null = await env.repo.getFormDefinition(input.formKey, input.formVersion);
  if (!form) fail('FORM_NOT_FOUND', `no form definition "${input.formKey}"`);

  const def = await env.repo.getWorkflowDefinition(form!.workflowKey);
  if (!def) fail('WORKFLOW_DEF_NOT_FOUND', `form "${input.formKey}" names missing workflow "${form!.workflowKey}"`);

  const submission: Submission = {
    id: env.ids.next(),
    formKey: form!.key,
    formVersion: form!.version,
    city: input.city,
    submittedAt: env.clock.now(),
    values: input.values,
    source: input.source,
  };
  await env.repo.saveSubmission(submission);

  const result = startWorkflow(submission, def!, env);
  await commit(env, result);
  return { submissionId: submission.id, instanceId: result.instanceId };
}

/**
 * v2 verify-and-submit: persist the Record of Truth and open a workflow from a
 * COMPOSED graph (agent-composed, staff-confirmed). The graph is frozen into the
 * log — nothing is fetched by key. Validates the graph compiles BEFORE writing
 * anything (fail closed: a bad graph never leaves a half-created submission).
 */
export async function submitGraph(
  env: EngineEnv,
  input: {
    formKey: string;
    formVersion?: number;
    city: string;
    source: Submission['source'];
    values: FieldValue[];
    graph: WorkflowGraph;
  },
): Promise<{ submissionId: string; instanceId: string }> {
  compileGraph(input.graph); // throws GRAPH_* before any persistence

  const submission: Submission = {
    id: env.ids.next(),
    formKey: input.formKey,
    formVersion: input.formVersion ?? 1,
    city: input.city,
    submittedAt: env.clock.now(),
    values: input.values,
    source: input.source,
  };
  await env.repo.saveSubmission(submission);

  const result = startGraphWorkflow(submission, input.graph, env);
  await commit(env, result);
  return { submissionId: submission.id, instanceId: result.instanceId };
}

/** A department records its decision on the current open step. */
export async function recordDecision(
  env: EngineEnv,
  submissionId: string,
  input: DecisionInput,
): Promise<void> {
  const loaded = await loadInstance(env, submissionId);
  if (!loaded) fail('INSTANCE_NOT_FOUND', `no workflow for submission "${submissionId}"`);
  await commit(env, decide(loaded!.instance, loaded!.def, input, env));
}

/** The citizen returns a bounced portion. */
export async function recordResubmit(
  env: EngineEnv,
  submissionId: string,
  input: { stepKey: string; approver: string; actor?: string },
): Promise<void> {
  const loaded = await loadInstance(env, submissionId);
  if (!loaded) fail('INSTANCE_NOT_FOUND', `no workflow for submission "${submissionId}"`);
  await commit(env, fulfillResubmit(loaded!.instance, input, env));
}

/**
 * The citizen edits the bounced fields and resubmits. Appends the revision +
 * resubmit events (append-only), then updates the materialized values. Ownership
 * (is this the citizen's submission?) is enforced by the caller in the app layer.
 */
export async function recordRevisionAndResubmit(
  env: EngineEnv,
  submissionId: string,
  newValues: FieldValue[],
): Promise<void> {
  const loaded = await loadInstance(env, submissionId);
  if (!loaded) fail('INSTANCE_NOT_FOUND', `no workflow for submission "${submissionId}"`);
  const result = reviseAndResubmit(loaded!.submission, loaded!.instance, { newValues }, env);
  await commit(env, result);
  await env.repo.updateSubmissionValues(submissionId, result.values);
}

/** Read model: current state + live timing (in-flight intervals banked to now). */
export async function getInstanceView(
  env: EngineEnv,
  submissionId: string,
): Promise<InstanceView | null> {
  const loaded = await loadInstance(env, submissionId);
  if (!loaded) return null;
  return { ...loaded, timing: computeTiming(loaded.events, env.clock.now()) };
}

// ── City-side approver console (Phase 4) ─────────────────────────────────────

export interface QueueItem {
  submissionId: string;
  formKey: string;
  city: string;
  submittedAt: string;
  stepKey: string;
  stepTitle: string;
  values: FieldValue[];
  /** The field keys this department signs off on. */
  myScope: string[];
  /** The other departments on this step and where they stand. */
  otherApprovals: { approver: string; status: ApprovalStatus }[];
  /** How long this department's sign-off has been pending (internal time). */
  waitingMs: number;
}

/**
 * The department's work queue: every open submission whose CURRENT step has a
 * pending approval for this department. Because steps are sequential and gated,
 * this is exactly "what is waiting on me right now". Derive-on-read — fine at
 * prototype scale; a materialized index is the future optimization.
 */
export async function deskQueue(env: EngineEnv, department: string): Promise<QueueItem[]> {
  const ids = await env.repo.listOpenSubmissionIds();
  const items: QueueItem[] = [];
  for (const id of ids) {
    const loaded = await loadInstance(env, id);
    if (!loaded) continue;
    const openStep = loaded.instance.steps.find((s) => s.status === 'open');
    if (!openStep) continue;
    const mine = openStep.approvals.find((a) => a.approver === department && a.status === 'pending');
    if (!mine) continue;
    const stepDef = loaded.def.steps.find((s) => s.key === openStep.stepKey);
    const timing = computeTiming(loaded.events, env.clock.now());
    items.push({
      submissionId: id,
      formKey: loaded.submission.formKey,
      city: loaded.submission.city,
      submittedAt: loaded.submission.submittedAt,
      stepKey: openStep.stepKey,
      stepTitle: stepDef?.title ?? openStep.stepKey,
      values: loaded.submission.values,
      myScope: mine.scope,
      otherApprovals: openStep.approvals
        .filter((a) => a.approver !== department)
        .map((a) => ({ approver: a.approver, status: a.status })),
      waitingMs: timing.byApproval[`${openStep.stepKey}::${department}`]?.internalMs ?? 0,
    });
  }
  return items;
}

export interface TimelineEntry {
  at: string;
  label: string;
}

function buildTimeline(events: AuditEvent[], def: WorkflowDefinition): TimelineEntry[] {
  const stepTitle = (key: unknown) => def.steps.find((s) => s.key === key)?.title ?? String(key);
  const out: TimelineEntry[] = [];
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'submission.created':
        out.push({ at: e.at, label: 'Submitted & verified by the resident' });
        break;
      case 'step.opened':
        out.push({ at: e.at, label: `${stepTitle(p.stepKey)} opened` });
        break;
      case 'decision.recorded': {
        const who = String(p.approver);
        if (p.decision === 'approved') out.push({ at: e.at, label: `${who} approved their portion` });
        else if (p.decision === 'denied')
          out.push({ at: e.at, label: `${who} denied — ${String(p.reason ?? '')}` });
        else if (p.decision === 'requires_resubmit')
          out.push({ at: e.at, label: `${who} requested a re-submit (${(p.resubmitScope as string[] | undefined)?.join(', ') ?? ''})` });
        break;
      }
      case 'resubmit.fulfilled':
        out.push({ at: e.at, label: `Resident re-submitted the requested portion` });
        break;
      case 'step.closed':
        out.push({ at: e.at, label: `${stepTitle(p.stepKey)} complete` });
        break;
      case 'workflow.closed':
        out.push({ at: e.at, label: p.status === 'denied' ? 'Workflow closed — denied' : 'Workflow complete' });
        break;
    }
  }
  return out;
}

export interface DeskDetail {
  submissionId: string;
  formKey: string;
  city: string;
  submittedAt: string;
  source: string;
  status: WorkflowStatus;
  values: FieldValue[];
  fields: FormField[];
  myScope: string[];
  myApprovalStatus: ApprovalStatus | null;
  canAct: boolean;
  currentStepKey: string | null;
  steps: { key: string; title: string; status: string; approvals: { approver: string; status: ApprovalStatus }[] }[];
  timeline: TimelineEntry[];
  timing: { internalMs: number; externalMs: number };
}

/** Everything the approver detail screen needs, scoped to the signed-in department. */
export async function deskSubmissionDetail(
  env: EngineEnv,
  department: string,
  submissionId: string,
): Promise<DeskDetail | null> {
  const loaded = await loadInstance(env, submissionId);
  if (!loaded) return null;
  const form = await env.repo.getFormDefinition(loaded.submission.formKey, loaded.submission.formVersion);
  const openStep = loaded.instance.steps.find((s) => s.status === 'open');
  const myApproval = openStep?.approvals.find((a) => a.approver === department) ?? null;
  const timing = computeTiming(loaded.events, env.clock.now());

  return {
    submissionId,
    formKey: loaded.submission.formKey,
    city: loaded.submission.city,
    submittedAt: loaded.submission.submittedAt,
    source: loaded.submission.source,
    status: loaded.instance.status,
    values: loaded.submission.values,
    fields: form?.fields ?? [],
    myScope: myApproval?.scope ?? [],
    myApprovalStatus: myApproval?.status ?? null,
    canAct: myApproval?.status === 'pending',
    currentStepKey: openStep?.stepKey ?? null,
    steps: loaded.instance.steps.map((s) => ({
      key: s.stepKey,
      title: loaded.def.steps.find((d) => d.key === s.stepKey)?.title ?? s.stepKey,
      status: s.status,
      approvals: s.approvals.map((a) => ({ approver: a.approver, status: a.status })),
    })),
    timeline: buildTimeline(loaded.events, loaded.def),
    timing: { internalMs: timing.internalMs, externalMs: timing.externalMs },
  };
}

// ── Operator metrics (Phase 5) ───────────────────────────────────────────────

export interface Metrics {
  total: number;
  byStatus: Record<WorkflowStatus, number>;
  internalMs: number;
  externalMs: number;
  avgInternalMs: number;
  avgExternalMs: number;
  perStep: { stepKey: string; internalMs: number; externalMs: number }[];
  resubmitRequests: number;
  /** Fraction of submissions that hit at least one re-submit. */
  resubmitRate: number;
  /** Open work waiting per department, right now. */
  pendingByDepartment: { approver: string; count: number }[];
}

/**
 * Aggregate timing + flow metrics across ALL submissions. The measurement
 * spine's payoff: where does time actually go (city vs citizen), per step, and
 * who's holding the queue right now. Derive-on-read — fine at prototype scale.
 */
export async function computeMetrics(env: EngineEnv): Promise<Metrics> {
  const ids = await env.repo.listAllSubmissionIds();
  const now = env.clock.now();
  const byStatus: Record<WorkflowStatus, number> = { open: 0, completed: 0, denied: 0 };
  const perStep = new Map<string, { internalMs: number; externalMs: number }>();
  const pending = new Map<string, number>();
  let internalMs = 0;
  let externalMs = 0;
  let resubmitRequests = 0;
  let withResubmit = 0;

  for (const id of ids) {
    const loaded = await loadInstance(env, id);
    if (!loaded) continue;
    byStatus[loaded.instance.status]++;

    const t = computeTiming(loaded.events, now);
    internalMs += t.internalMs;
    externalMs += t.externalMs;
    for (const [k, v] of Object.entries(t.byStep)) {
      const cur = perStep.get(k) ?? { internalMs: 0, externalMs: 0 };
      cur.internalMs += v.internalMs;
      cur.externalMs += v.externalMs;
      perStep.set(k, cur);
    }

    const resubmits = loaded.events.filter(
      (e) => e.type === 'decision.recorded' && (e.payload as Record<string, unknown>).decision === 'requires_resubmit',
    ).length;
    resubmitRequests += resubmits;
    if (resubmits > 0) withResubmit++;

    if (loaded.instance.status === 'open') {
      const open = loaded.instance.steps.find((s) => s.status === 'open');
      open?.approvals
        .filter((a) => a.status === 'pending')
        .forEach((a) => pending.set(a.approver, (pending.get(a.approver) ?? 0) + 1));
    }
  }

  const n = ids.length;
  return {
    total: n,
    byStatus,
    internalMs,
    externalMs,
    avgInternalMs: n ? Math.round(internalMs / n) : 0,
    avgExternalMs: n ? Math.round(externalMs / n) : 0,
    perStep: [...perStep.entries()].map(([stepKey, v]) => ({ stepKey, ...v })),
    resubmitRequests,
    resubmitRate: n ? withResubmit / n : 0,
    pendingByDepartment: [...pending.entries()]
      .map(([approver, count]) => ({ approver, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Record a department's decision from the console. The caller passes the
 * department from the VERIFIED session cookie (never the request body), and we
 * resolve the step server-side: the currently-open step where this department's
 * approval is pending. Fails closed if there's nothing for them to act on.
 */
export async function deskDecide(
  env: EngineEnv,
  department: string,
  input: { submissionId: string; decision: DecisionInput['decision']; reason?: string; resubmitScope?: string[] },
): Promise<void> {
  const loaded = await loadInstance(env, input.submissionId);
  if (!loaded) fail('INSTANCE_NOT_FOUND', `no workflow for submission "${input.submissionId}"`);
  const openStep = loaded!.instance.steps.find(
    (s) => s.status === 'open' && s.approvals.some((a) => a.approver === department && a.status === 'pending'),
  );
  if (!openStep) fail('APPROVAL_NOT_PENDING', `nothing is pending for "${department}" on this submission`);
  await recordDecision(env, input.submissionId, {
    stepKey: openStep!.stepKey,
    approver: department, // forced from the verified session, not the client
    decision: input.decision,
    reason: input.reason,
    resubmitScope: input.resubmitScope,
  });
}
