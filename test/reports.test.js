import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportKey, findReport } from '../reports.js';
import { worklist } from '../worklist.js';

test('legacy bugs and suggestions retain separate settings and schedule keys', () => {
  const bugs = { guild_id: '9', daily_time: '08:00' };
  const suggestions = { guild_id: '9', report_type: 'suggestions', daily_time: '09:00' };
  const configs = { [reportKey(bugs)]: bugs, [reportKey(suggestions)]: suggestions };
  assert.deepEqual(Object.keys(configs), ['9', '9:suggestions']);
  assert.equal(findReport(configs, '9'), bugs);
  assert.equal(findReport(configs, '9', 'suggestions'), suggestions);
  assert.equal(findReport(configs, 'other'), undefined);
});

test('suggestions need no Squashed tag and only management replies count', async () => {
  const config = { guild_id: '9', forum_channel_id: '8', report_type: 'suggestions', staff_role_ids: ['owner'] };
  const rest = { get: async path => {
    if (path === '/channels/8') return { type: 15, guild_id: '9', available_tags: [] };
    if (path.includes('/active')) return { threads: [{ id: '1', parent_id: '8', name: 'Staff reviewed' }] };
    if (path.includes('/archived/')) return { threads: [{ id: '2', name: 'Owner reviewed' }], has_more: false };
    if (path === '/channels/1/messages') return [{ id: '11', author: { id: 'staff' } }];
    if (path === '/channels/2/messages') return [{ id: '12', author: { id: 'manager' } }];
    if (path.endsWith('/members/staff')) return { roles: ['staff'] };
    if (path.endsWith('/members/manager')) return { roles: ['owner'] };
    throw new Error(`Unexpected request: ${path}`);
  } };
  const text = (await worklist(rest, config)).join('\n');
  assert.match(text, /Daily suggestions worklist/);
  assert.match(text, /Awaiting management review \(1\)\*\*\n- \[Staff reviewed\]/);
  assert.match(text, /Feedback received \(1\)\*\*\n- \[Owner reviewed\]/);
});
