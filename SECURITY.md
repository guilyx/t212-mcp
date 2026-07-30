# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/guilyx/t212-mcp/security/advisories/new).
Please do not open a public issue.

Include reproduction steps and the affected version. Expect an initial
response within seven days.

## Threat model

This server hands an LLM a connection to a brokerage account. The design
follows from that.

**Read-only.** Only endpoints that read data are exposed. No tool places,
amends or cancels an order, and no tool mutates a pie. A prompt injection
carried in a document, a web page, or an instrument name therefore cannot
cause a trade. Endpoints with side effects on Trading 212's side — currently
only CSV export generation — are gated behind an explicit opt-in flag that
defaults to off.

**Credentials stay in the process.** The API key and secret are read from the
environment at startup, held in memory, and sent only to the configured
Trading 212 host over TLS. They are never written to disk, never included in
a tool result, and redacted from logs and error messages.

**Data leaves the machine.** Anything a tool returns — balances, positions,
transaction history — is sent to whichever model your MCP client is talking
to. That is inherent to how MCP works, but it is worth stating plainly: this
is your financial data, going to a third-party model provider. Use the demo
environment unless you need live figures.

**Untrusted responses.** API responses are parsed with schemas rather than
cast. A malformed or unexpected payload produces a tool error, not a crash or
a silently wrong number.

## Handling your credentials

- Create the API key with the narrowest scopes your use case needs. If your
  client only reads data, do not grant order-placement scopes — this server
  never uses them.
- Prefer the demo environment for experimentation.
- Pass credentials through your MCP client's environment configuration, or a
  local `.env` file that is git-ignored. Do not paste them into a chat.
- Revoke a key immediately if you suspect exposure: Trading 212 app →
  Settings → API.

## Supported versions

The latest published minor version receives security fixes.
