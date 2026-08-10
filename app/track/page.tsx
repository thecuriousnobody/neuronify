import type { Metadata } from 'next';
import TrackIndexClient from './TrackIndexClient';

// /track without an id used to be a 404 — the resident who lost their reference
// number had nowhere to go. It is now an index of what THIS DEVICE filed, read
// from localStorage in the client (see lib/report-memory.ts). Nothing about it
// is server-side: there is no account to look reports up by, which is the whole
// reason the device has to remember.
//
// noindex for the same reason as /track/<id>: it is a personal surface, not a
// public one. This page can't leak anything by itself — it renders only what
// the visitor's own browser already holds — but a crawler has no business here.
export const metadata: Metadata = {
  title: 'Your reports',
  robots: { index: false, follow: false },
};

export default function TrackIndexPage() {
  return <TrackIndexClient />;
}
