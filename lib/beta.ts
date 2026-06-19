// Beta-layer helpers: which submissions belong to a signed-in tester. The link
// lives in nf_beta_submissions (separate from the anonymous nf_submissions).
import { getSql } from '@/lib/db';

export async function listMySubmissionIds(email: string): Promise<string[]> {
  const rows = (await getSql()`
    select submission_id from nf_beta_submissions
    where email = ${email} order by created_at desc
  `) as { submission_id: string }[];
  return rows.map((r) => r.submission_id);
}

export async function ownsSubmission(email: string, submissionId: string): Promise<boolean> {
  const rows = (await getSql()`
    select 1 from nf_beta_submissions
    where email = ${email} and submission_id = ${submissionId} limit 1
  `) as unknown[];
  return rows.length > 0;
}
