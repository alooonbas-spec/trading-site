"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from "@/types/social";
import { SOCIAL_ACCOUNT_STATUSES } from "@/types/status";
import type { AccountGroup } from "@/types/social-account";
import {
  ACCOUNT_PICKER_LIMIT_HINT,
  type PickerAccount,
} from "@/lib/social-accounts/picker";
import { searchPickerAccountsAction, type PickerAccountState } from "@/app/actions/social-accounts";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function SocialAccountSelector({
  workspaceId,
  initialAccounts,
  initialHasMore,
  groups = [],
  name,
  multiple = true,
}: {
  workspaceId: string;
  initialAccounts: PickerAccount[];
  initialHasMore: boolean;
  groups?: AccountGroup[];
  name?: string;
  multiple?: boolean;
}) {
  const [selected, setSelected] = useState<PickerAccount[]>([]);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [groupId, setGroupId] = useState("all");
  const initialPicker: PickerAccountState = {
    error: null,
    query: "",
    accounts: initialAccounts,
    hasMore: initialHasMore,
  };
  const [picker, searchAccounts, searching] = useActionState(
    searchPickerAccountsAction.bind(null, workspaceId),
    initialPicker,
  );
  const selectedGroup = groups.find((group) => group.id === groupId);
  const filtered = useMemo(
    () =>
      selectedGroup
        ? picker.accounts.filter((account) => selectedGroup.accountIds.includes(account.id))
        : picker.accounts,
    [picker.accounts, selectedGroup],
  );
  const visibleIds = new Set(filtered.map((account) => account.id));
  const selectedOutsideResults = selected.filter((account) => !visibleIds.has(account.id));

  function runSearch(nextPlatform = platform, nextStatus = status) {
    const data = new FormData();
    data.set("q", search);
    data.set("platform", nextPlatform);
    data.set("status", nextStatus);
    startTransition(() => {
      searchAccounts(data);
    });
  }

  function toggle(account: PickerAccount) {
    setSelected((current) => {
      const exists = current.some((item) => item.id === account.id);
      if (multiple) {
        return exists ? current.filter((item) => item.id !== account.id) : [...current, account];
      }
      return exists ? [] : [account];
    });
  }

  return (
    <div className="space-y-3">
      {name
        ? selected.map((account) => <input key={account.id} type="hidden" name={name} value={account.id} />)
        : null}
      <div className="grid gap-2 md:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search username or id"
          autoComplete="off"
        />
        <select
          value={platform}
          onChange={(event) => {
            const next = event.target.value;
            setPlatform(next);
            runSearch(next, status);
          }}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All platforms</option>
          {SOCIAL_PLATFORMS.map((item) => (
            <option key={item} value={item}>
              {SOCIAL_PLATFORM_LABELS[item]}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => {
            const next = event.target.value;
            setStatus(next);
            runSearch(platform, next);
          }}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          {SOCIAL_ACCOUNT_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {groups.length > 0 ? (
          <select
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        ) : (
          <Button type="button" variant="outline" disabled={searching} onClick={() => runSearch()}>
            {searching ? "Searching..." : "Search"}
          </Button>
        )}
      </div>
      {groups.length > 0 ? (
        <Button type="button" variant="outline" disabled={searching} onClick={() => runSearch()}>
          {searching ? "Searching..." : "Search"}
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">{ACCOUNT_PICKER_LIMIT_HINT}</p>
      {picker.hasMore ? (
        <p className="text-xs text-muted-foreground">More than 200 accounts match. Refine the search.</p>
      ) : null}
      {picker.error ? <p className="text-sm text-destructive">{picker.error}</p> : null}
      <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
        {selectedOutsideResults.length > 0 ? (
          <p className="text-xs text-muted-foreground">Selected</p>
        ) : null}
        {selectedOutsideResults.map((account) => (
          <AccountPickerRow
            key={`selected-${account.id}`}
            account={account}
            checked
            onToggle={() => toggle(account)}
          />
        ))}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching accounts. Search or connect an account first.</p>
        ) : (
          filtered.map((account) => (
            <AccountPickerRow
              key={account.id}
              account={account}
              checked={selected.some((item) => item.id === account.id)}
              onToggle={() => toggle(account)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AccountPickerRow({
  account,
  checked,
  onToggle,
}: {
  account: PickerAccount;
  checked: boolean;
  onToggle: () => void;
}) {
  const label = account.username ?? account.displayName ?? account.externalAccountId;
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
      <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={onToggle} />
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
}
