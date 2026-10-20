import { ChannelType, PermissionFlagsBits } from "discord-api-types/v10";
import type { Channel, Roles } from "./models.ts";

export function visibleChannels(
  channels: readonly Channel[],
  roles: typeof Roles.Type,
  memberRoles: readonly string[],
  guildId: string,
  botId: string,
) {
  const base = roles
    .filter((role) => role.id === guildId || memberRoles.includes(role.id))
    .reduce((permissions, role) => permissions | BigInt(role.permissions), 0n);
  if (base & PermissionFlagsBits.Administrator) return channels;
  const visible = channels.filter((channel) => {
    let permissions = base;
    const overwrites = channel.permission_overwrites ?? [];
    for (const group of [
      overwrites.filter((entry) => entry.type === 0 && entry.id === guildId),
      overwrites.filter((entry) => entry.type === 0 && memberRoles.includes(entry.id)),
      overwrites.filter((entry) => entry.type === 1 && entry.id === botId),
    ]) {
      const allow = group.reduce((bits, entry) => bits | BigInt(entry.allow), 0n);
      const deny = group.reduce((bits, entry) => bits | BigInt(entry.deny), 0n);
      permissions = (permissions & ~deny) | allow;
    }
    return !!(permissions & PermissionFlagsBits.ViewChannel);
  });
  return channels.filter(
    (channel) =>
      visible.includes(channel) ||
      (channel.type === ChannelType.GuildCategory &&
        visible.some((child) => child.parent_id === channel.id)),
  );
}
