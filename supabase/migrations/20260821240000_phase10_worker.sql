-- PHASE 10: background worker can claim due jobs across workspaces.
-- do_not_contact must not be added here. It belongs only on public.leads.

create or replace function private.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role() = 'service_role', false);
$$;

create or replace function public.claim_jobs(p_workspace_id uuid, p_limit integer, p_worker_id text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role()
    and not private.has_workspace_role(
      p_workspace_id,
      array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
    )
  then
    raise exception 'Only owners, admins, operators, or the background worker can process jobs';
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

create or replace function public.claim_due_jobs(p_limit integer, p_worker_id text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception 'Only the background worker can claim due jobs across workspaces';
  end if;

  return query
  with picked as (
    select j.id
    from public.jobs j
    left join public.campaigns c on c.id = j.campaign_id
    left join public.monitoring_rules r on r.id = j.monitoring_rule_id
    where j.status in ('PENDING', 'RETRY')
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

  if not private.is_service_role()
    and not private.has_workspace_role(
      v_workspace_id,
      array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
    )
  then
    raise exception 'Only owners, admins, operators, or the background worker can consume rate-limit slots';
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

  if not private.is_service_role()
    and not private.has_workspace_role(
      v_workspace_id,
      array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]
    )
  then
    raise exception 'Only owners, admins, operators, or the background worker can read social account secrets';
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

revoke all on function public.claim_jobs(uuid, integer, text) from public;
revoke all on function public.claim_due_jobs(integer, text) from public;
revoke all on function public.increment_account_rate_bucket(uuid, timestamptz, integer) from public;
revoke all on function public.read_social_account_secrets(uuid) from public;

grant execute on function public.claim_jobs(uuid, integer, text) to authenticated, service_role;
grant execute on function public.claim_due_jobs(integer, text) to service_role;
grant execute on function public.increment_account_rate_bucket(uuid, timestamptz, integer) to authenticated, service_role;
grant execute on function public.read_social_account_secrets(uuid) to authenticated, service_role;
