-- PHASE 4: campaigns, job queue, account rate-limit buckets.
-- do_not_contact must not be added here. It belongs only on public.leads.

create type public.campaign_status as enum (
  'DRAFT',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED'
);

create type public.job_status as enum (
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'RETRY',
  'CANCELLED'
);

create type public.campaign_action as enum (
  'INVITE',
  'MESSAGE',
  'OPEN_PROFILE',
  'MANUAL_ACTION_REQUIRED'
);

create type public.job_type as enum (
  'CONTACT'
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 80),
  description text,
  status public.campaign_status not null default 'DRAFT',
  action public.campaign_action not null,
  body text,
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create table public.campaign_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, social_account_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  social_profile_id uuid references public.social_profiles (id) on delete set null,
  relationship_id uuid references public.contact_relationships (id) on delete set null,
  type public.job_type not null default 'CONTACT',
  action public.campaign_action not null,
  body text,
  status public.job_status not null default 'PENDING',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts >= 1),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.account_rate_buckets (
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  window_start timestamptz not null,
  action_count integer not null default 0 check (action_count >= 0),
  primary key (social_account_id, window_start)
);

create index idx_campaigns_workspace_id on public.campaigns (workspace_id);
create index idx_campaigns_status on public.campaigns (status);
create index idx_campaigns_created_at on public.campaigns (created_at);
create index idx_campaign_leads_workspace_id on public.campaign_leads (workspace_id);
create index idx_campaign_leads_campaign_id on public.campaign_leads (campaign_id);
create index idx_campaign_leads_lead_id on public.campaign_leads (lead_id);
create index idx_campaign_accounts_workspace_id on public.campaign_accounts (workspace_id);
create index idx_campaign_accounts_campaign_id on public.campaign_accounts (campaign_id);
create index idx_campaign_accounts_social_account_id on public.campaign_accounts (social_account_id);
create index idx_jobs_workspace_id on public.jobs (workspace_id);
create index idx_jobs_campaign_id on public.jobs (campaign_id);
create index idx_jobs_social_account_id on public.jobs (social_account_id);
create index idx_jobs_lead_id on public.jobs (lead_id);
create index idx_jobs_status_run_after on public.jobs (status, run_after);
create index idx_jobs_created_at on public.jobs (created_at);
create index idx_account_rate_buckets_window_start on public.account_rate_buckets (window_start);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.campaign_accounts enable row level security;
alter table public.jobs enable row level security;
alter table public.account_rate_buckets enable row level security;

alter table public.campaigns force row level security;
alter table public.campaign_leads force row level security;
alter table public.campaign_accounts force row level security;
alter table public.jobs force row level security;
alter table public.account_rate_buckets force row level security;

create policy campaigns_select on public.campaigns
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy campaigns_insert on public.campaigns
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy campaigns_update on public.campaigns
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy campaigns_delete on public.campaigns
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy campaign_leads_select on public.campaign_leads
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy campaign_leads_insert on public.campaign_leads
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy campaign_leads_delete on public.campaign_leads
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy campaign_accounts_select on public.campaign_accounts
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy campaign_accounts_insert on public.campaign_accounts
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy campaign_accounts_delete on public.campaign_accounts
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy jobs_select on public.jobs
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy jobs_update on public.jobs
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy account_rate_buckets_select on public.account_rate_buckets
  for select to authenticated
  using (
    exists (
      select 1
      from public.social_accounts s
      where s.id = social_account_id
        and private.is_workspace_member(s.workspace_id)
    )
  );

revoke all on public.campaigns from anon, authenticated;
revoke all on public.campaign_leads from anon, authenticated;
revoke all on public.campaign_accounts from anon, authenticated;
revoke all on public.jobs from anon, authenticated;
revoke all on public.account_rate_buckets from anon, authenticated;

grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, delete on public.campaign_leads to authenticated;
grant select, insert, delete on public.campaign_accounts to authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select on public.account_rate_buckets to authenticated;

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
    where j.workspace_id = p_workspace_id
      and j.status in ('PENDING', 'RETRY')
      and j.run_after <= now()
      and (j.campaign_id is null or c.status = 'RUNNING')
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

create or replace function public.increment_account_rate_bucket(
  p_account_id uuid,
  p_window_start timestamptz,
  p_max integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_count integer;
begin
  select s.workspace_id into v_workspace_id
  from public.social_accounts s
  where s.id = p_account_id;

  if v_workspace_id is null then
    raise exception 'Social account not found';
  end if;

  if not private.has_workspace_role(
    v_workspace_id,
    array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
  ) then
    raise exception 'Only owners, admins, and operators can consume rate-limit slots';
  end if;

  insert into public.account_rate_buckets (social_account_id, window_start, action_count)
  values (p_account_id, p_window_start, 1)
  on conflict (social_account_id, window_start)
  do update set action_count = public.account_rate_buckets.action_count + 1
  returning public.account_rate_buckets.action_count into v_count;

  if v_count > p_max then
    update public.account_rate_buckets
    set action_count = p_max
    where social_account_id = p_account_id
      and window_start = p_window_start;
    return v_count;
  end if;

  return v_count;
end;
$$;

revoke all on function public.claim_jobs(uuid, integer, text) from public;
revoke all on function public.increment_account_rate_bucket(uuid, timestamptz, integer) from public;
grant execute on function public.claim_jobs(uuid, integer, text) to authenticated;
grant execute on function public.increment_account_rate_bucket(uuid, timestamptz, integer) to authenticated;

create or replace function public.read_social_account_secrets(p_account_id uuid)
returns table (
  access_token_encrypted text,
  refresh_token_encrypted text,
  metadata jsonb,
  platform public.social_platform,
  status public.social_account_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select s.workspace_id into v_workspace_id
  from public.social_accounts s
  where s.id = p_account_id;

  if v_workspace_id is null then
    raise exception 'Social account not found';
  end if;

  if not private.has_workspace_role(
    v_workspace_id,
    array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
  ) then
    raise exception 'Only owners, admins, and operators can read social account secrets';
  end if;

  return query
    select
      s.access_token_encrypted,
      s.refresh_token_encrypted,
      s.metadata,
      s.platform,
      s.status
    from public.social_accounts s
    where s.id = p_account_id;
end;
$$;
