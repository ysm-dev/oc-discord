# oc-discord

A TypeScript monorepo for oc-discord, initialized from [ysm-dev/ts-template](https://github.com/ysm-dev/ts-template/tree/087fe926bfe685c53f37b6485ba07b1c4a7639fa): bun, Turborepo, TypeScript 7, and quality gates that block CI.

The premise is that when agents write most of the code, review does not scale but gates do.

## Quick start

```sh
bun install
bun run ci
bun run --cwd packages/bot start
```

The bot currently prints a placeholder startup message and exits.

## Layout

```
packages/bot/          Bot application skeleton. No build step.
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
