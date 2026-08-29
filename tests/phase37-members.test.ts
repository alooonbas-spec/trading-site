import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function unboundedListBody(source: string, exportName: string, nextExportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  const end = source.indexOf(`export async function ${nextExportName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("PHASE 37 workspace member pagination", () => {
  it("pages members with a created_at keyset and keeps unbounded listWorkspaceMembers without LIMIT", () => {
    const service = readFileSync("services/workspaces/queries.ts", "utf8");
    expect(unboundedListBody(service, "listWorkspaceMembers", "listWorkspaceMembersPage")).not.toContain(
      ".limit(",
    );
    expect(unboundedListBody(service, "listWorkspaceMembers", "listWorkspaceMembersPage")).not.toContain(
      "parseKeysetCursor",
    );
    expect(service).toContain("listWorkspaceMembersPage");
    expect(service).toContain("MEMBER_PAGE_SIZE + 1");
    expect(service).toContain("parseKeysetCursor");
    expect(service).toContain("keysetOrFilter");
    expect(service).toContain("nextKeysetCursor");
    expect(service).not.toMatch(/offset\(/i);
    expect(service).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(service).not.toContain("do_not_contact");
  });

  it("exposes Newest/Older links on Settings and keeps created_at keyset copy", () => {
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/settings/page.tsx", "utf8");
    expect(page).toContain("listWorkspaceMembersPage");
    expect(page).not.toContain("listWorkspaceMembers(");
    expect(page).toContain("ListPagination");
    expect(page).toContain("created_at keyset");
    expect(page).toContain("query.after");
    expect(page).not.toContain('name="after"');
    expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
  });
});
