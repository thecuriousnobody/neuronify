import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateBrief } from '@/lib/brief';
import { COST_DISCLAIMER } from '@/lib/agents';
import styles from '../brief.module.css';

export const dynamic = 'force-dynamic';

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export default async function BriefPage({
  params,
}: {
  params: { sessionId: string };
}) {
  let brief;
  try {
    brief = await generateBrief(params.sessionId);
  } catch (err: any) {
    return (
      <main className={styles.page}>
        <Header />
        <div className={styles.empty}>
          <div className={styles.big}>Couldn&apos;t build the brief.</div>
          <p>{String(err?.message ?? err)}</p>
        </div>
      </main>
    );
  }

  if (brief.residentCount === 0) {
    return (
      <main className={styles.page}>
        <Header />
        <div className={styles.empty}>
          <div className={styles.big}>No signal yet.</div>
          <p>Once residents start speaking, their brief appears here.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Header />

      <div className={styles.eyebrow}>Peoria · session brief</div>
      <h1 className={styles.title}>
        What Peoria <span className={styles.it}>asked for.</span>
      </h1>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Residents who spoke</div>
          <div className={styles.statValue}>
            {brief.residentCount} <span className={styles.it}>signals</span>
          </div>
          <div className={styles.statSub}>
            across {brief.byCategory.length}{' '}
            {brief.byCategory.length === 1 ? 'category' : 'categories'}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Total planning-level cost</div>
          <div className={styles.statValue}>
            {usd(brief.totalLow)}–{usd(brief.totalHigh)}
          </div>
          <div className={styles.statSub}>summed across all submissions</div>
        </div>
      </div>

      <p className={styles.disclaimer}>↳ {COST_DISCLAIMER}</p>

      <article className={styles.prose}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.markdown}</ReactMarkdown>
      </article>

      <div className={styles.foot}>
        NEURONIFY · COMMUNITY SIGNAL · PEORIA, ILLINOIS · NOT A FORMAL ENGINEERING QUOTE
      </div>
    </main>
  );
}

function Header() {
  return (
    <div className={styles.top}>
      <a href="/" className={styles.brand}>
        <span className={styles.brandDot} />
        Neuronify
      </a>
      <a href="/wall" className={styles.back}>
        ← back to the wall
      </a>
    </div>
  );
}
