# Support only OpenCode v2

OpenCode has two server lines with incompatible APIs. Docker's `latest` tag, npm and GitHub's "Latest" release still point to v1, but OpenCode tells integrations built on the v1 API to migrate to v2. The Bridge supports only the v2 API, so local Docker setups pin an explicit v2 tag instead of `latest`.
