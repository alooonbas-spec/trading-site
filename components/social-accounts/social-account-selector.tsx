"use client";

import { useMemo, useState } from "react";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/types/social";
import { SOCIAL_ACCOUNT_STATUSES, type SocialAccountStatus } from "@/types/status";
import type { AccountGroup, SocialAccountPublic } from "@/types/social-account";
import { filterSocialAccounts } from "@/lib/social/filter-accounts";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SocialAccountSelector({
  accounts,
  groups = [],
  value,
  onChange,
  multiple = true,
  name,
}: {
  accounts: SocialAccountPublic[];
  groups?: AccountGroup[];
  value: string[];
  onChange: (accountIds: string[]) => void;
  multiple?: boolean;
  name?: string;
}) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<SocialPlatform | "all">("all");
  const [status, setStatus] = useState<SocialAccountStatus | "all">("all");
  const [groupId, setGroupId] = useState<string>("all");

  const selectedGroup = groups.find((group) => group.id === groupId);
  const filtered = useMemo(
    () =>
      filterSocialAccounts(accounts, {
        query,
        platforms: platform === "all" ? undefined : [platform],
        statuses: status === "all" ? undefined : [status],
        groupAccountIds: selectedGroup?.accountIds,
      }),
    [accounts, query, platform, status, selectedGroup],
  );

  function toggle(accountId: string) {
    if (multiple) {
      onChange(
        value.includes(accountId) ? value.filter((id) => id !== accountId) : [...value, accountId],
      );
      return;
    }

    onChange(value[0] === accountId ? [] : [accountId]);
  }

  return (
    <div className="space-y-3">
      {name
        ? value.map((id) => <input key={id} type="hidden" name={name} value={id} />)
        : null}
      <div className="grid gap-2 md:grid-cols-4">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search accounts"
        />
        <Select
          value={platform}
          onValueChange={(next) => setPlatform((next as SocialPlatform | "all") ?? "all")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {Object.entries(SOCIAL_PLATFORM_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(next) => setStatus((next as SocialAccountStatus | "all") ?? "all")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SOCIAL_ACCOUNT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupId} onValueChange={(next) => setGroupId(next ?? "all")}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 rounded-xl border border-border p-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts match these filters.</p>
        ) : (
          filtered.map((account) => {
            const checked = value.includes(account.id);
            const label = account.username ?? account.displayName ?? account.externalAccountId;
            return (
              <label
                key={account.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={checked}
                  onChange={() => toggle(account.id)}
                />
                <Avatar size="sm">
                  {account.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{label.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {SOCIAL_PLATFORM_LABELS[account.platform]} {label}
                  </p>
                  <p className="text-xs text-muted-foreground">{account.externalAccountId}</p>
                </div>
                <Badge variant="secondary">{account.status}</Badge>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
