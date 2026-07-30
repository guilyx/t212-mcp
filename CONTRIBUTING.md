# Contributing

Thanks for taking the time to contribute.

## Getting set up

```bash
git clone https://github.com/guilyx/t212-mcp.git
cd t212-mcp
npm ci
npm run check
```

Node 20.11 or newer is required. `.nvmrc` pins the version used in CI.

## Development loop

| Command                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Run the server from source with reload        |
| `npm run test:watch`    | Vitest in watch mode                          |
| `npm run check`         | Everything CI runs: format, lint, types, test |
| `npm run build`         | Bundle to `dist/`                             |
| `npm run test:coverage` | Tests with coverage thresholds enforced       |

Run `npm run check` before pushing. CI runs the same commands, plus the test
suite on Node 20, 22 and 24.

## Scope

This server is **read-only by design**. Tools may fetch account, portfolio,
instrument and history data. Pull requests that place, amend or cancel orders,
or that mutate pies, will not be merged — an LLM holding a live brokerage
connection should not be able to move money. Endpoints with side effects on
the Trading 212 side (such as requesting a CSV export) are acceptable only
behind an explicit opt-in flag.

## Testing against the real API

Use the **demo** environment. Trading 212 issues separate credentials for
practice accounts, and a mistake there costs nothing:

```bash
export T212_ENVIRONMENT=demo
export T212_API_KEY=...
export T212_API_SECRET=...
```

Never commit credentials, account numbers, or real position data. Test
fixtures must use invented values.

## Pull requests

- One behavioural change per pull request. Small and reviewable beats
  complete and unreviewable.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`. Pull
  requests are squash-merged, so the PR title becomes the commit message on
  `master` — write it accordingly.
- Cover new behaviour with tests. Network calls are stubbed at the `fetch`
  boundary; no test may touch the real API.
- Update `README.md` when the tool surface or configuration changes.

## Adding a tool

1. Add the endpoint to the endpoint table and a zod schema for its response.
2. Add the tool in `src/tools/`, with an input schema and a description that
   tells the model *when* to reach for it, not just what it does.
3. Register it in the tool registry.
4. Test the happy path plus at least one API error path.
5. Document it in the README tool table.

## Reporting problems

Bugs and feature requests go to
[issues](https://github.com/guilyx/t212-mcp/issues). Security vulnerabilities
go through the process in [SECURITY.md](SECURITY.md) — not a public issue.
