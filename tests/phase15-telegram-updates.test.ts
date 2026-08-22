import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  laterUpdateStreamCursor,
  updateStreamCursorFromMetadata,
  withUpdateStreamCursor,
} from "@/lib/social/update-stream";
import { getSocialAdapter } from "@/social/core/registry";
import { TelegramAdapter, telegramMethodUrl } from "@/social/telegram/adapter";
import { parseTelegramInboxUpdates } from "@/social/telegram/inbox";
import {
  parseTelegramUpdates,
  TELEGRAM_SHARED_UPDATE_TYPES,
} from "@/social/telegram/updates";

const SHARED_UPDATES = {
  ok: true,
  result: [
    {
      update_id: 20,
      message: {
        message_id: 1,
        text: "I am interested",
        from: { id: 77, username: "lead_user" },
        chat: { id: 77, username: "lead_user", type: "private" },
      },
    },
    {
      update_id: 21,
      message: {
        message_id: 2,
        text: "Hello social hub",
        from: { id: 88, username: "alice" },
        chat: { id: 88, username: "alice", type: "private" },
      },
    },
    {
      update_id: 22,
      channel_post: {
        message_id: 9,
        text: "Channel social mention",
        chat: { id: -100, username: "hub_news" },
      },
    },
    {
      update_id: 23,
      message: {
        message_id: 3,
        text: "group social chat",
        from: { id: 99, username: "bob" },
        chat: { id: -5, username: "leads", type: "supergroup" },
      },
    },
  ],
};

describe("shared Telegram update parsing", () => {
  it("fans one getUpdates payload into private inbox and monitor candidates", () => {
    const parsed = parseTelegramUpdates(SHARED_UPDATES, "20");
    expect(parsed.cursor).toBe("24");
    expect(parsed.inboxMessages.map((item) => item.externalProfileId)).toEqual(["77", "88"]);
    expect(parsed.monitorCandidates.map((item) => item.externalId)).toEqual(["20", "21", "22", "23"]);
    expect(parsed.monitorCandidates.find((item) => item.externalId === "22")?.url).toBe(
      "https://t.me/hub_news/9",
    );
  });

  it("keeps the inbox helper on the same private-message subset", () => {
    const inbox = parseTelegramInboxUpdates(SHARED_UPDATES, "20");
    expect(inbox.messages).toHaveLength(2);
    expect(inbox.cursor).toBe("24");
  });
});

describe("Telegram adapter shared update stream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches message and channel_post types once for inbox, monitor, and shared collection", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain(telegramMethodUrl("123456:ABC-token_value", "getUpdates"));
      expect(decodeURIComponent(String(url))).toContain('"message"');
      expect(decodeURIComponent(String(url))).toContain('"channel_post"');
      expect(String(url)).toContain("offset=20");
      return new Response(JSON.stringify(SHARED_UPDATES), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TelegramAdapter({ accessToken: "123456:ABC-token_value" });
    const shared = await adapter.collectSharedUpdates({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "20",
      monitorSources: [],
    });
    expect(shared.messages).toHaveLength(2);
    expect(shared.monitorCandidates).toHaveLength(4);
    expect(shared.cursor).toBe("24");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const inbox = await adapter.collectInbox({ workspaceId: "w", socialAccountId: "a", cursor: "20" });
    expect(inbox.messages).toHaveLength(2);

    const monitored = await adapter.monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social"],
      sources: [],
      cursor: "20",
    });
    expect(monitored.events.map((event) => event.externalId)).toEqual(["21", "22", "23"]);
    expect(TELEGRAM_SHARED_UPDATE_TYPES).toEqual(["message", "channel_post"]);
  });
});

describe("PHASE 15 capabilities and worker boundaries", () => {
  it("enables a shared update stream only on Telegram", async () => {
    expect((await getSocialAdapter("telegram").getCapabilities()).sharedUpdateStream).toBe(true);
    expect((await getSocialAdapter("x").getCapabilities()).sharedUpdateStream).toBe(false);
    expect((await getSocialAdapter("vk").getCapabilities()).sharedUpdateStream).toBe(false);
    expect((await getSocialAdapter("facebook").getCapabilities()).sharedUpdateStream).toBe(false);
    expect((await getSocialAdapter("instagram").getCapabilities()).sharedUpdateStream).toBe(false);
  });

  it("keeps inbox and monitor on one account cursor without a worker platform switch", () => {
    expect(updateStreamCursorFromMetadata({ inboxCursor: "10" })).toBe("10");
    expect(updateStreamCursorFromMetadata({ updateStreamCursor: "12", inboxCursor: "10" })).toBe("12");
    expect(laterUpdateStreamCursor("12", "10")).toBe("12");
    expect(laterUpdateStreamCursor("10", "12")).toBe("12");
    expect(withUpdateStreamCursor({ deviceId: "d1" }, "24")).toEqual({
      deviceId: "d1",
      updateStreamCursor: "24",
      inboxCursor: "24",
    });
    expect(withUpdateStreamCursor({ updateStreamCursor: "20", inboxCursor: "20" }, null)).toEqual({
      updateStreamCursor: "20",
      inboxCursor: "20",
    });

    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain("sharedUpdateStream");
    expect(worker).toContain("collectSharedUpdates");
    expect(worker).toContain("ingestInboxMessages");
    expect(worker).toContain("adapter.collectInbox");
    expect(worker).toContain("adapter.monitor");
  });
});
