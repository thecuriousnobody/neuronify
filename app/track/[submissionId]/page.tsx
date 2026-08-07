import { engineEnv } from '@/lib/engine';
import { getInstanceView } from '@/engine';
import type { ApprovalStatus, StepStatus, WorkflowStatus } from '@/engine';
import { prettyFormKey, prettyKey } from '@/lib/labels';
import { signedPhotoUrls } from '@/lib/blob-read';
import styles from './track.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  open: 'In progress',
  completed: 'Complete',
  denied: 'Not approved',
};

const STEP: Record<StepStatus, { label: string; cls: string }> = {
  not_started: { label: 'Waiting', cls: styles.bWaiting },
  open: { label: 'In review', cls: styles.bActive },
  closed: { label: 'Done', cls: styles.bDone },
  denied: { label: 'Declined', cls: styles.bDeclined },
};

const APPROVAL: Record<ApprovalStatus, string> = {
  pending: 'in review',
  approved: 'approved',
  awaiting_resubmit: 'needs your input',
  denied: 'declined',
};

function humanize(ms: number): string {
  if (ms < 1000) return '0m';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Residents never see internal form keys. This page had its own copy of the
// namespace strip; it now shares the one the staff surfaces were missing.
const pretty = prettyKey;

export default async function TrackPage({ params }: { params: { submissionId: string } }) {
  const view = await getInstanceView(engineEnv(), params.submissionId);

  if (!view) {
    return (
      <main className={styles.wrap}>
        <div className={styles.notFound}>We couldn’t find that submission.</div>
      </main>
    );
  }

  const { instance, submission, timing } = view;
  const submitted = new Date(submission.submittedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // The resident's own photos, presigned for this page load. They could never
  // see them before: the row just rendered an em dash, because a filed photo
  // clears the field's value and nothing here read attachmentIds (Blake 1.3).
  const photosByField = new Map<string, string[]>(
    await Promise.all(
      submission.values
        .filter((v) => v.attachmentIds?.length)
        .map(
          async (v) => [v.fieldKey, await signedPhotoUrls(v.attachmentIds ?? [])] as [string, string[]],
        ),
    ),
  );

  return (
    <main className={styles.wrap}>
      <div className={styles.eyebrow}>{prettyFormKey(submission.formKey)}</div>
      <div className={styles.status}>{WORKFLOW_LABEL[instance.status]}</div>
      <div className={styles.meta}>
        {submission.city} · submitted {submitted}
      </div>

      {/* The record — what the resident actually reported. Their words, on their page. */}
      {submission.values.length > 0 && (
        <div className={styles.record}>
          <div className={styles.recordHead}>Your report</div>
          {submission.values.map((v) => {
            const photos = photosByField.get(v.fieldKey) ?? [];
            const hadPhotos = Boolean(v.attachmentIds?.length);
            return (
              <div key={v.fieldKey} className={styles.recordRow}>
                <span className={styles.recordKey}>{pretty(v.fieldKey)}</span>
                <span className={styles.recordVal}>
                  {hadPhotos ? (
                    photos.length ? (
                      <span className={styles.photos}>
                        {photos.map((src, i) => (
                          <a key={i} href={src} target="_blank" rel="noreferrer">
                            <img className={styles.photo} src={src} alt={`Photo ${i + 1} you sent with this report`} />
                          </a>
                        ))}
                      </span>
                    ) : (
                      // The photo is filed and staff can see it; only this
                      // temporary link failed. Say so plainly.
                      <span className={styles.muted}>Photo received — preview unavailable right now.</span>
                    )
                  ) : v.value === true ? (
                    'Yes'
                  ) : v.value === false ? (
                    'No'
                  ) : (
                    String(v.value ?? '—')
                  )}
                  {v.geo && <span className={styles.resolved}>Located at {v.geo.matched}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.steps}>
        {instance.steps.map((s) => {
          const badge = STEP[s.status];
          return (
            <div key={s.stepKey} className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.stepTitle}>{pretty(s.stepKey)}</span>
                <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
              </div>
              {s.status !== 'not_started' && (
                <div className={styles.approvals}>
                  {s.approvals.map((a) => (
                    <span key={a.approver} className={styles.appr}>
                      {pretty(a.approver)}: {APPROVAL[a.status]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.timing}>
        <div className={styles.tcard}>
          <div className={styles.tval}>{humanize(timing.internalMs)}</div>
          <div className={styles.tlabel}>time with the city</div>
        </div>
      </div>
    </main>
  );
}
