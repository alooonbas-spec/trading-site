"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCampaignAction, idleActionState } from "@/app/actions/campaigns";
import { searchPickerLeadsAction, type PickerLeadState } from "@/app/actions/leads";
import { CAMPAIGN_ACTIONS } from "@/types/campaign";
import { LEAD_PICKER_LIMIT_HINT, type PickerLead } from "@/lib/leads/picker";
import type { SocialAccountPublic } from "@/types/social-account";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";

export function CreateCampaignForm({
  workspaceId,
  initialLeads,
  initialHasMore,
  accounts,
}: {
  workspaceId: string;
  initialLeads: PickerLead[];
  initialHasMore: boolean;
  accounts: SocialAccountPublic[];
}) {
  const action = createCampaignAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<PickerLead[]>([]);
  const [search, setSearch] = useState("");
  const initialPicker: PickerLeadState = {
    error: null,
    query: "",
    leads: initialLeads,
    hasMore: initialHasMore,
  };
  const [picker, searchLeads, searching] = useActionState(
    searchPickerLeadsAction.bind(null, workspaceId),
    initialPicker,
  );
  const visibleIds = new Set(picker.leads.map((lead) => lead.id));
  const selectedOutsideResults = selectedLeads.filter((lead) => !visibleIds.has(lead.id));

  function toggleLead(lead: PickerLead) {
    setSelectedLeads((current) =>
      current.some((item) => item.id === lead.id)
        ? current.filter((item) => item.id !== lead.id)
        : [...current, lead],
    );
  }

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
          MESSAGE starts for Telegram bots, X Direct Messages, Facebook Page Messenger, and Instagram
          professional DMs. Facebook and Instagram can only message people who already opened a
          conversation (24-hour window). INVITE is not enabled on any adapter yet, so start fails
          instead of queuing jobs that cannot send. OPEN_PROFILE and MANUAL_ACTION_REQUIRED still
          enqueue without an adapter send.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Leads</Label>
        {selectedLeads.map((lead) => (
          <input key={lead.id} type="hidden" name="leadIds" value={lead.id} />
        ))}
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, phone"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            disabled={searching}
            onClick={() => {
              const data = new FormData();
              data.set("q", search);
              startTransition(() => {
                searchLeads(data);
              });
            }}
          >
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{LEAD_PICKER_LIMIT_HINT}</p>
        {picker.hasMore ? (
          <p className="text-xs text-muted-foreground">More than 200 leads match. Refine the search.</p>
        ) : null}
        {picker.error ? <p className="text-sm text-destructive">{picker.error}</p> : null}
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-3">
          {selectedOutsideResults.length > 0 ? (
            <p className="text-xs text-muted-foreground">Selected</p>
          ) : null}
          {selectedOutsideResults.map((lead) => (
            <label key={`selected-${lead.id}`} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked
                onChange={() => toggleLead(lead)}
              />
              <span>
                {lead.displayName}
                {lead.doNotContact ? " · DNC" : ""}
              </span>
            </label>
          ))}
          {picker.leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching leads. Search or create a lead first.</p>
          ) : (
            picker.leads.map((lead) => (
              <label key={lead.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selectedLeads.some((item) => item.id === lead.id)}
                  onChange={() => toggleLead(lead)}
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
