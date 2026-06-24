import { SlashCommandBuilder } from 'discord.js';
import { getAppSetting, setAppSetting } from '../db/appSettings.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';
import { DEFAULT_SEGMENTS, applySponsorBlock, sponsorBlockKey } from '../music/sponsorblock.js';

/**
 * /sponsorblock — skip the non-music bits (sponsor reads, intros/outros, and
 * off-topic talking) inside YouTube tracks, via the Lavalink SponsorBlock
 * plugin. Per-guild, persisted, and applied immediately to the live player as
 * well as every future one (see ensurePlayer).
 */
export const sponsorblock: Command = {
  data: new SlashCommandBuilder()
    .setName('sponsorblock')
    .setDescription('Skip sponsor/intro/off-topic segments in tracks (per server).')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Turn segment-skipping on or off (default: toggle).')
        .addChoices(
          { name: 'on — skip sponsor/intro/outro/off-topic', value: 'on' },
          { name: 'off — play tracks untouched', value: 'off' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change SponsorBlock.');
      return;
    }

    const guildId = interaction.guildId!;
    const current = (await getAppSetting(sponsorBlockKey(guildId)).catch(() => undefined)) === 'on';
    const mode = interaction.options.getString('mode');
    const enabled = mode ? mode === 'on' : !current;

    await setAppSetting(sponsorBlockKey(guildId), enabled ? 'on' : 'off');
    const player = getPlayer(interaction);
    if (player) await applySponsorBlock(player, enabled);

    await replyOk(
      interaction,
      enabled
        ? `⏭️ **SponsorBlock on** — skipping ${DEFAULT_SEGMENTS.length} segment types ` +
            '(sponsor, self-promo, interaction, intro, outro, off-topic music).'
        : '▶️ **SponsorBlock off** — tracks play untouched.',
    );
  },
};
