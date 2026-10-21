export function parseTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use 24-hour HH:MM, for example 18:00.');
  return value;
}

export function centralDate(now = new Date()) {
  const iso = new Date(now.getTime() - 6 * 3600000).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export async function threads(rest, config) {
  const active = await rest.get(`/guilds/${config.guild_id}/threads/active`);
  const found = new Map(active.threads.filter(t => t.parent_id === config.forum_channel_id).map(t => [t.id, t]));
  let before;
  for (;;) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const page = await rest.get(`/channels/${config.forum_channel_id}/threads/archived/public`, { query });
    for (const thread of page.threads) found.set(thread.id, thread);
    if (!page.has_more) break;
    const next = page.threads.at(-1)?.thread_metadata.archive_timestamp;
    if (!next || next === before) throw new Error('Incomplete archive page');
    before = next;
  }
  return [...found.values()];
}

export async function answered(rest, config, thread, cache) {
  let before;
  for (;;) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const messages = await rest.get(`/channels/${thread.id}/messages`, { query });
    for (const m of messages) {
      if (m.id === thread.id || m.author.bot || m.webhook_id || ![0, 19].includes(m.type ?? 0)) continue;
      if ((config.staff_user_ids ?? []).includes(m.author.id)) return true;
      if (!cache.has(m.author.id)) {
        try {
          cache.set(m.author.id, await rest.get(`/guilds/${config.guild_id}/members/${m.author.id}`));
        } catch (error) {
          if (error.status !== 404) throw error;
          cache.set(m.author.id, { roles: [] });
        }
      }
      if (cache.get(m.author.id).roles.some(role => config.staff_role_ids.includes(role))) return true;
    }
    if (messages.length < 100) return false;
    before = messages.at(-1).id;
  }
}

export async function worklist(rest, config) {
  const forum = await rest.get(`/channels/${config.forum_channel_id}`);
  if (forum.type !== 15 || forum.guild_id !== config.guild_id) throw new Error('Source must be a forum in the configured server');
  const names = (config.resolved_tag_names ?? ['Squashed']).map(n => n.toLowerCase());
  const resolved = new Set(forum.available_tags.filter(t => names.includes(t.name.toLowerCase())).map(t => t.id));
  if (!resolved.size) throw new Error('Add a Squashed tag to the forum');
  const groups = [[], []];
  const cache = new Map();
  const all = (await threads(rest, config)).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  for (const thread of all) {
    if (thread.applied_tags?.some(tag => resolved.has(tag))) continue;
    const title = thread.name.replace(/[\[\]\\*_`~<>@\r\n]/g, '').slice(0, 150);
    const hasReply = await answered(rest, config, thread, cache);
    groups[Number(hasReply)].push(`- [${title}](https://discord.com/channels/${config.guild_id}/${thread.id})`);
  }
  const lines = ['**Daily bug worklist**', 'Open means no resolved tag; archived posts are included.'];
  ['Awaiting a staff reply', 'Open — staff already replied'].forEach((label, i) => {
    lines.push(`\n**${label} (${groups[i].length})**`, ...(groups[i].length ? groups[i] : ['None.']));
  });
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > 1900) {
      chunks.push(current);
      current = '**Bug worklist — continued**\n';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendWorklist(rest, config) {
  const chunks = await worklist(rest, config);
  for (const content of chunks) await rest.post(`/channels/${config.output_channel_id}/messages`, {
    body: { content, allowed_mentions: { parse: [] } },
  });
}
