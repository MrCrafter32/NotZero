import {
  Client, GatewayIntentBits, Events, SlashCommandBuilder, InteractionContextType,
  PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { centralDate, parseTime, sendWorklist } from './worklist.js';
import { startHourlyPing, sendPing, pingThreadId } from './hourly-ping.js';

const file = name => fileURLToPath(new URL(name, import.meta.url));
function read(name) {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
function save(name, data) {
  writeFileSync(file(`${name}.tmp`), JSON.stringify(data, null, 2));
  renameSync(file(`${name}.tmp`), file(name));
}
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('Set DISCORD_BOT_TOKEN in .env or your environment.');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const sessions = new Map();
const setup = new SlashCommandBuilder().setName('setup')
  .setDescription('Choose bug forum, worklist channel, staff roles and daily time')
  .setContexts(InteractionContextType.BotDM);
const worklistCommand = new SlashCommandBuilder().setName('worklist')
  .setDescription('Send a fresh bug worklist to the configured report channel')
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);
const sending = new Set();
const pingCommand = new SlashCommandBuilder().setName('ping')
  .setDescription('Send a test ping in the hourly ping thread')
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);
async function sendFresh(config) {
  if (sending.has(config.guild_id)) throw new Error('A worklist is already being generated for this server.');
  sending.add(config.guild_id);
  try { await sendWorklist(client.rest, config); }
  finally { sending.delete(config.guild_id); }
}
const canManage = async (guild, user) => (await guild.members.fetch({ user, force: true })).permissions.has(PermissionFlagsBits.ManageGuild);

