-- PHASE 13: inbound inbox events and INBOX jobs.
-- do_not_contact stays only on public.leads. Recording replies is allowed even when that flag is true.

alter type public.job_type add value 'INBOX';
alter type public.interaction_type add value 'REPLY';

create table public.inbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  external_id text not null check (char_length(trim(external_id)) >= 1),
  external_profile_id text not null check (char_length(trim(external_profile_id)) >= 1),
  username text,
  body text not null,
  url text,
  received_at timestamptz,
  lead_id uuid references public.leads (id) on delete set null,
  social_profile_id uuid references public.social_profiles (id) on delete set null,
  relationship_id uuid references public.contact_relationships (id) on delete set null,
  matched boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, social_account_id, external_id)
);

create index idx_inbox_events_workspace_id on public.inbox_events (workspace_id);
create index idx_inbox_events_social_account_id on public.inbox_events (social_account_id);
create index idx_inbox_events_lead_id on public.inbox_events (lead_id);
create index idx_inbox_events_created_at on public.inbox_events (created_at);

alter table public.jobs drop constraint jobs_shape;
alter table public.jobs
  add constraint jobs_shape check (
    (
      type = 'CONTACT'
      and lead_id is not null
      and action is not null
      and social_account_id is not null
    )
    or
    (
      type = 'PUBLISH'
      and post_id is not null
      and post_target_id is not null
      and social_account_id is not null
    )
    or
    (
      type = 'MONITOR'
      and monitoring_rule_id is not null
    )
    or
    (
      type = 'INBOX'
      and social_account_id is not null
      and campaign_id is null
      and post_id is null
      and monitoring_rule_id is null
    )
  );

alter table public.inbox_events enable row level security;
alter table public.inbox_events force row level security;

create policy inbox_events_select on public.inbox_events
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy inbox_events_insert on public.inbox_events
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy inbox_events_update on public.inbox_events
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

revoke all on public.inbox_events from anon, authenticated;
grant select, insert, update on public.inbox_events to authenticated, service_role;
