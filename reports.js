export const reportType = config => config.report_type ?? 'bugs';
export const reportKey = config => reportType(config) === 'bugs'
  ? config.guild_id : `${config.guild_id}:suggestions`;
export const reportLabel = config => reportType(config) === 'suggestions' ? 'Suggestions' : 'Bugs';

export function findReport(configs, guildId, type = 'bugs') {
  return Object.values(configs).find(c => c.guild_id === guildId && reportType(c) === type);
}
