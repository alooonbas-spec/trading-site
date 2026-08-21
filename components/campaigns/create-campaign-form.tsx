"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCampaignAction, idleActionState } from "@/app/actions/campaigns";
import { CAMPAIGN_ACTIONS } from "@/types/campaign";
import type { Lead } from "@/types/crm";
import type { SocialAccountPublic } from "@/types/social-account";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";

export function CreateCampaignForm({
  workspaceId,
  leads,
  accounts,
}: {
  workspaceId: string;
  leads: Lead[];
  accounts: SocialAccountPublic[];
}) {
  const action = createCampaignAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="campaign-name">Name</Label>
          <Input id="campaign-name" name="name" required minLength={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="campaign-action">Action</Label>
          <select
            id="campaign-action"
            name="action"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            defaultValue="MESSAGE"
          >
            {CAMPAIGN_ACTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="campaign-description">Description</Label>
        <Textarea id="campaign-description" name="description" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="campaign-body">Message body</Label>
        <Textarea id="campaign-body" name="body" />
        <p className="text-xs text-muted-foreground">
          INVITE and MESSAGE jobs call the platform adapter. Until adapters enable contact actions,
          those jobs fail instead of reporting fake success.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Leads</Label>
        {selectedLeads.map((id) => (
          <input key={id} type="hidden" name="leadIds" value={id} />
        ))}
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-3">
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Create leads before starting a campaign.</p>
          ) : (
            leads.map((lead) => (
              <label key={lead.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selectedLeads.includes(lead.id)}
                  onChange={() =>
                    setSelectedLeads((current) =>
                      current.includes(lead.id)
                        ? current.filter((id) => id !== lead.id)
                        : [...current, lead.id],
                    )
                  }
                />
                <span>
                  {lead.displayName}
                  {lead.doNotContact ? " · DNC" : ""}
                </span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Social accounts</Label>
        <SocialAccountSelector
          accounts={accounts}
          value={selectedAccounts}
          onChange={setSelectedAccounts}
          name="accountIds"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create campaign"}
      </Button>
    </form>
  );
}
