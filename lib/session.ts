import { getSql } from './db';

export type Session = {
  id: string;
  city: string;
  label: string | null;
  started_at: string;
  ended_at: string | null;
};

// Return the most recent open session, creating one if none exists.
// The demo runs as a single rolling session.
export async function getOrCreateSession(): Promise<Session> {
  const sql = getSql();
  const open = (await sql`
    select * from sessions where ended_at is null order by started_at desc limit 1
  `) as Session[];
  if (open[0]) return open[0];

  const created = (await sql`
    insert into sessions (city) values ('Peoria, IL') returning *
  `) as Session[];
  return created[0];
}
