export const pingThreadId = '1562214903090253844';
export const pingUserId = '316403263559827457';

export async function sendPing(rest) {
  await rest.post(`/channels/${pingThreadId}/messages`, {
    body: {
      content: `<@${pingUserId}>`,
      allowed_mentions: { parse: [], users: [pingUserId] },
    },
  });
}

// Use the machine's local clock: 08:00, 09:00, etc.
export function nextHour(now = new Date()) {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
}

export function startHourlyPing(rest) {
  function schedule() {
    const due = nextHour();
    setTimeout(async () => {
      try {
        await sendPing(rest);
        console.log('Sent hourly ping');
      } catch (error) {
        console.error('Hourly ping failed:', error.message);
      } finally {
        schedule();
      }
    }, due.getTime() - Date.now());
  }
  schedule();
}
