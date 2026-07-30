/**
 * Identity of the MCP server as advertised during the `initialize` handshake.
 *
 * The version is duplicated from `package.json` on purpose: importing JSON
 * across the ESM/`NodeNext` boundary drags the manifest into the published
 * bundle and pins the output to an import assertion syntax that not every
 * runtime accepts. A release check keeps the two in sync.
 */
export const SERVER_NAME = "t212-mcp";

export const SERVER_VERSION = "0.1.0";
