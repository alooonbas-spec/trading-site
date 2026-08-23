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

  it("filters the invite role picker by canAssignRole, not just the change-role picker", () => {
    // add_workspace_member (the SQL RPC behind inviteMemberAction) rejects an
    // ADMIN actor assigning ADMIN -- the invite form previously listed every
    // ASSIGNABLE_ROLES option unconditionally, so an ADMIN could pick "ADMIN"
    // in the UI and always get a rejected request. members-table.tsx already
    // disabled options with canAssignRole for the role-change picker; the
    // invite form needs the same guard.
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/settings/page.tsx", "utf8");
    expect(page).toContain("<InviteMemberForm");
    expect(page).toMatch(/InviteMemberForm[\s\S]*?currentRole=\{context\.role\}/);

    const form = readFileSync("components/settings/invite-member-form.tsx", "utf8");
    expect(form).toContain('import { canAssignRole } from "@/lib/auth/permissions"');
    expect(form).toContain("currentRole");
    expect(form).toMatch(/disabled=\{!canAssignRole\(currentRole,\s*assignableRole\)\}/);
  });
});
