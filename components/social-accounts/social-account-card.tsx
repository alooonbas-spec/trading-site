"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { disconnectAccountAction, refreshAccountAction } from "@/app/actions/social-accounts";
import { PublishDestinationForm } from "@/components/social-accounts/publish-destination-form";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import type { SocialAccountHealth } from "@/types/social-account";

export function SocialAccountCard({
  health,
  workspaceId,
  canManage,
}: {
  health: SocialAccountHealth;
  workspaceId: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const account = health.account;
  const label = account.username ?? account.displayName ?? account.externalAccountId;

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {SOCIAL_PLATFORM_LABELS[account.platform]} {label}
        </CardDescription>
        <CardTitle className="flex items-center gap-2 text-lg">
          {account.status}
          <Badge variant="secondary">{health.tokenStatus}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Last sync: {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : "Never"}</p>
        <p>Last action: {health.lastAction ?? "None"}</p>
        <p>Queue: {health.queueCount}</p>
        <p>Errors: {account.lastError ?? "0"}</p>
        {canManage && account.platform === "facebook" ? (
          <PublishDestinationForm
            workspaceId={workspaceId}
            accountId={account.id}
            field="pageId"
            label="Facebook Page ID"
            placeholder="Page id from /me/accounts"
            hint="Required when the user manages more than one Page. Existing accounts must reconnect to grant pages_manage_posts."
          />
        ) : null}
        {canManage && account.platform === "vk" ? (
          <PublishDestinationForm
            workspaceId={workspaceId}
            accountId={account.id}
            field="publishOwnerId"
            label="VK wall owner (optional)"
            placeholder="-communityId or user id"
            hint="Leave empty to post on the user wall. Negative ids post to a community. Reconnect to grant wall and photos."
          />
        ) : null}
        {canManage && account.platform === "telegram" ? (
          <PublishDestinationForm
            workspaceId={workspaceId}
            accountId={account.id}
            field="publishChatId"
            label="Telegram publish chat"
            placeholder="@channel or chat id"
            hint="Channel or group the bot can post to."
          />
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => refreshAccountAction(workspaceId, account.id))}
            >
              Refresh health
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || account.status === "DISCONNECTED"}
              onClick={() => run(() => disconnectAccountAction(workspaceId, account.id))}
            >
              Disconnect
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
