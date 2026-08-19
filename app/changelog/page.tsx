import type { Metadata } from 'next';
import styles from './changelog.module.css';

export const metadata: Metadata = {
  title: 'Release notes · Neuronify',
  description: 'What’s new in Neuronify.',
};

// Data-driven so future entries are a one-object edit. Newest first.
const RELEASES = [
  {
    tag: 'Smart intake',
    date: 'August 2026',
    intro:
      'The conversation got a great deal better at listening. Tell it everything in your first sentence and it will stop asking you to repeat yourself, put a real map pin under the address it understood, and hand the department a photo they can actually open. Reports also stop disappearing on you: this browser now remembers what it filed.',
    sections: [
      {
        title: 'For residents',
        items: [
          ['Say it all at once', 'A first message like “a big pothole at Fry and Knoxville, in the traffic lane, about the size of a dinner plate” is read in full — location, lane and size are captured, and you are only asked for what you genuinely left out.'],
          ['Find your report again', 'The finish screen gives you a link, a copy button and a share button instead of a bare reference number. This browser remembers what you filed, so /track lists your reports even if you lose the link. It stays on your device — we still don’t have your name — and “Forget these” clears it.'],
          ['The pin sits with the address', 'The resolved location appears directly under the address field, as “this is where the crew will go”. Edit the address and the pin follows it. If a phrase can’t be placed on a map, it says so rather than dropping a pin in the middle of the city.'],
          ['Typo-tolerant locations', '“Fry and Knoxville” resolves to Knoxville Ave & E Frye Ave.'],
          ['An honest answer about photos', 'Where a photo is required, it asks for one — and if you can’t provide one, it asks why and sends that to the crew instead. It will never promise you can add a photo later, because you can’t.'],
          ['Emergencies stop the form', 'Gas, downed power lines, a water main break or an injury break off intake immediately with a Call 911 link, and tell you to get clear before they tell you to call. Ordinary reports — a leaking hydrant, a downed branch — are never interrupted.'],
          ['You’re told before you speak', 'Both doors say up front that the conversation is saved with your report, can be read by city staff, and may form part of the public record.'],
        ],
      },
      {
        title: 'For the city',
        items: [
          ['Photos you can open', 'Required photos now render on the case and open full size, served through short-lived signed links from private storage. The resident can see their own photo too.'],
          ['The address the crew will drive to', 'Cases show the resident’s own words and, beneath them, the resolved address with coordinates, linked to a map. If the resident corrects the address on the review screen, the record follows the correction.'],
          ['The conversation is on the case', 'The full intake transcript is preserved on reports filed through the chat, alongside the change log.'],
          ['Plain names, not internal keys', 'Titles read “Pothole”, never “Intake Pothole”, on both the resident and staff sides.'],
          ['The alert goes out when the report is filed', 'A department is notified at the moment of filing, rather than when someone happens to open the case.'],
        ],
      },
      {
        title: 'Known gaps',
        items: [
          ['Emergency phone numbers are not filled in', 'The hard stop points to 911 and says “the gas utility’s emergency line” without a number. Real numbers must be added and dialled before any pilot.'],
          ['Quick-reply chips can linger after a category change', 'If you correct the category, the previous category’s suggested answers may still be on screen. Type your answer rather than tapping one.'],
          ['Your words are summarised into the record', 'The description stored on the case is the assistant’s summary of what you said, not your sentence verbatim. The full transcript is kept alongside it.'],
          ['Water reports', 'Peoria’s water is a private utility; those reports currently land with a city desk rather than being referred out.'],
        ],
      },
    ],
    scope:
      'Around 22 report categories are configured across Peoria’s departments — potholes, street lights, graffiti, noise, trees, code enforcement and the rest. A report now goes straight to the department that owns it, with no front-desk step in between, and the department signs off on its own portion. Categories, department ownership and desk rosters are all data, so adding or re-pointing one is configuration rather than new code.',
    coming: [
      'Outbound text/email notifications (today’s messages are delivered in-app)',
      'Subscribe to updates on a report, without giving up anonymity',
      'Short human-readable reference codes instead of long identifiers',
      'Referring water reports out to the private utility automatically',
      'A city-side console for editing categories, departments and desks',
    ],
  },
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
