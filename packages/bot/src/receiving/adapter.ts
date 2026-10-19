import { DiscordAdapter } from "@chat-adapter/discord";

export class ReceivingAdapter extends DiscordAdapter {
  protected override async createDiscordThread(channelId: string, _messageId: string) {
    return { id: channelId, name: "" };
  }
}
