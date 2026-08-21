"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { canAssignRole } from "@/lib/auth/permissions";
import { ASSIGNABLE_ROLES } from "@/lib/validation/workspace";
import { removeMemberAction, updateMemberRoleAction } from "@/app/actions/workspace";
import type { WorkspaceMemberView } from "@/services/workspaces/queries";
import type { WorkspaceRole } from "@/types/status";

export function MembersTable({
  workspaceId,
  members,
  currentUserId,
  currentRole,
}: {
  workspaceId: string;
  members: WorkspaceMemberView[];
  currentUserId: string;
  currentRole: WorkspaceRole;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeRole(userId: string, role: string | null) {
    if (!role || role === "OWNER") {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction(
        workspaceId,
        userId,
        role as Exclude<WorkspaceRole, "OWNER">,
      );
      if (result.error) {
        setError(result.error);
      }
    });
  }

  function remove(userId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(workspaceId, userId);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const canRemove =
              member.userId === currentUserId ||
              (currentRole === "OWNER" && members.filter((item) => item.role === "OWNER").length > 1) ||
              (currentRole === "ADMIN" && (member.role === "OPERATOR" || member.role === "VIEWER"));

            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{member.displayName ?? member.email}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </TableCell>
                <TableCell>
                  {member.role === "OWNER" || !canAssignRole(currentRole, member.role) ? (
                    <Badge variant="secondary">{member.role}</Badge>
                  ) : (
                    <Select
                      value={member.role}
                      onValueChange={(value) => changeRole(member.userId, value)}
                      disabled={pending}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((role) => (
                          <SelectItem key={role} value={role} disabled={!canAssignRole(currentRole, role)}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canRemove && member.role !== "OWNER" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(member.userId)}
                    >
                      Remove
                    </Button>
                  ) : member.userId === currentUserId && member.role !== "OWNER" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(member.userId)}
                    >
                      Leave
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
