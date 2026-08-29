-- PHASE 7: monitoring rules, events, and MONITOR jobs.
-- do_not_contact stays only on public.leads. Never add it to monitoring tables.

alter type public.job_type add value 'MONITOR';

create type public.monitoring_rule_status as enum (
  'ACTIVE',
  'PAUSED',
  'DISABLED'
);

create table public.monitoring_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 80),
  keywords text[] not null check (cardinality(keywords) >= 1),
  sources text[] not null default '{}'::text[],
  social_account_id uuid references public.social_accounts (id) on delete set null,
  platform public.social_platform not null,
  status public.monitoring_rule_status not null default 'ACTIVE',
  cursor text,
  last_run_at timestamptz,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.monitoring_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule_id uuid not null references public.monitoring_rules (id) on delete cascade,
  social_account_id uuid references public.social_accounts (id) on delete set null,
  external_id text not null,
  author text,
  content text not null,
  url text,
  matched_keywords text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (workspace_id, rule_id, external_id)
);

alter table public.jobs
  add column monitoring_rule_id uuid references public.monitoring_rules (id) on delete cascade;

alter table public.jobs
  alter column social_account_id drop not null;

alter table public.jobs
  drop constraint jobs_shape;

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
  );

create index idx_monitoring_rules_workspace_id on public.monitoring_rules (workspace_id);
create index idx_monitoring_rules_status on public.monitoring_rules (status);
create index idx_monitoring_rules_social_account_id on public.monitoring_rules (social_account_id);
create index idx_monitoring_rules_created_at on public.monitoring_rules (created_at);
create index idx_monitoring_events_workspace_id on public.monitoring_events (workspace_id);
create index idx_monitoring_events_rule_id on public.monitoring_events (rule_id);
create index idx_monitoring_events_created_at on public.monitoring_events (created_at);
create index idx_jobs_monitoring_rule_id on public.jobs (monitoring_rule_id);

create trigger monitoring_rules_set_updated_at
  before update on public.monitoring_rules
  for each row execute function public.set_updated_at();

alter table public.monitoring_rules enable row level security;
alter table public.monitoring_events enable row level security;
alter table public.monitoring_rules force row level security;
alter table public.monitoring_events force row level security;

create policy monitoring_rules_select on public.monitoring_rules
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy monitoring_rules_insert on public.monitoring_rules
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy monitoring_rules_update on public.monitoring_rules
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy monitoring_rules_delete on public.monitoring_rules
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy monitoring_events_select on public.monitoring_events
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy monitoring_events_insert on public.monitoring_events
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

revoke all on public.monitoring_rules from anon, authenticated;
revoke all on public.monitoring_events from anon, authenticated;
grant select, insert, update, delete on public.monitoring_rules to authenticated;
grant select, insert on public.monitoring_events to authenticated;

create or replace function public.claim_jobs(p_workspace_id uuid, p_limit integer, p_worker_id text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_workspace_role(
    p_workspace_id,
    array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
  ) then
    raise exception 'Only owners, admins, and operators can process jobs';
  end if;

  return query
  with picked as (
    select j.id
    from public.jobs j
    left join public.campaigns c on c.id = j.campaign_id
    left join public.monitoring_rules r on r.id = j.monitoring_rule_id
    where j.workspace_id = p_workspace_id
      and j.status in ('PENDING', 'RETRY')
      and j.run_after <= now()
      and (j.campaign_id is null or c.status = 'RUNNING')
      and (j.monitoring_rule_id is null or r.status = 'ACTIVE')
    order by j.run_after, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.jobs as job
  set
    status = 'RUNNING',
    locked_at = now(),
    locked_by = p_worker_id,
    attempts = job.attempts + 1,
    last_error = null
  from picked
  where job.id = picked.id
  returning job.*;
end;
$$;
