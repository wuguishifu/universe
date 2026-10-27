# mcp-service

The MCP server for claude.ai and Claude Code, at `https://mcp.wuguishifu.dev/mcp`: tools for the
universe apps, which it calls through their contracts. It's public (claude.ai calls MCP servers from
Anthropic's servers, which can't reach the tailnet), so it's also an OAuth 2.1 authorization server,
and hands the sign-in itself to Authelia. Deployment, secrets and connecting a client are in the
homelab repo's `manifests/mcp-service/README.md`.

## How it works

```plaintext
POST /oauth/register     dynamic client registration (RFC 7591); redirect URIs must be loopback or
                         in ALLOWED_REDIRECT_URIS, so a code can only go to a client you use
GET  /oauth/authorize    checks the client, redirect URI and PKCE, then sends the browser to
                         Authelia (its `mcp` client; Authelia only lets admins in, with two factors)
GET  /oauth/callback     swaps Authelia's code for the user's `sub` and redirects to the client
                         with a code of its own
POST /oauth/token        that code (with the PKCE verifier) or a refresh token ─► an access token
                         (1 hour) and a new refresh token (30 days; the old one is spent)
ALL  /mcp                bearer token ─► a fresh McpServer with every toolset registered
GET  /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource/mcp
```

Tokens are opaque random strings, kept in Redis under their SHA-256 (`MCP_REDIS` in
[redis-keys.ts](src/config/redis-keys.ts)), so deleting a key revokes one. `/mcp` is stateless:
`createMcpHandler` from `@modelcontextprotocol/server` serves both the 2026-07-28 protocol and the
2025 one, building a server per request. Every tool call is logged with the client's id.

## Tools

Each project keeps its tools in its own lib (`projects/<project>/mcp`), exporting a function that
returns an `McpToolset` from [`@platform/mcp-toolkit`](../toolkit). The toolset builds a ts-rest
client from the project's contract, so a contract change that breaks a tool fails the build, and
`toolResult` turns the response into a tool result (an `isError` result with the API's message
when it fails, so the model can react to it).

- [thermo-automation](../../../projects/thermo-automation/mcp): `thermo_get_status`,
  `thermo_get_device_history`, `thermo_set_device_control`, `thermo_pause_device`,
  `thermo_resume_device`, and `thermo_create/update/delete_automation`.

To add a project: create its `mcp` lib, add its toolset to
[toolsets.ts](src/modules/mcp/toolsets.ts) and its service URL to the environment (and the homelab
ConfigMap). Prefix tool names with the project, describe them for a model that has never seen the
app (units, ids, what a change does), and set `annotations` (`readOnlyHint` on reads,
`destructiveHint` on deletes) so clients know which calls to confirm.

## Development

1. `nx setup environment` writes `.env.local` (see [.env.example](.env.example)).
2. `nx serve mcp-service` (port 3012), with a local Redis and the apps it has tools for running.
3. `claude mcp add --transport http universe-local http://localhost:3012/mcp`, then `/mcp` in
   Claude Code to sign in. Authelia's `mcp` client allows `http://localhost:3012/oauth/callback`,
   so this goes through the real Authelia: be on the tailnet.
