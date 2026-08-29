"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMonitoringRuleAction, idleActionState } from "@/app/actions/monitoring";
import { searchPickerAccountsAction, type PickerAccountState } from "@/app/actions/social-accounts";
import { ACCOUNT_PICKER_LIMIT_HINT, type PickerAccount } from "@/lib/social-accounts/picker";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/types/social";

export function CreateMonitoringRuleForm({
  workspaceId,
  initialAccounts,
  initialHasMore,
}: {
  workspaceId: string;
  initialAccounts: PickerAccount[];
  initialHasMore: boolean;
}) {
  const action = createMonitoringRuleAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [platform, setPlatform] = useState<SocialPlatform>("x");
  const [search, setSearch] = useState("");
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
  const matchingAccounts = picker.accounts.filter((account) => account.platform === platform);

  function runSearch(nextPlatform: SocialPlatform) {
    const data = new FormData();
    data.set("q", search);
    data.set("platform", nextPlatform);
    startTransition(() => {
      searchAccounts(data);
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" name="name" required minLength={2} maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rule-platform">Platform</Label>
          <select
            id="rule-platform"
            name="platform"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={platform}
            onChange={(event) => {
              const next = event.target.value as SocialPlatform;
              setPlatform(next);
              runSearch(next);
            }}
          >
            {SOCIAL_PLATFORMS.map((item) => (
              <option key={item} value={item}>
                {SOCIAL_PLATFORM_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rule-keywords">Keywords</Label>
        <Textarea id="rule-keywords" name="keywords" required placeholder="One keyword per line" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rule-sources">Official sources (optional)</Label>
        <Textarea id="rule-sources" name="sources" placeholder="Official profile or domain URLs, one per line" />
        <p className="text-xs text-muted-foreground">
          Sources must be official platform hosts. Non-official URLs are rejected.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rule-account">Connected account (optional)</Label>
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search username or id"
            autoComplete="off"
          />
          <Button type="button" variant="outline" disabled={searching} onClick={() => runSearch(platform)}>
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>
        <select
          id="rule-account"
          name="socialAccountId"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          defaultValue=""
        >
          <option value="">Public search only</option>
          {matchingAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.username ?? account.displayName ?? account.externalAccountId}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{ACCOUNT_PICKER_LIMIT_HINT}</p>
        {picker.hasMore ? (
          <p className="text-xs text-muted-foreground">More than 200 accounts match. Refine the search.</p>
        ) : null}
        {picker.error ? <p className="text-sm text-destructive">{picker.error}</p> : null}
        <p className="text-xs text-muted-foreground">
          Platform is account identity, not a business-logic switch. A connected X or Telegram account
          uses the official API. Other platforms use TinyFish Search when configured. Missing credentials
          fail instead of reporting fake matches.
        </p>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create rule"}
      </Button>
    </form>
  );
}
