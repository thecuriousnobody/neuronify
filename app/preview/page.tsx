import styles from './preview.module.css';

export const dynamic = 'force-dynamic';

// The dry-run session, so the brief card links to a populated brief.
const DEMO_SESSION = '66df1af1-4d80-4115-a042-5ad41170f730';

type Tile = {
  path: string;
  title: string;
  desc: string;
  kind: 'iframe' | 'image' | 'link';
  note?: string;
};

const TILES: Tile[] = [
  { path: '/', title: 'Landing', desc: "The home page — your city's nervous system.", kind: 'iframe' },
  { path: '/speak', title: 'Speak', desc: 'Public submission. Voice or text. The QR target.', kind: 'iframe' },
  { path: '/wall', title: 'Live wall', desc: 'Signals arrive in real time; the city lights up.', kind: 'iframe' },
  { path: '/qr', title: 'QR poster', desc: 'Printable scan-to-speak poster.', kind: 'image' },
  { path: '/admin', title: 'Admin', desc: 'Waitlist + live agent-prompt editor (gated).', kind: 'iframe' },
  {
    path: `/brief/${DEMO_SESSION}`,
    title: 'Council brief',
    desc: 'Ranked, costed, with web-grounded proactive actions.',
    kind: 'link',
    note: 'Generates live (~15s) — opens on click',
  },
];

export default function PreviewPage() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify
        </div>
        <div className={styles.eyebrow}>Preview · every service</div>
        <h1 className={styles.title}>
          The whole <span className={styles.it}>nervous system</span>, one screen.
        </h1>
        <p className={styles.sub}>
          Live thumbnails of every route. Click any tile to open it full-size.
        </p>
      </header>

      <div className={styles.grid}>
        {TILES.map((t) => (
          <a key={t.path} href={t.path} target="_blank" rel="noopener noreferrer" className={styles.card}>
            <div className={styles.frame}>
              {t.kind === 'iframe' && (
                <iframe
                  src={t.path}
                  className={styles.ifr}
                  loading="lazy"
                  tabIndex={-1}
                  title={t.title}
                  scrolling="no"
                />
              )}
              {t.kind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.path} alt={t.title} className={styles.img} />
              )}
              {t.kind === 'link' && (
                <div className={styles.placeholder}>
                  <div className={styles.placeholderNode} />
                  <div className={styles.placeholderNote}>{t.note}</div>
                </div>
              )}
            </div>
            <div className={styles.body}>
              <div className={styles.cardTitle}>
                {t.title}
                <span className={styles.open}>Open ↗</span>
              </div>
              <div className={styles.desc}>{t.desc}</div>
              <div className={styles.path}>{t.path}</div>
            </div>
          </a>
        ))}
      </div>

      <footer className={styles.foot}>neuronify.ai · preview gallery</footer>
    </main>
  );
}
