import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getAppSetting, getBoolSetting, setAppSetting } from '../db/appSettings.js';
import { getGuildSettings } from '../db/guilds.js';
import { isDj, replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { loopLabel, loopStateOf } from '../music/loop.js';
import { autoplayKey, filterKey, getPlayer, persistModifiersKey } from '../music/QueueManager.js';
import { sponsorBlockKey } from '../music/sponsorblock.js';

/**
 * /modifiers — one place to SEE every active playback modifier (autoplay, loop,
 * filter, SponsorBlock, 24/7, volume) and to control whether they PERSIST.
 *
 * By default modifiers are session-only: a fresh join/restart starts clean.
 * `/modifiers persist:on` (DJ) makes the bot remember the filter + SponsorBlock
 * across leaves/restarts; autoplay always resets on leave regardless.
 */
const onOff = (on: boolean): string => (on ? '🟢 On' : '⚪ Off');

export const modifiers: Command = {
  data: new SlashCommandBuilder()
    .setName('modifiers')
    .setDescription('View active modifiers (autoplay, filter, …) and toggle persistence.')
    .addStringOption((opt) =>
      opt
        .setName('persist')
        .setDescription('Keep filter/SponsorBlock across restarts & leaves (DJ only).')
        .addChoices(
          { name: 'on — remember filter & SponsorBlock after the bot leaves', value: 'on' },
          { name: 'off — start clean every session (default)', value: 'off' },
        ),
    ),
  cooldownMs: 0,
  async execute(interaction) {
    const guildId = interaction.guildId!;

    // Optional: flip the persistence switch (DJ-gated). Viewing is open to all.
    const persistArg = interaction.options.getString('persist');
    if (persistArg) {
      if (!(await isDj(interaction))) {
        await replyError(interaction, 'You need the DJ role to change modifier persistence.');
        return;
      }
      await setAppSetting(persistModifiersKey(guildId), persistArg === 'on' ? 'on' : 'off');
    }

    const persist =
      (await getAppSetting(persistModifiersKey(guildId)).catch(() => undefined)) === 'on';
    const player = getPlayer(interaction);

    // Saved (would-restore) values, used when there's no live player to read.
    const savedFilter = await getAppSetting(filterKey(guildId)).catch(() => undefined);
    const savedSponsor =
      (await getAppSetting(sponsorBlockKey(guildId)).catch(() => undefined)) === 'on';
    const savedAutoplay = await getBoolSetting(autoplayKey(guildId), false).catch(() => false);
    const has247 = !!(await getAppSetting(`247state:${guildId}`).catch(() => undefined));

    // Live player state wins; otherwise show what a fresh join would apply
    // (the saved values only when persistence is on, defaults when it's off).
    const autoplay = player ? !!player.get<boolean>('autoplay') : persist && savedAutoplay;
    const loop = player ? loopStateOf(player) : 'off';
    const filterName = player
      ? player.get<string | undefined>('filter')
      : persist && savedFilter && savedFilter !== 'off'
        ? savedFilter
        : undefined;
    const sponsor = player ? !!player.get<boolean>('sponsorblock') : persist && savedSponsor;
    const nonStop = player ? !!player.get<boolean>('247') : has247;
    const volume = player ? player.volume : (await getGuildSettings(guildId)).defaultVolume;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎚️ Playback modifiers')
      .setDescription(
        player
          ? 'Active in this session:'
          : 'No active player — showing what a new session would start with:',
      )
      .addFields(
        { name: '♾️ Autoplay', value: onOff(autoplay), inline: true },
        { name: '🔁 Loop', value: loop === 'off' ? '⚪ Off' : loopLabel(loop), inline: true },
        { name: '🎛️ Filter', value: filterName ? `🟢 ${filterName}` : '⚪ None', inline: true },
        { name: '⏭️ SponsorBlock', value: onOff(sponsor), inline: true },
        { name: '📌 24/7', value: onOff(nonStop), inline: true },
        { name: '🔊 Volume', value: `${volume}%`, inline: true },
      )
      .setFooter({
        text: persist
          ? 'Persistence ON — filter & SponsorBlock are restored when the bot rejoins (autoplay always resets on leave).'
          : 'Persistence OFF — every session starts clean. Turn on with /modifiers persist:on.',
      });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
