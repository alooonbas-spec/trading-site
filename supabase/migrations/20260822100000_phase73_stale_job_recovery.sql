-- PHASE 73: reclaim jobs stuck in RUNNING when a worker crashes or times out
-- mid-job, instead of leaving them locked forever. A job is stale once its
-- lock (locked_at) is older than 15 minutes. Stale jobs that still have
-- attempts left are reclaimed exactly like a fresh PENDING/RETRY claim
-- (attempts increments, same as any other claim). A job that crashes on
-- its very last allowed attempt stays RUNNING and stale rather than being
-- retried forever; locked_at makes that state visible for an operator to
-- investigate. do_not_contact must not be added here. It belongs only on
-- public.leads.

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
      and (
        j.status in ('PENDING', 'RETRY')
        or (
          j.status = 'RUNNING'
          and j.locked_at < now() - interval '15 minutes'
          and j.attempts < j.max_attempts
        )
      )
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
    where (
        j.status in ('PENDING', 'RETRY')
        or (
          j.status = 'RUNNING'
          and j.locked_at < now() - interval '15 minutes'
          and j.attempts < j.max_attempts
        )
      )
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

revoke all on function public.claim_jobs(uuid, integer, text) from public;
revoke all on function public.claim_due_jobs(integer, text) from public;

grant execute on function public.claim_jobs(uuid, integer, text) to authenticated, service_role;
grant execute on function public.claim_due_jobs(integer, text) to service_role;
