# AGENTS.md

- Do not preserve backward compatibility. Remove obsolete paths instead of
  adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current
  requirements. Avoid speculative abstractions, configuration, and
  indirection.
- Grow the system in layers. Start from the smallest version that works end
  to end, and add each new capability on top of a product that already
  works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall
  complexity or improve reliability. Do not reimplement common
  functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own
  implementation or adding packages. Do not assume a library lacks a
  capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap
  that only works for now and is meant to be replaced later.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for this repo (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Quality gates

This repo enforces the gates listed below. They are not advisory. `bun run ci` runs the code gates with one five-minute execution budget locally and on GitHub, and validates the workflow duration configuration. GitHub additionally times the entire job, including setup and installation.

| Gate                  | Threshold      | Enforced by                       |
| --------------------- | -------------- | --------------------------------- |
| Formatting            | clean          | `bun run format:check`            |
| Cyclomatic complexity | < 22           | oxlint `eslint/complexity`        |
| Cognitive complexity  | < 22           | `oxlint-plugin-complexity`        |
| Lines per file        | < 500          | oxlint `eslint/max-lines`         |
| Types                 | clean          | `bun run typecheck`               |
| Test coverage         | 100%, per file | vitest `thresholds.perFile`       |
| Dead code             | 0              | knip                              |
| Duplicated code       | 0              | jscpd                             |
| `any` types           | 0              | oxlint `no-explicit-any`          |
| CI duration           | ≤ 5 min        | `bun run ci` + GitHub job timeout |

Every job in `.github/workflows/ci.yml` needs an integer `timeout-minutes` from 1 to 5 and must be independent (no `needs`). The budget includes setup, installation and gates, excluding runner queue time. When splitting CI, make every job a required check in branch protection; per-job timeouts do not bound staggered runner starts. See `README.md` for the CI duration scope and rationale.

### Rules that are easy to get wrong

- **`any` is banned outright.** No exceptions.
- **`unknown` is allowed only at a trust boundary** — a function taking untrusted input (CLI arguments, parsed JSON, environment variables) and narrowing it before anything downstream sees it. It is banned in every other declared parameter, return, or field type. See `scripts/ci-duration.ts` for the intended shape.
- **Coverage is per file, not global.** A global average is trivially gamed by one large well-covered file.
- **Untestable code goes in a thin edge file**, not behind a coverage ignore comment. `packages/bot/src/index.ts` is the worked example: all logic lives in `main.ts`, and the shim that writes to stdout is the only excused file.

### When a gate blocks you

Do **not** delete the test, weaken the type, or inline a duplicate to get green. Those are worse than the violation.

If CI exceeds its duration budget, make it faster while preserving all gates, or stop and ask. Only a human may change the five-minute ceiling; it has no waivers. Never raise the limit, skip or remove gates, move checks out of CI, or rerun a timed-out job hoping for a lucky pass.

Exceptions live in `quality-exceptions.json`, which is owned by a human via CODEOWNERS. You may propose an entry; you cannot land one. Every entry needs a `reason`. Inline suppressions must carry `-- <reason>` and are reported by `bun run exceptions`.

A sudden burst of `no-unsafe-*` errors means the TypeScript program is misconfigured, **not** that you should add a disable comment.

### Package shape

Packages are Just-in-Time: `exports` points at `./src/index.ts`, there is no build step, and relative imports use explicit `.ts` extensions. Do not add a `build` script or emit `dist/` — an unbuilt compiled package makes type-aware lint and knip exit 0 while enforcing nothing.
