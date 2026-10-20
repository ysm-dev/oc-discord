# oc-discord

Shared vocabulary for oc-discord, which lets an OpenCode agent act in Discord like a member of a server. The terms cover the bot domain, the quality gates, and the package structure.

## Language

### Roles

**Bot**:
The Discord bot user that people @mention and through which the Agent acts.
_Avoid_: app, application, server

**Agent**:
The OpenCode AI that acts in Discord through the Bot. Not to be confused with an OpenCode agent definition (such as `build`), which configures how the Agent behaves.
_Avoid_: bot, AI, assistant, LLM

**Bridge**:
The `oc-discord` process that connects the Bot to OpenCode.
_Avoid_: bot server, bridge server, relay, proxy

### Discord

**Guild**:
A Discord server.
_Avoid_: server, community

**Mention**:
A new message, written by a person in a Guild channel or thread, that pings the Bot directly: by typing `@Bot`, or by replying to the Bot with the ping on. Role pings, `@everyone`/`@here`, DMs, edits and messages from bots are not Mentions.
_Avoid_: ping, trigger, request, prompt

**Action**:
Something the Agent does in Discord through the Bot, such as sending a message, reacting, creating a thread, reading a channel or searching.
_Avoid_: command (Discord slash commands), tool (the OpenCode mechanism that performs an Action)

### Sessions

**Session**:
One OpenCode session, started for exactly one Mention and never reused.
_Avoid_: conversation, chat, thread (a Discord thread is something else), run, job

**Briefing**:
The snapshot of Discord attached to a Session's first prompt: where the Mention happened, who is involved, and the messages that led up to it.
_Avoid_: context (clashes with Effect's `Context` and the model's context window), history, prompt

**Session directory**:
The folder on the OpenCode machine in which every Session runs, such as `~/discord-bot`.
_Avoid_: workspace (clashes with Bun workspaces), project, worktree, cwd

### Enforcement

**Gate**:
A single automated check that blocks a merge when it fails. The full list is in `README.md`.
_Avoid_: rule, check, lint (a lint rule is one implementation of a gate, not a synonym)

**Silent false pass**:
A gate that exits 0 while enforcing nothing, usually because its inputs failed to resolve. The failure mode `verify-gates` is designed to detect.
_Avoid_: false negative, silent failure

**Exception**:
A named, reasoned, human-approved waiver of one gate for one path. Lives in `quality-exceptions.json` when it covers a whole file, or as an inline suppression carrying `-- <reason>` when it covers a single line.
_Avoid_: ignore, suppression, disable, override, waiver

**Tier**:
Where a gate runs: pre-commit, pre-push, or CI. Tiers exist because gates differ by orders of magnitude in cost, not because they differ in importance.
_Avoid_: stage, level, phase

### Structure

**Archetype**:
One of the two shapes a workspace package may take. A **library** is consumed by other workspace packages; an **application** is the thing that runs.
_Avoid_: kind, category, template (overloaded here), project

**Just-in-Time package**:
A workspace package that runs or exports TypeScript source directly, with no build step and no emitted `dist/`.
_Avoid_: source package, unbuilt package, internal package

**Trust boundary**:
A function that accepts untrusted input as `unknown` and narrows it before anything downstream sees it. The only place `unknown` may be declared, and the only accepted justification for suppressing the `unknown` ban.
_Avoid_: validator, parser, guard (a type guard is a tool used at a trust boundary, not the boundary itself)
