// In-memory port adapters for tests. These are REAL working implementations of
// the ports (an actual store, an actual outbox) — not stubs that fake return
// values. They let the async service layer be exercised end-to-end with no DB,
// and they double as the reference for what a persistent adapter must do.

import type {
  AuditEvent,
  CommunicationIntent,
  FormDefinition,
  Submission,
  WorkflowDefinition,
} from '../domain/types';
import type { EngineEnv, LLM, Notifier, Repository } from '../ports';
import { FakeClock, SeqIds } from './doubles';

export class InMemoryRepository implements Repository {
  private forms = new Map<string, FormDefinition[]>(); // key -> versions
  private workflows = new Map<string, WorkflowDefinition[]>();
  private submissions = new Map<string, Submission>();
  private events: AuditEvent[] = []; // global, insertion-ordered

  putFormDefinition(def: FormDefinition): void {
    const list = this.forms.get(def.key) ?? [];
    list.push(def);
    this.forms.set(def.key, list);
  }
  putWorkflowDefinition(def: WorkflowDefinition): void {
    const list = this.workflows.get(def.key) ?? [];
    list.push(def);
    this.workflows.set(def.key, list);
  }

  private latest<T extends { version: number }>(list: T[] | undefined, version?: number): T | null {
    if (!list || list.length === 0) return null;
    if (version != null) return list.find((d) => d.version === version) ?? null;
    return list.reduce((a, b) => (b.version > a.version ? b : a));
  }

  async getFormDefinition(key: string, version?: number): Promise<FormDefinition | null> {
    return this.latest(this.forms.get(key), version);
  }
  async getWorkflowDefinition(key: string, version?: number): Promise<WorkflowDefinition | null> {
    return this.latest(this.workflows.get(key), version);
  }
  async saveSubmission(s: Submission): Promise<void> {
    this.submissions.set(s.id, structuredClone(s));
  }
  async getSubmission(id: string): Promise<Submission | null> {
    const s = this.submissions.get(id);
    return s ? structuredClone(s) : null;
  }
  async appendEvents(events: AuditEvent[]): Promise<void> {
    for (const e of events) this.events.push(structuredClone(e));
  }
  async getEvents(submissionId: string): Promise<AuditEvent[]> {
    return this.events.filter((e) => e.submissionId === submissionId).map((e) => structuredClone(e));
  }

  async listOpenSubmissionIds(): Promise<string[]> {
    const opened = new Set<string>();
    const closed = new Set<string>();
    for (const e of this.events) {
      if (e.type === 'workflow.opened') opened.add(e.submissionId);
      else if (e.type === 'workflow.closed') closed.add(e.submissionId);
    }
    return [...opened].filter((id) => !closed.has(id));
  }

  async listAllSubmissionIds(): Promise<string[]> {
    return [...this.submissions.keys()];
  }
}

/** Notifier that just records what would be delivered. */
export class CollectingNotifier implements Notifier {
  readonly sent: CommunicationIntent[] = [];
  async send(intent: CommunicationIntent): Promise<void> {
    this.sent.push(intent);
  }
}

/** LLM stub for layers that don't exercise the model. */
export class StubLLM implements LLM {
  async complete(): Promise<string> {
    return '';
  }
}

/** Returns queued canned responses in order — for testing intake turns. */
export class ScriptedLLM implements LLM {
  private i = 0;
  readonly calls: { system: string; user: string }[] = [];
  constructor(private replies: string[]) {}
  async complete(args: { system: string; user: string }): Promise<string> {
    this.calls.push({ system: args.system, user: args.user });
    return this.replies[this.i++] ?? '{}';
  }
}

/** Assemble a complete in-memory EngineEnv for tests. */
export function makeTestEnv(startMs = 0): {
  env: EngineEnv;
  repo: InMemoryRepository;
  notifier: CollectingNotifier;
  clock: FakeClock;
} {
  const repo = new InMemoryRepository();
  const notifier = new CollectingNotifier();
  const clock = new FakeClock(startMs);
  const env: EngineEnv = { clock, ids: new SeqIds('e'), repo, notifier, llm: new StubLLM() };
  return { env, repo, notifier, clock };
}
