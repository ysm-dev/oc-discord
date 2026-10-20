# Releasing oc-discord

The published package is `packages/bot`, named `oc-discord`. It ships TypeScript with a Bun shebang; there is no build step. The first version is `0.1.0`.

## One-time npm setup

A package owner configures [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `oc-discord`:

- GitHub organization: `ysm-dev`
- Repository: `oc-discord`
- Workflow filename: `release.yml`
- Environment: leave empty (the workflow does not name an environment)
- Allowed action: enable direct `npm publish`

npm requires the package to exist before trusted publishing can be configured. Establish ownership with a one-time bootstrap prerelease so `0.1.0` remains available for the first GitHub-published release. In a new temporary directory outside this workspace, log in interactively and publish a clearly labelled bootstrap package:

```sh
npm login
npm init -y
npm pkg set name=oc-discord version=0.0.0-bootstrap.0 description="Bootstrap package for oc-discord trusted publishing"
npm publish --access public --tag bootstrap
```

Then configure the fields above in npm's package settings, or use npm >=11.15.0 from outside this workspace:

```sh
npm trust github oc-discord --repo ysm-dev/oc-discord --file release.yml --allow-publish
```

The account needs package write access and two-factor authentication. Do not add an npm token to GitHub. Configure the publisher close to the first automated release: a new configuration expires if unused for two days.

The release workflow is owned by `@ysm-dev` through CODEOWNERS and must be landed by a human. Publishing uses GitHub-hosted runners, Node 24's npm (OIDC needs npm >=11.5.1), and `id-token: write`. npm creates provenance for the public package/repository.

## Release

1. Set `packages/bot/package.json` to the release version and refresh `bun.lock` with `bun install`. Commit the reviewed changes.
2. Run `bun run ci`, `bun run e2e`, and the [manual smoke test](smoke-test.md).
3. Review the tarball contents by running `bun pm pack --dry-run` in `packages/bot`. It should contain the package manifest, README, and production TypeScript only, including executable `src/index.ts`.
4. From the reviewed commit on `main`, create and push a matching version tag, for example `v0.1.0`.
5. The `Release` workflow installs the locked dependencies, runs all quality gates, checks tag/version equality, verifies CLI version output, packs with Bun, and publishes that tarball using npm OIDC. npm runs outside the Bun-only workspace; it does not install dependencies or use a stored token.
6. Verify `bunx oc-discord@0.1.0 --version` and `--help` in a fresh directory. Record the smoke results and model ID in the GitHub release notes.

After the one-time bootstrap, releases are published only by pushed version tags. Local packaging checks do not publish anything.
