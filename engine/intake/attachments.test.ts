import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedAttachmentUrl } from './attachments';

// The exact URL shape @vercel/blob's client builds for our PRIVATE store:
//   https://${storeId}.${access}.blob.vercel-storage.com/${pathname}
// This is the shape that shipped broken on 2026-07-31: the old regexes
// matched neither `.private.` URLs nor pinned the store, so every real
// photo was silently dropped and submission failed with "Still missing".
const STORE = 'abc123store';
const PRIVATE_URL = `https://${STORE}.private.blob.vercel-storage.com/reports/pothole-x8f2.png`;
const PUBLIC_URL = `https://${STORE}.public.blob.vercel-storage.com/reports/pothole-x8f2.png`;

describe('isAllowedAttachmentUrl — pinned to a store id', () => {
  it('accepts our private-store URL (the real upload shape)', () => {
    assert.equal(isAllowedAttachmentUrl(PRIVATE_URL, STORE), true);
  });

  it('accepts our public-store URL (if the store is ever flipped)', () => {
    assert.equal(isAllowedAttachmentUrl(PUBLIC_URL, STORE), true);
  });

  it('is case-insensitive on host and store id', () => {
    assert.equal(isAllowedAttachmentUrl(PRIVATE_URL.toUpperCase().replace('HTTPS', 'https'), 'ABC123STORE'), true);
  });

  it('accepts a store_-prefixed env id — the SDK strips it for the hostname', () => {
    assert.equal(isAllowedAttachmentUrl(PRIVATE_URL, `store_${STORE}`), true);
    assert.equal(
      isAllowedAttachmentUrl('https://evilstore.private.blob.vercel-storage.com/x.png', `store_${STORE}`),
      false,
    );
  });

  it('rejects a DIFFERENT store — anyone can create one', () => {
    const foreign = 'https://evilstore.private.blob.vercel-storage.com/reports/x.png';
    assert.equal(isAllowedAttachmentUrl(foreign, STORE), false);
  });

  it('rejects lookalike prefix hosts', () => {
    assert.equal(
      isAllowedAttachmentUrl(`https://${STORE}.private.blob.vercel-storage.com.evil.com/x.png`, STORE),
      false,
    );
  });

  it('rejects the official host embedded in the path or query', () => {
    assert.equal(
      isAllowedAttachmentUrl(`https://evil.com/${STORE}.private.blob.vercel-storage.com/x.png`, STORE),
      false,
    );
    assert.equal(
      isAllowedAttachmentUrl(`https://evil.com/?u=${STORE}.private.blob.vercel-storage.com`, STORE),
      false,
    );
  });

  it('rejects non-https, non-URLs, and browser object URLs', () => {
    assert.equal(isAllowedAttachmentUrl(`http://${STORE}.private.blob.vercel-storage.com/x.png`, STORE), false);
    assert.equal(isAllowedAttachmentUrl('blob:https://neuronify.ai/1234-5678', STORE), false);
    assert.equal(isAllowedAttachmentUrl('reports/x.png', STORE), false);
    assert.equal(isAllowedAttachmentUrl('', STORE), false);
  });

  it('rejects an unknown access segment even on our store', () => {
    assert.equal(
      isAllowedAttachmentUrl(`https://${STORE}.internal.blob.vercel-storage.com/x.png`, STORE),
      false,
    );
  });
});

describe('isAllowedAttachmentUrl — no store id configured (fallback)', () => {
  it('accepts official private and public shapes from any store', () => {
    assert.equal(isAllowedAttachmentUrl(PRIVATE_URL, null), true);
    assert.equal(isAllowedAttachmentUrl(PUBLIC_URL, undefined), true);
  });

  it('accepts the legacy single-segment shape', () => {
    assert.equal(isAllowedAttachmentUrl('https://abc.blob.vercel-storage.com/x.png', null), true);
  });

  it('still rejects lookalikes and junk', () => {
    assert.equal(isAllowedAttachmentUrl('https://a.b.c.blob.vercel-storage.com/x.png', null), false);
    assert.equal(isAllowedAttachmentUrl('https://evil.com/x.blob.vercel-storage.com', null), false);
    assert.equal(isAllowedAttachmentUrl('https://notblob.vercel-storage.com/x.png', null), false);
  });
});

import { missingRequiredFields } from './attachments';

const FIELDS = [
  { key: 'photo', label: 'Photo', type: 'attachment', required: true },
  { key: 'what', label: 'What’s going on?', type: 'longtext', required: true },
  { key: 'hazard', label: 'Is it a safety hazard?', type: 'boolean', required: true },
  { key: 'extra', label: 'Anything else?', type: 'longtext', required: false },
] as any[];

describe('missingRequiredFields — the photo escape hatch', () => {
  const base = [
    { fieldKey: 'what', value: 'TEST — big pothole' },
    { fieldKey: 'hazard', value: false },
  ];

  it('a required photo is satisfied by an attachment', () => {
    const values = [...base, { fieldKey: 'photo', value: null, attachmentIds: ['https://x.private.blob.vercel-storage.com/reports/a.png'] }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), []);
  });

  it('a required photo is satisfied by a recorded reason instead', () => {
    const values = [...base, { fieldKey: 'photo', value: 'my phone camera is broken' }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), []);
  });

  it('neither photo nor reason → the photo is missing', () => {
    const values = [...base, { fieldKey: 'photo', value: null }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), ['Photo']);
  });

  it('a whitespace-only reason does not count', () => {
    const values = [...base, { fieldKey: 'photo', value: '   ' }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), ['Photo']);
  });

  it('boolean false satisfies a required boolean (No is an answer)', () => {
    const values = [...base, { fieldKey: 'photo', value: 'no camera' }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), []);
  });

  it('missing required text field is reported; optional fields never are', () => {
    const values = [{ fieldKey: 'photo', value: 'no camera' }, { fieldKey: 'hazard', value: true }];
    assert.deepEqual(missingRequiredFields(FIELDS, values as any), ['What’s going on?']);
  });
});
