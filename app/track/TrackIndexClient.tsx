'use client';

// The index of what this device filed. Everything on screen comes out of
// localStorage — there is no account, no server call, nothing to fetch.
//
// Two things this page owes the resident. First, honesty about its own limits:
// it knows about reports filed from THIS browser, and saying so plainly is
// better than letting someone conclude their report vanished. Second, an
// eraser — a device-memory feature without one is a privacy problem we
// authored ourselves, and a library computer is a real way to file.

import { useEffect, useState } from 'react';
import { prettyKey } from '@/lib/labels';
import {
  rememberedReports,
  forgetReports,
  canRemember,
  type RememberedReport,
} from '@/lib/report-memory';
import styles from './track-index.module.css';

/** `null` means "haven't looked yet". The read has to happen after mount —
 *  localStorage doesn't exist during the server render, and reading it in the
 *  first client render would hydrate a mismatch. */
type List = RememberedReport[] | null;

function filedOn(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrackIndexClient() {
  const [items, setItems] = useState<List>(null);
  const [storable, setStorable] = useState(true);
  // Forgetting is irreversible and one tap from the list, so it asks first.
  // Deliberately an inline confirm rather than window.confirm — a native modal
  // is a worse thing to hand someone on a phone.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setItems(rememberedReports());
    setStorable(canRemember());
  }, []);

  function forget() {
    forgetReports();
    setItems([]);
    setConfirming(false);
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Your reports</span>
        <span className={styles.city}>Peoria, IL</span>
      </div>

      {items === null ? (
        <p className={styles.muted}>Checking this device…</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          {storable ? (
            <>
              <p className={styles.emptyLead}>No reports on this device.</p>
              <p className={styles.muted}>
                This page only knows about reports filed from this browser. If you filed from a
                different phone or computer — or cleared your browsing data — open the report’s own
                link instead.
              </p>
            </>
          ) : (
            <>
              <p className={styles.emptyLead}>This browser isn’t saving anything.</p>
              <p className={styles.muted}>
                Private browsing, or storage is switched off. You can still file a report — just
                keep the link you get at the end, because this page won’t remember it for you.
              </p>
            </>
          )}
          <a className={styles.newLink} href="/report/chat">
            File a report →
          </a>
        </div>
      ) : (
        <>
          <p className={styles.lede}>
            Filed from this device. {items.length === 1 ? 'It' : 'They'} stay{items.length === 1 ? 's' : ''} here
            only — we don’t have your name.
          </p>
          <div className={styles.list}>
            {items.map((r) => (
              <a key={r.id} className={styles.card} href={`/track/${r.id}`}>
                <div className={styles.cardTop}>
                  <span className={styles.cardTitle}>{r.category ? prettyKey(r.category) : 'Report'}</span>
                  {r.department ? <span className={styles.badge}>{prettyKey(r.department)}</span> : null}
                </div>
                {r.matched ? <div className={styles.cardWhere}>📍 {r.matched}</div> : null}
                <div className={styles.cardMeta}>
                  {filedOn(r.filedAt) ? `Filed ${filedOn(r.filedAt)} · ` : ''}
                  <span className={styles.ref}>{r.id.slice(0, 8)}</span>
                </div>
              </a>
            ))}
          </div>

          <div className={styles.footer}>
            <a className={styles.newLink} href="/report/chat">
              File another report →
            </a>
            {confirming ? (
              <span className={styles.confirm}>
                <span className={styles.muted}>Clear this list from this device?</span>
                <button className={styles.danger} type="button" onClick={forget}>
                  Forget these
                </button>
                <button className={styles.quiet} type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className={styles.quiet} type="button" onClick={() => setConfirming(true)}>
                Forget these
              </button>
            )}
          </div>
          {confirming && (
            <p className={styles.fineprint}>
              This only clears the list on this device. The reports themselves stay with the city,
              and their links keep working.
            </p>
          )}
        </>
      )}
    </main>
  );
}
