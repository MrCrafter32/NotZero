import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answered, centralDate, parseTime, threads, worklist, sendWorklist } from '../worklist.js';
const config = { guild_id: '9', forum_channel_id: '8', output_channel_id: '7', staff_role_ids: ['mod'] };
test('fixed UTC−6 with date rollover and no summer shift', () => {
  assert.deepEqual(centralDate(new Date('2026-07-01T05:30:00Z')), { day: '2026-06-30', time: '23:30' });
  assert.equal(centralDate(new Date('2026-01-01T18:00:00Z')).time, '12:00');
});
test('time validation', () => {
  assert.equal(parseTime('18:00'), '18:00');
  for (const bad of ['24:00', '6pm', '18:90']) assert.throws(() => parseTime(bad));
});
test('starter, bots and nonstaff do not count', async () => {
  const rest = { get: async path => path.endsWith('/messages') ? [
    { id: '1', author: { id: 'staff' } }, { id: '2', author: { bot: true } }, { id: '3', author: { id: 'reporter' } },
  ] : { roles: [] } };
  assert.equal(await answered(rest, config, { id: '1' }, new Map()), false);
});
test('staff found on later message page', async () => {
  const rest = { get: async (path, opts) => {
    if (!path.endsWith('/messages')) return { roles: ['mod'] };
    return opts.query.has('before') ? [{ id: '2', author: { id: 'staff' } }] : Array.from({ length: 100 }, (_, i) => ({ id: String(i + 10), author: { bot: true } }));
  } };
  assert.equal(await answered(rest, config, { id: '1' }, new Map()), true);
});
test('archive pagination and deduplication', async () => {
  const rest = { get: async (path, opts) => {
    if (path.includes('/active')) return { threads: [{ id: '1', parent_id: '8' }] };
    if (!opts.query.has('before')) return { threads: [{ id: '1', thread_metadata: { archive_timestamp: 'cursor' } }], has_more: true };
    assert.equal(opts.query.get('before'), 'cursor');
    return { threads: [{ id: '2' }], has_more: false };
  } };
  assert.equal((await threads(rest, config)).length, 2);
});
test('resolved excluded, archived open included, no pings', async () => {
  const sent = [];
  const rest = { get: async path => {
    if (path === '/channels/8') return { type: 15, guild_id: '9', available_tags: [{ id: 'r', name: 'Squashed' }] };
    if (path.includes('/active')) return { threads: [{ id: '1', parent_id: '8', name: 'Fixed', applied_tags: ['r'] }] };
    if (path.includes('/archived/')) return { threads: [{ id: '2', name: 'Archived bug', applied_tags: [] }], has_more: false };
    return [];
  }, post: async (path, options) => sent.push(options.body) };
  const text = (await worklist(rest, config)).join('\n');
  assert.ok(!text.includes('Fixed'));
  assert.ok(text.includes('Archived bug'));
  assert.ok(text.includes('Awaiting a staff reply (1)'));
  await sendWorklist(rest, config);
  assert.deepEqual(sent[0].allowed_mentions, { parse: [] });
});
