import { redirect } from 'next/navigation';
import { isAuthedAdmin } from '@/lib/requireAdmin';
import { getAllPrompts } from '@/lib/prompts';
import PromptEditor from './PromptEditor';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  if (!(await isAuthedAdmin())) redirect('/admin');
  const prompts = await getAllPrompts();

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify <span className={styles.tag}>agent prompts</span>
        </div>
        <a className={styles.logout} href="/admin">
          ← waitlist
        </a>
      </div>

      <div className={styles.headRow}>
        <h1 className={styles.title}>
          How the city <span className={styles.it}>thinks.</span>
        </h1>
      </div>
      <p className={styles.promptIntro}>
        Edit a prompt and save — it takes effect on the very next agent run, no redeploy. This is the
        living surface: reshape the categories, the cost table, the tone, the judgment. &ldquo;Reset&rdquo;
        returns to the built-in default.
      </p>

      <PromptEditor prompts={prompts} />
    </main>
  );
}
