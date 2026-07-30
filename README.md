# t212-mcp

[![CI](https://github.com/guilyx/t212-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/guilyx/t212-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](.nvmrc)

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives
an AI assistant **read-only** access to a [Trading 212](https://www.trading212.com)
investing account: balances, positions, order and dividend history, pies, and
the instrument catalogue.

> **It cannot trade.** No tool places, amends or cancels an order, or changes a
> pie. The HTTP client has no code path that issues anything but a `GET`. See
> [Security](#security).

```
You: How is my portfolio doing, and which holding is furthest from its pie target?

  → t212_get_account_info    reporting currency
  → t212_get_account_cash    balance and unrealised P/L
  → t212_list_positions      holdings, ranked by value
  → t212_list_pies           pie valuations
  → t212_get_pie             allocation drift
```

## Requirements

- Node.js 20.11 or newer
- A Trading 212 API key — in the app: **Settings → API**

Trading 212 issues **separate credentials for practice and real-money
accounts**, and a key from one is rejected by the other. Start with the
practice account.

## Quick start

```bash
npx t212-mcp
```

It speaks MCP over stdio, so run it from a client rather than directly.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trading212": {
      "command": "npx",
      "args": ["-y", "t212-mcp"],
      "env": {
        "T212_API_KEY": "your-key",
        "T212_ENVIRONMENT": "demo"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add trading212 \
  --env T212_API_KEY=your-key \
  --env T212_ENVIRONMENT=demo \
  -- npx -y t212-mcp
```

### Any MCP client

Run `npx -y t212-mcp` with the environment below and connect over stdio.

## Configuration

| Variable             | Default  | Description                                                                        |
| -------------------- | -------- | ---------------------------------------------------------------------------------- |
| `T212_API_KEY`       | —        | **Required.** API key from the Trading 212 app.                                     |
| `T212_API_SECRET`    | —        | Secret, if your key was issued as a key/secret pair. Selects HTTP Basic auth.       |
| `T212_ENVIRONMENT`   | `demo`   | `demo` (practice money) or `live` (real money).                                     |
| `T212_LOG_LEVEL`     | `info`   | `debug`, `info`, `warn`, `error`, `silent`. Logs are NDJSON on stderr.              |
| `T212_TIMEOUT_MS`    | `15000`  | Per-request timeout.                                                                |
| `T212_MAX_RETRIES`   | `3`      | Retries rate limits, network faults and 5xx. Never 4xx or a schema mismatch.         |
| `T212_CACHE_TTL_MS`  | `300000` | Base cache lifetime, scaled per endpoint — see [caching](#rate-limits-and-caching). |
| `T212_ALLOW_EXPORTS` | `false`  | Exposes the CSV export tools. See [Security](#security).                            |
| `T212_BASE_URL`      | —        | Overrides the API host. For testing against a stub.                                 |

The environment defaults to `demo` deliberately: the failure mode of that
default is reading play money by accident, which is the only acceptable
direction for the mistake to go.

See [`.env.example`](.env.example).

## Tools

| Tool                       | Returns                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `t212_get_account_cash`    | Free cash, total value, invested amount, unrealised P/L, blocked cash |
| `t212_get_account_info`    | Account id, reporting currency, which environment is connected        |
| `t212_list_positions`      | All open positions with market value; sort by value, profit or ticker |
| `t212_get_position`        | One position by exact ticker                                          |
| `t212_search_instruments`  | Ranked instrument search by name, symbol or ISIN → exact tickers      |
| `t212_list_exchanges`      | Exchanges and, on request, their trading schedules                    |
| `t212_list_pending_orders` | Orders placed but not yet executed                                    |
| `t212_list_order_history`  | Executed orders, paginated, filterable by ticker                      |
| `t212_list_dividends`      | Dividends received, paginated                                         |
| `t212_list_transactions`   | Deposits, withdrawals, fees and interest, paginated                   |
| `t212_list_pies`           | Pies with invested value, current value and result                    |
| `t212_get_pie`             | One pie's holdings, ranked by drift from target allocation            |
| `t212_list_exports`        | CSV export jobs and links — **only if `T212_ALLOW_EXPORTS`**          |

Also exposed: a `t212://connection` resource describing the connection (no
credentials, no network call), and a `portfolio_review` prompt.

Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`.

### Ticker format

Trading 212 tickers carry a market suffix: `AAPL_US_EQ`, not `AAPL`. Ask the
assistant for a company by name — `t212_search_instruments` resolves it.

## Rate limits and caching

Trading 212's limits are strict and per-endpoint; the instrument catalogue
allows roughly one call per minute. The server shapes requests with a token
bucket per endpoint group and waits for budget rather than being rejected and
retrying blind.

Cache lifetimes are assigned by what the data is, not uniformly:

| Data                    | Lifetime      |
| ----------------------- | ------------- |
| Instruments, exchanges  | 12× base TTL  |
| History, dividends      | 1× base TTL   |
| Pies                    | 0.2× base TTL |
| Cash, positions         | 0.1× base TTL |
| Pending orders, exports | Never cached  |

Stale reference data is cosmetic; a stale balance quoted as current is a wrong
answer. Concurrent identical requests share one call.

## Security

Read [SECURITY.md](SECURITY.md) for the full threat model. In short:

- **Read-only by construction.** The HTTP client exposes only `get` and has no
  path that can issue another method. Order placement, cancellation and pie
  mutation exist in the Trading 212 API and are deliberately absent here, so a
  prompt injection reaching a tool call cannot move money.
- **Credentials stay in the process.** Read from the environment, sent only to
  the configured Trading 212 host over TLS, never written to disk, never in a
  tool result, and scrubbed from logs and error messages by key name _and_ by
  literal value.
- **Your data goes to your model provider.** Anything a tool returns — balances,
  positions, transaction history — is sent to whichever model your client talks
  to. That is how MCP works, but decide knowingly before pointing this at a live
  account.
- **CSV exports are opt-in.** Export download links grant access to a full
  account statement without further authentication, so the tools are hidden
  entirely unless `T212_ALLOW_EXPORTS` is set.

Create your API key with the narrowest scopes you need. This server never uses
order-placement scopes.

## Development

```bash
npm ci
npm run check   # format, lint, typecheck, test — what CI runs
npm run dev     # run from source with reload
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Docker

```bash
docker build -t t212-mcp .
docker run --rm -i -e T212_API_KEY=your-key t212-mcp
```

`-i` is required: the server talks over stdin and stdout.

## Disclaimer

Not affiliated with or endorsed by Trading 212. The Trading 212 API is in beta
and may change. This software is provided as-is under the MIT licence; nothing
it returns is financial advice, and you are responsible for verifying any figure
before acting on it.

## Licence

[MIT](LICENSE)
