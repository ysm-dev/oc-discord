# oc-discord

An OpenCode v2 Agent that acts in Discord. Each @mention starts a fresh Session; the Agent replies, reacts, starts threads, searches, or uploads files through eleven Discord tools.

Requires Bun 1.4.3+, OpenCode v2 (tested with 2.0.32), and a Discord Bot.

```sh
export OPENCODE_URL=http://127.0.0.1:4096
export OPENCODE_PASSWORD='your-server-password'
export DISCORD_BOT_TOKEN='your-bot-token'
bunx oc-discord
```

Create `~/discord-bot` on the OpenCode machine first. For Docker or remote servers, set `--directory` and `--bridge-url` explicitly. Run `bunx oc-discord --help` for every setting.

See the [setup guide](https://github.com/ysm-dev/oc-discord#readme) for exact Discord permissions, Docker instructions, configuration, and operation.
