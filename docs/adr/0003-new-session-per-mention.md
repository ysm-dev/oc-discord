# A new Session for every Mention

Each Mention starts a fresh Session that is never reused, and messages without a Mention never reach a Session. Continuity comes only from the Briefing's recent messages and from what the Agent reads back from Discord. OpenCode's own Slack bot keeps one session per thread instead; fresh Sessions keep each response grounded in what is visible in Discord right now and leave the Bridge with no conversation state to keep.
