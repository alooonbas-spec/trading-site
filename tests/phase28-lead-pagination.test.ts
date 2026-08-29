import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 28 lead page pagination", () => {
  it("pages lead inbox and interactions with independent keysets", () => {
    const inbox = readFileSync("services/inbox/query-service.ts", "utf8");
    const interactions = readFileSync("services/leads/interaction-service.ts", "utf8");
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/leads/[leadId]/page.tsx", "utf8");

    expect(inbox).toContain("listInboxEventsForLead");
    expect(inbox).toContain("parseKeysetCursor(after)");
    expect(inbox).toContain("INBOX_PAGE_SIZE + 1");
    expect(inbox).not.toMatch(/offset\(/i);

    expect(interactions).toContain("parseKeysetCursor(after)");
    expect(interactions).toContain("INTERACTION_PAGE_SIZE + 1");
    expect(interactions).not.toMatch(/offset\(/i);
    expect(interactions).not.toContain("do_not_contact");

    expect(page).toContain("searchParams");
    expect(page).toContain("query.inbox");
    expect(page).toContain("query.timeline");
    expect(page).toContain("ListPagination");
    expect(page).toContain("created_at keyset");
    expect(page).toContain("do_not_contact");
    expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
  });
});
