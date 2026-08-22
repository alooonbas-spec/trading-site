import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canCancelPost, canDeletePost, canPublishPost, rollupPostStatus } from "@/lib/posts/status";
import { createPostSchema, parseMediaList, parseScheduledAt } from "@/lib/validation/post";
import { getSocialAdapter } from "@/social/core/registry";
import { XAdapter } from "@/social/x/adapter";
import { POST_STATUSES, POST_TARGET_STATUSES } from "@/types/status";

describe("post status machine", () => {
  it("stays independent from contact and job statuses", () => {
    expect(POST_STATUSES).toContain("PUBLISHED");
    expect(POST_STATUSES).toContain("PARTIAL");
    expect(POST_STATUSES).not.toContain("MESSAGE_SENT");
    expect(POST_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(POST_TARGET_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(POST_TARGET_STATUSES).not.toContain("SUCCESS");
  });

  it("rolls target outcomes into a post status", () => {
    expect(rollupPostStatus(["PENDING", "SCHEDULED"])).toBe("PUBLISHING");
    expect(rollupPostStatus(["SCHEDULED", "SCHEDULED"])).toBe("SCHEDULED");
    expect(rollupPostStatus(["PUBLISHED", "PUBLISHED"])).toBe("PUBLISHED");
    expect(rollupPostStatus(["PUBLISHED", "FAILED"])).toBe("PARTIAL");
    expect(rollupPostStatus(["FAILED", "SKIPPED"])).toBe("FAILED");
    expect(rollupPostStatus(["CANCELLED", "CANCELLED"])).toBe("CANCELLED");
  });

  it("allows publish from draft or scheduled only", () => {
    expect(canPublishPost("DRAFT")).toBe(true);
    expect(canPublishPost("SCHEDULED")).toBe(true);
    expect(canPublishPost("PUBLISHED")).toBe(false);
    expect(canCancelPost("PUBLISHING")).toBe(true);
    expect(canDeletePost("PUBLISHING")).toBe(false);
  });
});

describe("post validation", () => {
  it("requires a body and at least one account", () => {
    expect(createPostSchema.safeParse({ body: "", media: [], accountIds: [] }).success).toBe(false);
    expect(
      createPostSchema.safeParse({
        body: "Hello",
        media: [],
        accountIds: ["11111111-1111-4111-8111-111111111111"],
      }).success,
    ).toBe(true);
    expect(parseMediaList("https://example.com/a.jpg\nhttps://example.com/b.jpg")).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
  });

  it("parses a scheduled time or returns null for blank input, and rejects garbage", () => {
    expect(parseScheduledAt("")).toBeNull();
    expect(parseScheduledAt("   ")).toBeNull();
    expect(parseScheduledAt("2026-08-21T18:00:00.000Z")).toBe("2026-08-21T18:00:00.000Z");
    expect(() => parseScheduledAt("not-a-date")).toThrow("Scheduled time is invalid");
  });
});

describe("publishing adapters", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("enables official publishing on every platform and keeps VK contact disabled", async () => {
    expect((await getSocialAdapter("x").getCapabilities()).publishing).toBe(true);
    expect((await getSocialAdapter("telegram").getCapabilities()).publishing).toBe(true);
    expect((await getSocialAdapter("telegram").getCapabilities()).contactActions).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).publishing).toBe(true);
    expect((await getSocialAdapter("facebook").getCapabilities()).publishing).toBe(true);
    expect((await getSocialAdapter("instagram").getCapabilities()).publishing).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).contactActions).toBe(false);
    expect((await getSocialAdapter("facebook").getCapabilities()).contactActions).toBe(true);
    expect((await getSocialAdapter("instagram").getCapabilities()).contactActions).toBe(true);
  });

  it("posts X text through the official tweets endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.x.com/2/tweets");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toEqual({ text: "Hello from Social Hub" });
      return new Response(JSON.stringify({ data: { id: "123", text: "Hello from Social Hub" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new XAdapter({ accessToken: "x-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Hello from Social Hub",
      media: [],
    });
    expect(published.externalPostId).toBe("123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat TinyFish collection as a publish capability", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const capabilities = await getSocialAdapter("vk").getCapabilities();
    expect(capabilities.publicCollection).toBe(true);
    expect(capabilities.publishing).toBe(true);
    expect(capabilities.monitoring).toBe(true);
    expect(capabilities.contactActions).toBe(false);
  });
});

describe("PHASE 6 source boundaries", () => {
  it("does not add do_not_contact to posts and uses skip-locked jobs", () => {
    const sql = readFileSync("supabase/migrations/20260821200000_phase6_posts.sql", "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);
    expect(sql).toContain("unique (post_id, social_account_id)");
    expect(sql).toContain("type = 'PUBLISH'");
    expect(sql).toContain("alter table public.posts enable row level security");
  });

  it("keeps platform switches out of the publishing worker", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain('job.type === "PUBLISH"');
    expect(worker).toContain("adapter.publish");
    expect(worker).toContain("capabilities.publishing");
    expect(worker).toContain("prepareAccountAdapter");
  });
});
