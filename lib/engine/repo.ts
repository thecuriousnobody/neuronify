// Neon-backed implementation of the engine's Repository port.
//
// This is an ADAPTER and lives on the app side ON PURPOSE: it is the only place
// where SQL meets the engine. The engine never imports this file — it only knows
// the `Repository` interface. Swap Neon for anything else and the engine is none
// the wiser.

import type {
  AuditEvent,
  FormDefinition,
  Repository,
  Submission,
  WorkflowDefinition,
} from '@/engine';
import { getSql } from '@/lib/db';

type Row = Record<string, any>;

export class NeonRepository implements Repository {
  private get sql() {
    return getSql();
  }

  async getFormDefinition(key: string, version?: number): Promise<FormDefinition | null> {
    const rows = (version != null
      ? await this.sql`select doc from nf_form_definitions where key = ${key} and version = ${version}`
      : await this.sql`select doc from nf_form_definitions where key = ${key} order by version desc limit 1`) as Row[];
    return rows[0] ? (rows[0].doc as FormDefinition) : null;
  }

  async getWorkflowDefinition(key: string, version?: number): Promise<WorkflowDefinition | null> {
    const rows = (version != null
      ? await this.sql`select doc from nf_workflow_definitions where key = ${key} and version = ${version}`
      : await this.sql`select doc from nf_workflow_definitions where key = ${key} order by version desc limit 1`) as Row[];
    return rows[0] ? (rows[0].doc as WorkflowDefinition) : null;
  }

  async saveSubmission(s: Submission): Promise<void> {
    await this.sql`
      insert into nf_submissions (id, form_key, form_version, city, source, submitted_at, values)
      values (${s.id}, ${s.formKey}, ${s.formVersion}, ${s.city}, ${s.source}, ${s.submittedAt}, ${JSON.stringify(s.values)})
      on conflict (id) do nothing
    `;
  }

  async updateSubmissionValues(id: string, values: Submission['values']): Promise<void> {
    await this.sql`update nf_submissions set values = ${JSON.stringify(values)} where id = ${id}`;
  }

  async getSubmission(id: string): Promise<Submission | null> {
    const rows = (await this.sql`
      select id, form_key, form_version, city, source, submitted_at, values
      from nf_submissions where id = ${id}
    `) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      formKey: r.form_key,
      formVersion: r.form_version,
      city: r.city,
      source: r.source,
      submittedAt: new Date(r.submitted_at).toISOString(),
      values: r.values ?? [],
    };
  }

  async appendEvents(events: AuditEvent[]): Promise<void> {
    // The HTTP driver runs one statement per call; insert sequentially so `seq`
    // preserves the engine's emission order. Volumes per command are tiny (1–4).
    for (const e of events) {
      await this.sql`
        insert into nf_audit_events
          (id, submission_id, workflow_instance_id, type, actor, actor_side, at, payload)
        values
          (${e.id}, ${e.submissionId}, ${e.workflowInstanceId ?? null}, ${e.type},
           ${e.actor}, ${e.actorSide}, ${e.at}, ${JSON.stringify(e.payload)})
        on conflict (id) do nothing
      `;
    }
  }

  async getEvents(submissionId: string): Promise<AuditEvent[]> {
    const rows = (await this.sql`
      select id, submission_id, workflow_instance_id, type, actor, actor_side, at, payload
      from nf_audit_events
      where submission_id = ${submissionId}
      order by seq asc
    `) as Row[];
    return rows.map((r) => ({
      id: r.id,
      submissionId: r.submission_id,
      workflowInstanceId: r.workflow_instance_id ?? undefined,
      type: r.type,
      actor: r.actor,
      actorSide: r.actor_side,
      at: new Date(r.at).toISOString(),
      payload: r.payload ?? {},
    }));
  }

  async listOpenSubmissionIds(): Promise<string[]> {
    // Opened but not closed. Newest first so the queue surfaces recent work.
    const rows = (await this.sql`
      select s.id
      from nf_submissions s
      where exists (
        select 1 from nf_audit_events e
        where e.submission_id = s.id and e.type = 'workflow.opened'
      )
      and not exists (
        select 1 from nf_audit_events e
        where e.submission_id = s.id and e.type = 'workflow.closed'
      )
      order by s.submitted_at desc
    `) as Row[];
    return rows.map((r) => r.id);
  }

  async listAllSubmissionIds(): Promise<string[]> {
    const rows = (await this.sql`
      select id from nf_submissions order by submitted_at desc
    `) as Row[];
    return rows.map((r) => r.id);
  }
}
