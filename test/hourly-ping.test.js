import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHour, startHourlyPing } from '../hourly-ping.js';

test('next local hour aligns to :00 and rolls over midnight', () => {
  const now = new Date(2026, 9, 21, 23, 42, 15);
  assert.equal(nextHour(now).getTime(), new Date(2026, 9, 22, 0, 0, 0).getTime());
  assert.equal(nextHour(new Date(2026, 9, 21, 8)).getHours(), 9);
});

test('hourly job sends only the authorized mention and schedules again after failure', async t => {
  let callback;
  let schedules = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    callback = fn;
    schedules++;
    assert.ok(delay > 0 && delay <= 3600000);
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const sent = [];
  startHourlyPing({ post: async (path, options) => {
    sent.push({ path, ...options.body });
    if (sent.length === 2) throw new Error('Unavailable');
  } });
  assert.equal(sent.length, 0);
  await callback();
  assert.deepEqual(sent[0], {
    path: '/channels/1562214903090253844/messages',
    content: '<@316403263559827457>',
    allowed_mentions: { parse: [], users: ['316403263559827457'] },
  });
  await callback();
  assert.equal(schedules, 3);
});