function menu(s) {
  const options = s.options.slice(s.page * 25, (s.page + 1) * 25);
  const select = new StringSelectMenuBuilder().setCustomId(`${s.id}:choose`)
    .setPlaceholder(s.title).setMinValues(s.step === 'roles' ? 0 : 1)
    .setMaxValues(s.step === 'roles' ? options.length : 1)
    .addOptions(options.map(o => ({ label: o.label.slice(0, 100), value: o.value, default: s.selected.has(o.value) })));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${s.id}:prev`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(s.page === 0),
    new ButtonBuilder().setCustomId(`${s.id}:next`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled((s.page + 1) * 25 >= s.options.length),
  );
  if (s.step === 'roles') buttons.addComponents(new ButtonBuilder().setCustomId(`${s.id}:done`).setLabel('Use selected roles').setStyle(ButtonStyle.Primary));
  return { content: `${s.title} — page ${s.page + 1}/${Math.ceil(s.options.length / 25)}` +
    (s.step === 'roles' ? `\n${s.selected.size} staff roles selected. Selections carry across pages.` : ''),
    components: [new ActionRowBuilder().addComponents(select), buttons], allowedMentions: { parse: [] } };
}
function next(s, step, title, options) {
  if (!options.length) throw new Error('No matching choices. Check the server channels and roles, then run /setup again.');
  Object.assign(s, { step, title, options, page: 0, selected: new Set() });
  return menu(s);
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'ping') {
      await i.deferReply(i.inGuild() ? { flags: 64 } : {});
      await sendPing(client.rest);
      await i.editReply({
        content: `Test ping sent in <#${pingThreadId}>.`,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (i.isChatInputCommand() && i.commandName === 'worklist') {
      await i.deferReply(i.inGuild() ? { flags: 64 } : {});
      const configs = read('servers.json');
      if (i.inGuild()) {
        const guild = await client.guilds.fetch(i.guildId);
        const config = configs[i.guildId];
        if (!config) throw new Error('DM me /setup to configure this server first.');
        if (i.channelId !== config.output_channel_id) throw new Error('Use /worklist in the configured report channel.');
        if (!await canManage(guild, i.user.id)) throw new Error('Manage Server permission is required.');
        await sendFresh(config);
        await i.editReply('Fresh worklist posted in this channel.');
      } else {
        const options = [];
        for (const guild of client.guilds.cache.values()) {
          if (!configs[guild.id]) continue;
          try { if (await canManage(guild, i.user.id)) options.push({ label: guild.name, value: guild.id }); }
          catch (error) { if (error.status !== 404 && error.status !== 403) throw error; }
        }
        if (!options.length) throw new Error('No configured servers you can manage. Use /setup first.');
        if (options.length === 1) {
          const config = configs[options[0].value];
          await sendFresh(config);
          await i.editReply({content: `Fresh worklist posted in <#${config.output_channel_id}>.`, allowedMentions: {parse: []}});
        } else {
          const session = {id: randomUUID(), user: i.user.id, expires: Date.now() + 15 * 60000};
          sessions.set(i.user.id, session);
          await i.editReply(next(session, 'run', 'Choose the server for a fresh worklist', options));
        }
      }
      return;
    }
    if (i.isChatInputCommand() && i.commandName === 'setup') {
      await i.deferReply();
      const options = [];
      for (const guild of client.guilds.cache.values()) {
        try { if (await canManage(guild, i.user.id)) options.push({ label: guild.name, value: guild.id }); }
        catch (error) { if (error.status !== 404 && error.status !== 403) throw error; }
      }
      if (!options.length) throw new Error('Invite me to your server with bot and applications.commands scopes, and make sure you have Manage Server permission.');
      // A new wizard invalidates older menus for this user.
      const s = { id: randomUUID(), user: i.user.id, expires: Date.now() + 15 * 60000,
        config: { timezone: 'Etc/GMT+6', resolved_tag_names: ['Squashed'], unanswered_mode: 'staff', staff_user_ids: [] } };
      sessions.set(i.user.id, s);
      await i.editReply(next(s, 'server', 'Choose your server', options));
      return;
    }
    if (!i.isMessageComponent() && !i.isModalSubmit()) return;
    const s = sessions.get(i.user.id);
    const [id, action] = i.customId.split(':');
    if (!s || s.id !== id || s.expires < Date.now()) {
      await i.reply({ content: 'Setup expired. DM me /setup again.' });
      return;
    }
    s.expires = Date.now() + 15 * 60000;
    if (action === 'time') {
      if (s.step !== 'time') throw new Error('Run /setup again.');
      const input = new TextInputBuilder().setCustomId('daily_time').setLabel('Daily time HH:MM, fixed UTC−6').setStyle(TextInputStyle.Short).setPlaceholder('18:00').setMaxLength(5).setRequired(true);
      await i.showModal(new ModalBuilder().setCustomId(`${s.id}:save`).setTitle('Daily worklist time').addComponents(new ActionRowBuilder().addComponents(input)));
      return;
    }
    if (action === 'save' && i.isModalSubmit()) {
      if (s.step !== 'time') throw new Error('Run /setup again.');
      const dailyTime = parseTime(i.fields.getTextInputValue('daily_time'));
      await i.deferReply();
      if (!await canManage(s.guild, i.user.id)) throw new Error('Manage Server permission is required.');
      const forum = await s.guild.channels.fetch(s.config.forum_channel_id, { force: true });
      const output = await s.guild.channels.fetch(s.config.output_channel_id, { force: true });
      const me = await s.guild.members.fetchMe();
      if (forum?.type !== ChannelType.GuildForum || output?.type !== ChannelType.GuildText) throw new Error('Selected channels changed. Run /setup again.');
      if (!forum.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]) ||
          !output.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw new Error('Give me View Channel and Read Message History in the forum, and View Channel and Send Messages in the worklist channel. Then try again.');
      if (!forum.availableTags.some(t => t.name.toLowerCase() === 'squashed')) throw new Error('Add a Squashed tag to the bug forum, then try again.');
      const roles = await s.guild.roles.fetch();
      if (!s.config.staff_role_ids.every(role => roles.has(role))) throw new Error('A role was deleted. Run /setup again.');
      s.config.daily_time = dailyTime;
      const configs = read('servers.json');
      configs[s.guild.id] = s.config;
      save('servers.json', configs);
      sessions.delete(i.user.id);
      await i.editReply({ content: `Saved! Bugs: <#${forum.id}>. Worklist: <#${output.id}>.\nStaff roles: ${s.config.staff_role_ids.map(r => `<@&${r}>`).join(', ')}\nDaily at **${dailyTime}, fixed UTC−6** (no daylight saving).\nUnanswered means no staff reply. Squashed reports are skipped.\nIf today's time has passed, the worklist will be sent shortly.`, allowedMentions: { parse: [] } });
      return;
    }
    if (s.step === 'time') throw new Error('Use Set daily time to continue.');
    if (action === 'prev' || action === 'next') {
      s.page = Math.max(0, Math.min(Math.ceil(s.options.length / 25) - 1, s.page + (action === 'next' ? 1 : -1)));
      await i.update(menu(s)); return;
    }
    if (action === 'choose' && i.isStringSelectMenu()) {
      const allowed = new Set(s.options.slice(s.page * 25, (s.page + 1) * 25).map(o => o.value));
      if (!i.values.every(value => allowed.has(value))) throw new Error('Invalid selection. Run /setup again.');
      if (s.step === 'roles') {
        for (const value of allowed) s.selected.delete(value);
        for (const value of i.values) s.selected.add(value);
        await i.update(menu(s)); return;
      }
      await i.deferUpdate();
      if (s.step === 'run') {
        const guild = client.guilds.cache.get(i.values[0]);
        if (!guild || !await canManage(guild, i.user.id)) throw new Error('Manage Server permission is required.');
        const config = read('servers.json')[guild.id];
        if (!config) throw new Error('Use /setup first.');
        sessions.delete(i.user.id);
        await i.editReply({content: 'Generating a fresh worklist...', components: []});
        await sendFresh(config);
        await i.editReply({content: `Fresh worklist posted in <#${config.output_channel_id}>.`, components: [], allowedMentions: {parse: []}});
        return;
      }
      if (s.step === 'server') {
        s.guild = client.guilds.cache.get(i.values[0]);
        if (!s.guild || !await canManage(s.guild, i.user.id)) throw new Error('Manage Server permission is required.');
        s.config.guild_id = s.guild.id;
        s.channels = await s.guild.channels.fetch();
        await i.editReply(next(s, 'forum', 'Choose the bugs forum', [...s.channels.values()].filter(c => c?.type === ChannelType.GuildForum).map(c => ({ label: `#${c.name}`, value: c.id }))));
      } else if (s.step === 'forum') {
        s.config.forum_channel_id = i.values[0];
        await i.editReply(next(s, 'output', 'Choose the worklist text channel', [...s.channels.values()].filter(c => c?.type === ChannelType.GuildText).map(c => ({ label: `#${c.name}`, value: c.id }))));
      } else if (s.step === 'output') {
        s.config.output_channel_id = i.values[0];
        const roles = await s.guild.roles.fetch();
        await i.editReply(next(s, 'roles', 'Choose all staff roles', [...roles.values()].filter(r => r.id !== s.guild.id && !r.managed).map(r => ({ label: r.name, value: r.id }))));
      }
      return;
    }
    if (action === 'done' && s.step === 'roles') {
      if (!s.selected.size) throw new Error('Choose at least one staff role.');
      s.config.staff_role_ids = [...s.selected];
      s.step = 'time';
      await i.update({ content: 'Choose the daily time in fixed UTC−6.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${s.id}:time`).setLabel('Set daily time').setStyle(ButtonStyle.Primary))] });
    }
  } catch (error) {
    console.error('Command failed:', error.message);
    const message = { content: error.message, allowedMentions: { parse: [] } };
    try {
      if (i.deferred) await i.editReply(message);
      else if (i.replied) await i.followUp(message);
      else await i.reply(message);
    } catch (replyError) { console.error('Could not reply:', replyError.message); }
  }
});

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    for (const [user, session] of sessions) if (session.expires < Date.now()) sessions.delete(user);
    const configs = read('servers.json');
    const state = read('daily-state.json');
    for (const [guild, config] of Object.entries(configs)) {
      const now = centralDate();
      const entry = state[guild] ?? {};
      if (now.time < config.daily_time || entry.last_success === now.day || Date.now() < (entry.retry_after ?? 0)) continue;
      try {
        await sendFresh(config);
        state[guild] = { last_success: now.day };
        console.log(`Sent daily worklist for ${guild}`);
      } catch (error) {
        console.error(`Worklist failed for ${guild}:`, error.message);
        state[guild] = { ...entry, retry_after: Date.now() + 300000 };
      }
      save('daily-state.json', state);
    }
  } catch (error) { console.error('Scheduler:', error.message); }
  finally { running = false; }
}
client.once(Events.ClientReady, async () => {
  startHourlyPing(client.rest);
  try {
    // Upsert only this command, preserving any unrelated application commands.
    await client.application.commands.create(setup.toJSON());
    await client.application.commands.create(worklistCommand.toJSON());
    await client.application.commands.create(pingCommand.toJSON());
    for (const guildId of Object.keys(read('servers.json'))) {
      const { contexts, integration_types, ...guildCommand } = worklistCommand.toJSON();
      await client.application.commands.create(guildCommand, guildId);
      const { contexts: pingContexts, integration_types: pingIntegrationTypes, ...guildPingCommand } = pingCommand.toJSON();
      await client.application.commands.create(guildPingCommand, guildId);
    }
    console.log(`Ready as ${client.user.tag}. DM /setup or use /worklist in the report channel.`);
    await tick();
    setInterval(tick, 20000);
  } catch (error) { console.error('Startup failed:', error.message); client.destroy(); process.exitCode = 1; }
});
client.on(Events.Error, error => console.error('Discord:', error.message));
client.login(token).catch(error => { console.error('Login failed:', error.message); process.exitCode = 1; });
