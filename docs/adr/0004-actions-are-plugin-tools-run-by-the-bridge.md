# Actions are plugin tools carried out by the Bridge

The Agent's Actions are tools registered by an OpenCode plugin in the Session directory's `.opencode/plugins/`. Each tool call goes over HTTP to the Bridge, which holds the bot token and performs the Action in Discord.

## Considered Options

- **An MCP server in the Bridge**: Effect ships one, but MCP was ruled out.
- **Custom tools in `.opencode/tools/`**: the documented v1 mechanism, but OpenCode v2 silently ignores that folder (tested on 2.0.32).
- **Tools that call Discord directly**: the bot token would have to live inside OpenCode, where the Agent can run shell commands and read it.
