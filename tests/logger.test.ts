import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger, silentLogger } from "../src/logger.js";

interface Capture {
  stream: Writable;
  records: () => Record<string, unknown>[];
}

function capture(): Capture {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    records: () =>
      lines
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const now = () => new Date("2026-01-02T03:04:05.000Z");

describe("createLogger", () => {
  it("writes one NDJSON record per call", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now, level: "debug" });

    log.info("fetched positions", { count: 3 });

    expect(records()).toEqual([
      {
        time: "2026-01-02T03:04:05.000Z",
        level: "info",
        msg: "fetched positions",
        count: 3,
      },
    ]);
  });

  it("drops records below the configured level", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now, level: "warn" });

    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    log.error("kept");

    expect(records().map((r) => r["level"])).toEqual(["warn", "error"]);
  });

  it("writes nothing at the silent level", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now, level: "silent" });

    log.error("suppressed");

    expect(records()).toEqual([]);
  });

  it("redacts configured secrets and sensitive keys", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now, secrets: ["supersecret1"] });

    log.error("request failed", {
      url: "https://demo.trading212.com?k=supersecret1",
      apiSecret: "supersecret1",
    });

    const [record] = records();
    expect(record?.["url"]).toBe("https://demo.trading212.com?k=[redacted]");
    expect(record?.["apiSecret"]).toBe("[redacted]");
  });

  it("merges parent bindings into child records", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now }).child({ tool: "get_cash" });

    log.info("start");
    log.child({ attempt: 2 }).info("retry");

    expect(records()).toEqual([
      expect.objectContaining({ tool: "get_cash" }),
      expect.objectContaining({ tool: "get_cash", attempt: 2 }),
    ]);
  });

  it("lets call fields override bindings", () => {
    const { stream, records } = capture();
    const log = createLogger({ stream, now, bindings: { attempt: 1 } });

    log.info("retry", { attempt: 2 });

    expect(records()[0]?.["attempt"]).toBe(2);
  });

  it("refuses to write to stdout", () => {
    expect(() => createLogger({ stream: process.stdout })).toThrow(
      /MCP protocol stream/,
    );
  });

  it("survives a failing stream", () => {
    const stream = new Writable({
      write() {
        throw new Error("EPIPE");
      },
    });

    expect(() => {
      createLogger({ stream, now }).info("still alive");
    }).not.toThrow();
  });

  it("exposes a shared silent logger", () => {
    expect(() => {
      silentLogger.error("nothing happens");
    }).not.toThrow();
  });
});
