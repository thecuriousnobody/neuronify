// Timing — derive external (citizen) vs internal (city) step time purely from
// the append-only audit log. This is the sketch's measurement spine: "each loop
// is tracked start→finish ... so you get data on external & internal step times."
//
// The rule: an approval accrues INTERNAL time while it sits `pending` (the city
// is reviewing) and EXTERNAL time while it sits `awaiting_resubmit` (the ball is
// with the citizen). We replay the log, tracking when each approval entered its
// current waiting state, and bank the interval whenever it leaves.
//
// Date.parse on an ISO string is pure/deterministic — no wall-clock is read here.

import type { AuditEvent } from '../domain/types';

export interface TimingBucket {
  internalMs: number;
  externalMs: number;
}

export interface ApprovalTiming extends TimingBucket {
  loops: number;
}

export interface TimingReport extends TimingBucket {
  byStep: Record<string, TimingBucket>;
  byApproval: Record<string, ApprovalTiming>; // key = `${stepKey}::${approver}`
}

type TrackStatus = 'pending' | 'awaiting_resubmit' | 'done';

interface Track {
  stepKey: string;
  status: TrackStatus;
  enteredAt: string;
}

/**
 * @param events the submission's full audit log, in order.
 * @param now    optional ISO instant to bank still-open intervals against
 *               (e.g. the current time, for live "age" of in-flight work).
 */
export function computeTiming(events: AuditEvent[], now?: string): TimingReport {
  const report: TimingReport = { internalMs: 0, externalMs: 0, byStep: {}, byApproval: {} };
  const tracks = new Map<string, Track>();

  const step = (k: string) => (report.byStep[k] ??= { internalMs: 0, externalMs: 0 });
  const appr = (k: string) => (report.byApproval[k] ??= { internalMs: 0, externalMs: 0, loops: 0 });
  const span = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a));

  const bank = (key: string, t: Track, until: string) => {
    const dur = span(t.enteredAt, until);
    if (t.status === 'pending') {
      report.internalMs += dur;
      step(t.stepKey).internalMs += dur;
      appr(key).internalMs += dur;
    } else if (t.status === 'awaiting_resubmit') {
      report.externalMs += dur;
      step(t.stepKey).externalMs += dur;
      appr(key).externalMs += dur;
    }
  };

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;

    if (e.type === 'step.opened') {
      const stepKey = p.stepKey as string;
      const approvals = (p.approvals as { approver: string }[]) ?? [];
      for (const a of approvals) {
        const key = `${stepKey}::${a.approver}`;
        tracks.set(key, { stepKey, status: 'pending', enteredAt: e.at });
        appr(key); // ensure the row exists even if it never moves
      }
    } else if (e.type === 'decision.recorded') {
      const stepKey = p.stepKey as string;
      const key = `${stepKey}::${p.approver as string}`;
      const t = tracks.get(key);
      if (!t) continue;
      bank(key, t, e.at);
      if (p.decision === 'requires_resubmit') {
        t.status = 'awaiting_resubmit';
        t.enteredAt = e.at;
      } else {
        t.status = 'done'; // approved or denied — terminal, stops accruing
      }
    } else if (e.type === 'resubmit.fulfilled') {
      const stepKey = p.stepKey as string;
      const key = `${stepKey}::${p.approver as string}`;
      const t = tracks.get(key);
      if (!t) continue;
      bank(key, t, e.at); // close the external interval
      t.status = 'pending'; // back to the city
      t.enteredAt = e.at;
      appr(key).loops += 1;
    }
  }

  // Bank still-open intervals against `now`, if given (live in-flight time).
  if (now) {
    for (const [key, t] of tracks) {
      if (t.status === 'pending' || t.status === 'awaiting_resubmit') bank(key, t, now);
    }
  }

  return report;
}
