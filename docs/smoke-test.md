# Real-Guild smoke test

Run before tagging a release. Use a private test Guild and a disposable Session directory. Record the Bridge version, OpenCode version, chosen model, OS, and results in the release notes.

## Prepare

- [ ] Follow the README's developer-portal settings and invite permissions.
- [ ] Start OpenCode v2. Select a currently available free, tool-capable OpenCode model from `opencode models` and set its full model ID in the Session directory's `opencode.jsonc`. Authenticate with the provider if requested. Model availability changes; record the actual ID used.
- [ ] Start the Bridge. Confirm `bridge.ready`, `AGENTS.md`, `opencode.jsonc`, and the installed plugin.
- [ ] Confirm the model has all eleven `discord_*` tools and no `question` tool. Ask it to read a test `.env` file; this should be denied without a prompt. Ask it to read a harmless file outside the Session directory; external-directory access should be allowed without a prompt.

## Receiving and conversation context

- [ ] Post an ordinary message, role ping, `@everyone`, and `@here`: no Session starts. A DM and an edit adding a Bot mention also do nothing.
- [ ] @mention the Bot in a channel. Confirm a new, readable Session title and a Briefing with server/channel/topic, Bot identity, UTC time, authors, IDs, and recent messages oldest first.
- [ ] Reply to its message with ping enabled: a fresh Session starts. Repeat with ping disabled: no Session starts.
- [ ] Mention it inside a thread: the Briefing includes the thread and its starter. Include a reply, attachment, embed, and reaction and inspect their transcript rendering.
- [ ] Mention it twice rapidly while the first Session is still working: both start immediately with different IDs.

## Agent Actions

- [ ] Ask it to call `discord_typing`, work for more than ten seconds, then reply. Typing remains visible until the reply.
- [ ] Ask for a response longer than 2,000 characters: all text arrives in multiple messages. Include a named user, role mention, `@everyone`, and `@here`: only the named user/reply recipient can be pinged.
- [ ] Ask it to create an image in the Session directory and attach it. Confirm the filename and bytes. Ask it to examine a posted image by downloading it and using `read`.
- [ ] Ask it to edit and delete one of its messages and to add/remove its own reaction.
- [ ] Ask it to create a public standalone thread, a thread from a message, and a forum post with opening content.
- [ ] Ask it to list channels/active threads, page through history, search by text/author/channel/type/date, and look up a member's roles and join date.
- [ ] Ask it to remain silent and produce only a plain answer: nothing is posted to Discord.
- [ ] Remove Send Messages in a test channel and request a send: the tool reports a useful permission error; the Bridge posts no error message.
- [ ] If the Bot is in a second test Guild, supply one of its channel IDs: the Action is rejected and no data from that Guild is returned.

## Recovery and privacy

- [ ] Restart the Bridge while a Session is running. Confirm the Session remains in OpenCode and subsequent tools work using its original key. Keep the callback address unchanged.
- [ ] Briefly disconnect networking, restore it, then mention the Bot. Confirm Gateway recovery and event-stream catch-up for completed Sessions.
- [ ] Cause a provider failure: confirm an outcome/error log with Session and Discord IDs, and no automatic Discord post.
- [ ] Check logs for credentials and conversation text: neither appears. Confirm completed Sessions remain in OpenCode.
- [ ] Edit `AGENTS.md` and `opencode.jsonc`, restart, and confirm both edits survive. Delete one, restart, and confirm its default is recreated.

The model chooses its Actions. When a step is ambiguous, inspect the Session's tool calls and repeat with an explicit instruction before marking it passed.
