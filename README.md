# Discord bug worklist — Node.js

Scans your bugs forum daily, including archived posts. Reports tagged **Squashed** are skipped. The worklist groups open reports into **awaiting a staff reply** and **staff already replied**, oldest first, with links. The bot does not edit posts or send pings.

## Start

Use **Node.js 22.12 or newer**.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Keep its token private.
2. Invite it with the **bot** and **applications.commands** scopes. Give it **View Channel** and **Read Message History** in the forum, and **View Channel** and **Send Messages** in the destination text channel. Leave the Interactions Endpoint URL blank. No privileged intents are needed.
3. In this folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` locally and put your bot token after `DISCORD_BOT_TOKEN=`. Then:

```powershell
npm start
```

4. Open a DM with the bot and use **/setup** from the slash command menu. Choose your server, bugs forum, worklist text channel, and all staff roles. Long lists have Previous/Next buttons. Role selections carry across pages; press **Use selected roles** when finished.
5. Press **Set daily time** and enter a 24-hour time such as `18:00`. The timezone is **fixed UTC−6** year-round with no daylight saving changes. You need **Manage Server** permission. The forum must have a `Squashed` tag before saving.

No channel or role IDs need to be copied. Run `/setup` again to replace settings for a server. Multiple servers are supported. Global slash commands may take a little time to appear after first launch; if missing, check command installation scope and DM context in the Developer Portal.

## Daily behavior

Unanswered means no human reply by someone with a selected staff role. A staff reply does not resolve a report; only the Squashed tag does. Starter posts, bots, webhooks and system messages do not count. Staff membership is checked at scan time; departed staff may no longer be recognized. Deleted posts cannot be included.

Keep one instance running on an always-on machine. Closing the terminal or sleeping the computer stops it. The schedule is checked every 20 seconds. Starting late catches up for today; success is recorded in `daily-state.json`. If setup finishes after today's selected time, today's worklist is sent shortly unless already sent. Failures retry after five minutes. A partially sent multi-message worklist may repeat earlier parts on retry.

Inaccessible reports fail a run rather than silently producing an incomplete worklist. All archive and message pages are checked; large forums may take time. discord.js handles API rate limits. Setup sessions expire after 15 minutes of inactivity and are lost on restart; use `/setup` again.

Settings are stored in `servers.json`. Existing settings saved through the earlier Python DM wizard are compatible. Tokens stay in `.env` or the `DISCORD_BOT_TOKEN` environment variable. Local configuration and token files are ignored by Git. Python is no longer required.

## Test

```powershell
npm test
```

Built with [discord.js](https://discord.js.org/docs/packages/discord.js/14.25.1). Reference: [Discord application commands](https://docs.discord.com/developers/interactions/slash-commands).

## Send another report now

Use **/worklist** in the configured report channel to post a fresh report there, or DM the bot `/worklist`. You need Manage Server permission. In DMs, choose a server if you manage more than one configured server. Manual reports do not change the daily schedule. Restart the bot after updating so it registers the new command.
