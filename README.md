# oc-discord

An OpenCode v2 Agent that acts in Discord. Every @mention starts a fresh, parallel Session with a transcript of the conversation. The Agent can reply, react, start threads, search history, and upload files. Only its `discord_*` Actions reach Discord; plain answers stay in OpenCode.

## Quick start

Requires [**Bun 1.4.3+**](https://bun.sh/docs/installation), an [**OpenCode v2**](https://opencode.ai/v2/docs/) server (tested with **2.0.32**), and a Discord Bot. Check `opencode --version`: OpenCode v1 is unsupported. The [Docker setup](#docker-or-a-remote-opencode-server) provides a pinned v2 server without a host installation.

1. [Set up the Bot](#discord-setup).
2. On the OpenCode machine, create the Session directory, run `opencode auth login` and connect OpenCode Go with your API key for the default model, then start the server:

   ```sh
   mkdir -p ~/discord-bot
   export OPENCODE_PASSWORD='your-server-password'
   opencode serve --hostname 127.0.0.1 --port 4096
   ```

3. In another terminal on the same machine, start the Bridge:

   ```sh
   export OPENCODE_URL=http://127.0.0.1:4096
   export OPENCODE_PASSWORD='your-server-password'
   export DISCORD_BOT_TOKEN='your-bot-token'
   bunx oc-discord
   ```

4. Mention the Bot in a channel it can see. Use `bunx oc-discord --help` for all settings or `--version` for the installed version.

The initial release is `0.1.0`. To run from this checkout before publication, use `bun install` then `bun packages/bot/src/index.ts` with the same environment.

## Discord setup

In the [Discord developer portal](https://discord.com/developers/applications), create an application and configure:

- **Bot → Message Content Intent: on.**
- **Bot → Public Bot: off.**
- **General Information → Interactions Endpoint URL: empty.**
- Copy the Bot token into `DISCORD_BOT_TOKEN`.

Invite it with the **bot** OAuth2 scope and these permissions:

- View Channels
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Read Message History
- Add Reactions
- Attach Files
- Embed Links

Channel overrides must also allow these permissions. DMs, edits, role pings, `@everyone`, and `@here` do not trigger Sessions. Replying to the Bot with the reply ping enabled does.

## Settings

Flags override environment variables. Keep credentials in the environment to avoid putting them in command arguments.

| Flag                  | Environment variable    | Default                   |
| --------------------- | ----------------------- | ------------------------- |
| `--opencode-url`      | `OPENCODE_URL`          | required                  |
| `--opencode-password` | `OPENCODE_PASSWORD`     | required                  |
| `--discord-bot-token` | `DISCORD_BOT_TOKEN`     | required                  |
| `--directory`         | `OC_DISCORD_DIRECTORY`  | `~/discord-bot`           |
| `--history`           | `OC_DISCORD_HISTORY`    | `50`                      |
| `--port`              | `OC_DISCORD_PORT`       | `4097`                    |
| `--host`              | `OC_DISCORD_HOST`       | `127.0.0.1`               |
| `--bridge-url`        | `OC_DISCORD_BRIDGE_URL` | `http://127.0.0.1:<port>` |

`~` expands on the **Bridge's** machine. The resulting absolute directory must already exist on the **OpenCode** machine. The password is the server's `OPENCODE_PASSWORD`; the username is always `opencode`.

### Session directory

At startup the Bridge checks OpenCode v2, directory visibility, Bot credentials, and plugin readiness. It writes these files through OpenCode's file API:

- `AGENTS.md`: short instructions explaining that only Actions reach people.
- `opencode.jsonc`: a noninteractive permission policy. It disables `question`, denies reading `.env` files (except `.env.example`), and denies external-directory file access. Shell commands remain available for downloads and file generation.
- `.opencode/plugins/oc-discord.ts`: the eleven direct Discord tools, refreshed on every startup.

The first two files belong to the operator after creation; edits survive restarts. Delete one and restart to restore its default. The default model is `opencode-go/deepseek-v4.1-flash`; connect OpenCode Go with your API key in OpenCode. Override the model and agent in `opencode.jsonc` using [OpenCode's model configuration](https://opencode.ai/v2/docs/models/#defaults). Keep permission rules `allow` or `deny`: nobody in Discord can answer `ask`.

The default instructions ask the Agent to behave like a server member, keep replies concise unless asked for detail, call `discord_typing` before replying, and download attachments into the Session directory before opening them with `read`.

### Docker or a remote OpenCode server

From this checkout, the included `compose.yaml` pins OpenCode to `2.0.32`. It bind-mounts the host's `~/discord-bot` at the **same absolute path** inside the container, so the Bridge's default directory works. OpenCode data persists in a named volume.

```sh
export OPENCODE_PASSWORD='your-server-password'
mkdir -p "$HOME/discord-bot"
docker compose up -d
docker compose exec opencode opencode auth login
export OPENCODE_URL=http://127.0.0.1:4096
export DISCORD_BOT_TOKEN='your-bot-token'
bunx oc-discord --host 0.0.0.0 --bridge-url http://host.docker.internal:4097
```

Choose OpenCode Go in the login prompt and enter your API key. To use another Session directory, set `OC_DISCORD_DIRECTORY` to an **absolute host path** and create it before starting Compose; the same environment variable configures the Bridge. Compose requires the directory to exist and mounts it at that identical path.

The host-gateway mapping in Compose supports Linux as well as Docker Desktop. On Linux the Bridge must listen beyond localhost, as `--host 0.0.0.0` does above. OpenCode must be able to reach `--bridge-url`; `host.docker.internal` points back to the host. For a remote server, substitute a reachable Bridge address and an absolute directory on that server.

After the first Bridge startup, edit `opencode.jsonc` directly in the host's Session directory and restart the Bridge. List available models with `docker compose exec opencode opencode models --server http://127.0.0.1:4096`.

### Operation

Run one Bridge process per Bot. Each Mention gets its own key and Session, confined to its originating server. The Discord token remains in the Bridge; plugins upload local file bytes using Session authentication.

OpenCode's permissions are the Agent's safeguard; keep them appropriate for your server. File-tool restrictions do not sandbox shell commands. Run OpenCode in Docker to contain the Agent, exposing only the files it needs through mounts.

Typing renews every eight seconds after the Agent requests it, until the Bot posts or the Session ends. Messages longer than 2,000 characters are split; uploads allow at most ten files of 20 MiB each. Sends can ping explicitly named users and reply recipients, but never roles or global mentions.

Logs contain Session starts, outcomes, Discord IDs, and status-based error hints, without message text or credentials. Inspect failed Sessions in OpenCode for detailed provider errors. Sessions remain there after completion. Stopping the Bridge does not interrupt them; their tools work again after restarting at the same callback address. Gateway and event-stream drops reconnect automatically, with outcome catch-up after an event reconnect.

## Development and verification

```sh
bun install --frozen-lockfile
bun run ci
bun run e2e
```

CI runs hermetic network-fake tests under Node/Vitest. The separate E2E command needs Docker and runs the real pinned OpenCode with a scripted model and HTTP-served fake Discord; it needs no provider credentials. It checks direct tool registration, absence of `question`, typing, file upload, and that plain answers are never posted. Its disposable container is removed afterward.

Before release, complete the [real-Guild smoke checklist](docs/smoke-test.md). See [releasing](docs/releasing.md) for version tags and npm trusted publishing.

## Layout

```
packages/bot/src/       Published Bun CLI; domain modules, no build step.
packages/bot/test/      In-memory network fakes and real-OpenCode Docker E2E.
docs/adr/              Domain decisions; vocabulary lives in GLOSSARY.md.
scripts/               Repo tooling: CI runner, exceptions report, gate verification.
quality-exceptions.json  The only place file-level gate exceptions may live.
```

## The gates

| Gate                  | Threshold      | Command                           |
| --------------------- | -------------- | --------------------------------- |
| Formatting            | clean          | `bun run format:check`            |
| Cyclomatic complexity | < 22           | `bun run lint`                    |
| Cognitive complexity  | < 22           | `bun run lint`                    |
| Lines per file        | < 500          | `bun run lint`                    |
| `any` types           | 0              | `bun run lint`                    |
| Types                 | clean          | `bun run typecheck`               |
| Coverage              | 100%, per file | `bun run test`                    |
| Dead code             | 0              | `bun run knip`                    |
| Duplicated code       | 0              | `bun run dup`                     |
| CI duration           | ≤ 5 min        | `bun run ci` + GitHub job timeout |

`bun run verify-gates` proves the code gates actually reject bad code. It plants deliberate violations, runs the real gates, and asserts they are rejected **and name the expected rule** — an exit code alone would pass if a gate had failed for an unrelated reason. For CI duration it validates the workflow configuration: every job must have an integer `timeout-minutes` from 1 to 5 and no `needs`. GitHub enforces the timeout. A gate that has silently stopped enforcing anything is the failure mode this repo is designed around.

### CI duration

`bun run ci` has one five-minute budget for the entire gate sequence, locally and on GitHub. It stops on the first failed gate. If the total budget expires, it stops the running checks and their descendants, reports `CI duration`, and exits with code 124. The local clock starts when the gate sequence launches; a preceding `bun install` is outside that command.

Every job in the `CI` workflow also has a hard five-minute execution budget, including checkout, runtime setup, dependency installation and all gates. Runner queue time is excluded. GitHub stops an over-budget job; the required `Quality gates` check cannot pass, blocking merges. This applies to PR, push and scheduled runs and ships with the template. Individual gate commands, git hooks, and separate deployment or release workflows are outside this budget.

GitHub reports a timed-out job as cancelled with a timeout failure annotation. Cancellation and cleanup can make its recorded duration exceed five minutes; the budget triggers cancellation rather than guaranteeing an instantaneous stop.

CI currently has one job, so this bounds its end-to-end execution. If CI is split, jobs must be independent and each must become a required check in branch protection. Per-job timeouts do not bound total workflow elapsed time when runners start jobs at different times.

There are no warnings, regression comparisons or waivers. Only a human may change the ceiling. When CI times out, make it faster or ask for help; preserve all gates and avoid reruns seeking a lucky pass.

## Design decisions worth knowing

- **Five-minute CI budget.** Agents iterate against CI. When CI is too slow to wait for, people and agents work around it, and the gates stop shaping the code. Five minutes keeps every gate cheap enough to wait for.
- **bun runs tooling; Node runs package tests.** Vitest treats bun as a package manager only, and the v8 coverage provider does not work on the bun runtime. CI tooling tests run with `bun test` to exercise Bun's YAML parser and subprocess timeout; `verify-gates` includes them.
- **No build step anywhere.** Packages export TypeScript source directly. A compiled package that has not been built makes type-aware lint and knip exit 0 while enforcing nothing — a silent false pass.
- **Exact version pins, no ranges.** oxfmt is pre-1.0 with no semver protection on formatting output, and `oxlint-tsgolint` is hard-pinned to a TypeScript patch release.
- **bun's default isolated linker is kept.** It turns an undeclared dependency into an immediate failure instead of a latent bug.
- **`globalStore = true` in `bunfig.toml`.** Packages are symlinked from one machine-wide store, so a clone's `node_modules` is ~200KB instead of ~240MB. The cost is that tools resolving plugins by package name from their _own_ location break, since the store is not a parent of the project.
