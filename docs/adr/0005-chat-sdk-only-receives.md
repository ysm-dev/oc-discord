# Chat SDK only receives; one Discord API client sends

Chat SDK, which the Discord integration is required to use, holds the Gateway connection, spots likely Mentions and drops duplicate deliveries. Everything the Bridge sends or fetches, including the Briefing's history and every Action, goes through one `@discordjs/rest` client instead of Chat SDK's own sending API. That API cuts text at 2,000 characters, turns `@123` into a real ping, has no rate-limit handling, and cannot reply to a message, search, list channels, look up members or create threads on demand.

## Consequences

Chat SDK's Discord adapter opens a thread for every Mention in a regular channel. The Bridge overrides the adapter's internal thread-creation method to stop that, because the Agent decides where to answer. Exact version pins and a test on the override make an upgrade that changes it fail the test instead of breaking silently.
