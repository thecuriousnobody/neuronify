import type { Metadata } from 'next';
import styles from './changelog.module.css';

export const metadata: Metadata = {
  title: 'Release notes · Neuronify',
  description: 'What’s new in Neuronify.',
};

// Data-driven so future entries are a one-object edit. Newest first.
const RELEASES = [
  {
    tag: 'v2 · Private beta',
    date: 'June 2026',
    intro:
      'The first end-to-end civic workflow: a resident files a report by voice or text, the city routes it through real departmental approvals, and everyone can see exactly where it stands — and how long each stage took.',
    sections: [
      {
        title: 'For residents',
        items: [
          ['Speak or type to file a report', 'A short conversation fills out the form, asking only for what’s still missing.'],
          ['Review before it’s official', 'You confirm the details — that’s the moment the city’s official record begins.'],
          ['Sign in with Google', 'One click to join the private beta.'],
          ['Your reports', 'Track status, and when a department asks for more, fix just that field and resubmit — without redoing the whole thing.'],
          ['Live tracking', 'A status page shows each review stage and the time spent with the city vs. waiting on you.'],
        ],
      },
      {
        title: 'For the city',
        items: [
          ['Department console', 'Each department signs in and sees exactly what’s waiting on it — nothing else.'],
          ['Sequential steps, parallel sign-offs', 'Reviews run in order; within a step, departments (e.g. Public Works + Fire) act in parallel, and every one must approve before it advances.'],
          ['Three clear outcomes', 'Approve, request a re-submit on specific fields, or deny with a required reason.'],
          ['Captured once', 'An approved portion locks — only the part a department bounces loops back to the resident.'],
          ['One message per stage', 'Residents hear at receipt, at each completed stage, and at the final outcome — not a buzz per department.'],
        ],
      },
      {
        title: 'Under the hood',
        items: [
          ['Append-only record of truth', 'Nothing is ever overwritten. Every step — including a resident’s edits — is logged as a new event.'],
          ['Time, split by who’s holding it', 'Every stage is measured as “city time” vs. “resident time.”'],
          ['Operator dashboard', 'Volumes by status, average city-vs-resident time, where time goes per step, re-submit rate, and who’s holding the queue right now.'],
          ['Anonymous by design', 'The public record carries no personal info; tester identity is kept in a separate layer.'],
        ],
      },
    ],
    scope:
      'Right now the only configured report type is Pothole reports (Intake review → Departmental review by Public Works + Fire). The whole system is form- and workflow-driven, so adding new report types — graffiti, streetlights, sidewalks — is configuration, not new code.',
    coming: [
      'Outbound text/email notifications (today’s messages are delivered in-app)',
      'More report types beyond potholes',
      'Per-person department sign-in (today departments use shared passcodes)',
    ],
  },
] as const;

export default function ChangelogPage() {
  return (
    <main className={styles.wrap}>
      <a href="/" className={styles.brand}>
        <span className={styles.dot} />
        Neuronify
      </a>
      <h1 className={styles.h1}>Release notes</h1>
      <p className={styles.sub}>What’s shipped, newest first. Built live, in the open.</p>

      {RELEASES.map((r) => (
        <div key={r.tag} className={styles.release}>
          <div className={styles.relHead}>
            <span className={styles.tag}>{r.tag}</span>
            <span className={styles.date}>{r.date}</span>
          </div>
          <p className={styles.relIntro}>{r.intro}</p>

          {r.sections.map((s) => (
            <div key={s.title} className={styles.section}>
              <div className={styles.secTitle}>{s.title}</div>
              {s.items.map(([title, body]) => (
                <div key={title} className={styles.item}>
                  <span className={styles.itemTitle}>{title}</span>
                  {' — '}
                  <span className={styles.itemBody}>{body}</span>
                </div>
              ))}
            </div>
          ))}

          <div className={styles.note}>
            <div className={styles.noteLabel}>Scope right now</div>
            <div className={styles.noteBody}>{r.scope}</div>
          </div>

          <div className={styles.section}>
            <div className={styles.secTitle}>Coming next</div>
            <ul className={styles.coming}>
              {r.coming.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      <div className={styles.footer}>
        Want in?{' '}
        <a href="/intake">File a report →</a>
      </div>
    </main>
  );
}
