import { describe, expect, it } from "vitest";
import {
  isDigitIdAfter,
  isNamedInboxCursor,
  isReceivedAfterCursor,
  laterNamedValue,
  laterTimestampString,
  newestReceivedAt,
  parseInboxTimestampMs,
  uniqueInboxMessages,
} from "@/lib/inbox/cursor";

describe("isNamedInboxCursor", () => {
  it("recognizes a named cursor by a pipe or a leading key:", () => {
    expect(isNamedInboxCursor("comments:2026-08-21T22:00:00+0000")).toBe(true);
    expect(isNamedInboxCursor("comments:done|videos:done")).toBe(true);
    expect(isNamedInboxCursor("12345")).toBe(false);
    expect(isNamedInboxCursor("")).toBe(false);
  });
});

describe("isDigitIdAfter", () => {
  it("compares numeric ids with BigInt precision", () => {
    expect(isDigitIdAfter("105", "100")).toBe(true);
    expect(isDigitIdAfter("100", "105")).toBe(false);
    expect(isDigitIdAfter("100", "100")).toBe(false);
    expect(isDigitIdAfter("9999999999999999999", "9999999999999999998")).toBe(true);
  });

  it("is permissive (returns true) when either side is not a plain digit string", () => {
    expect(isDigitIdAfter("abc", "100")).toBe(true);
    expect(isDigitIdAfter("100", "abc")).toBe(true);
  });

  it("treats a missing or blank watermark as no floor", () => {
    expect(isDigitIdAfter("100", null)).toBe(true);
    expect(isDigitIdAfter("100", undefined)).toBe(true);
    expect(isDigitIdAfter("100", "")).toBe(true);
    expect(isDigitIdAfter("100", "   ")).toBe(true);
  });
});

describe("parseInboxTimestampMs", () => {
  it("treats a 10-digit string as a unix seconds watermark", () => {
    expect(parseInboxTimestampMs("1700000000")).toBe(1_700_000_000_000);
  });

  it("parses a Graph-style created_time with no colon in the UTC offset", () => {
    expect(parseInboxTimestampMs("2026-08-21T22:00:00+0000")).toBe(
      Date.parse("2026-08-21T22:00:00+00:00"),
    );
  });

  it("parses a normal ISO instant", () => {
    expect(parseInboxTimestampMs("2026-08-21T22:00:00.000Z")).toBe(
      Date.parse("2026-08-21T22:00:00.000Z"),
    );
  });

  it("returns null for blank or unparseable input", () => {
    expect(parseInboxTimestampMs(null)).toBeNull();
    expect(parseInboxTimestampMs(undefined)).toBeNull();
    expect(parseInboxTimestampMs("")).toBeNull();
    expect(parseInboxTimestampMs("not a timestamp")).toBeNull();
  });
});

describe("laterTimestampString", () => {
  it("keeps the newer of two timestamps", () => {
    expect(laterTimestampString("2026-08-21T10:00:00.000Z", "2026-08-21T12:00:00.000Z")).toBe(
      "2026-08-21T12:00:00.000Z",
    );
    expect(laterTimestampString("2026-08-21T12:00:00.000Z", "2026-08-21T10:00:00.000Z")).toBe(
      "2026-08-21T12:00:00.000Z",
    );
  });

  it("falls back to whichever side is present when the other is missing", () => {
    expect(laterTimestampString(null, "2026-08-21T12:00:00.000Z")).toBe("2026-08-21T12:00:00.000Z");
    expect(laterTimestampString("2026-08-21T12:00:00.000Z", null)).toBe("2026-08-21T12:00:00.000Z");
    expect(laterTimestampString(null, null)).toBeNull();
  });

  it("defers to the incoming value when either side cannot be parsed as a timestamp", () => {
    expect(laterTimestampString("not-a-timestamp", "2026-08-21T12:00:00.000Z")).toBe(
      "2026-08-21T12:00:00.000Z",
    );
  });
});

describe("laterNamedValue", () => {
  it("compares two digit ids with BigInt precision", () => {
    expect(laterNamedValue("100", "105")).toBe("105");
    expect(laterNamedValue("105", "100")).toBe("105");
  });

  it("compares two timestamps when they are not both digit ids", () => {
    expect(laterNamedValue("2026-08-21T10:00:00.000Z", "2026-08-21T12:00:00.000Z")).toBe(
      "2026-08-21T12:00:00.000Z",
    );
  });

  it("falls back to whichever side is present when the other is missing", () => {
    expect(laterNamedValue(null, "105")).toBe("105");
    expect(laterNamedValue("105", null)).toBe("105");
  });
});

describe("isReceivedAfterCursor", () => {
  it("keeps a message with no cursor watermark or no receivedAt", () => {
    expect(isReceivedAfterCursor("2026-08-21T12:00:00.000Z", null)).toBe(true);
    expect(isReceivedAfterCursor(null, "2026-08-21T12:00:00.000Z")).toBe(true);
  });

  it("keeps only messages strictly newer than the cursor", () => {
    expect(isReceivedAfterCursor("2026-08-21T13:00:00.000Z", "2026-08-21T12:00:00.000Z")).toBe(true);
    expect(isReceivedAfterCursor("2026-08-21T12:00:00.000Z", "2026-08-21T12:00:00.000Z")).toBe(false);
    expect(isReceivedAfterCursor("2026-08-21T11:00:00.000Z", "2026-08-21T12:00:00.000Z")).toBe(false);
  });
});

describe("newestReceivedAt", () => {
  it("finds the newest receivedAt across a list of messages, ignoring nulls", () => {
    expect(
      newestReceivedAt([
        { receivedAt: "2026-08-21T10:00:00.000Z" },
        { receivedAt: null },
        { receivedAt: "2026-08-21T12:00:00.000Z" },
        { receivedAt: "2026-08-21T09:00:00.000Z" },
      ]),
    ).toBe("2026-08-21T12:00:00.000Z");
    expect(newestReceivedAt([])).toBeNull();
  });
});

describe("uniqueInboxMessages", () => {
  it("keeps the first occurrence of each externalId and drops later duplicates", () => {
    const messages = [
      { externalId: "1", body: "first" },
      { externalId: "2", body: "second" },
      { externalId: "1", body: "duplicate of first" },
    ];
    expect(uniqueInboxMessages(messages)).toEqual([
      { externalId: "1", body: "first" },
      { externalId: "2", body: "second" },
    ]);
  });
});
