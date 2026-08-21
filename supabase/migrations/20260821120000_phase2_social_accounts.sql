-- PHASE 2: multi-account social connections, OAuth state, account groups.
-- do_not_contact must not be added to these tables. It belongs only on public.leads.

create type public.social_account_status as enum (
  'CONNECTED',
  'DISCONNECTED',
  'EXPIRED',
  'ERROR',
  'REAUTH_REQUIRED'
);

create type public.social_platform as enum (
  'telegram',
  'vk',
  'x',
  'instagram',
  'facebook'
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform public.social_platform not null,
  external_account_id text not null,
  username text,
  display_name text,
  avatar_url text,
  status public.social_account_status not null default 'CONNECTED',
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

create table public.account_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 80),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.account_group_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  group_id uuid not null references public.account_groups (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, social_account_id)
);

create table public.oauth_states (
  state text primary key check (char_length(state) >= 32),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform public.social_platform not null,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_social_accounts_workspace_id on public.social_accounts (workspace_id);
create index idx_social_accounts_platform on public.social_accounts (platform);
create index idx_social_accounts_status on public.social_accounts (status);
create index idx_social_accounts_created_at on public.social_accounts (created_at);
create index idx_account_groups_workspace_id on public.account_groups (workspace_id);
create index idx_account_group_members_workspace_id on public.account_group_members (workspace_id);
create index idx_account_group_members_group_id on public.account_group_members (group_id);
create index idx_account_group_members_social_account_id on public.account_group_members (social_account_id);
create index idx_oauth_states_workspace_id on public.oauth_states (workspace_id);
create index idx_oauth_states_user_id on public.oauth_states (user_id);
create index idx_oauth_states_expires_at on public.oauth_states (expires_at);
create index idx_activity_log_social_account_id on public.activity_log (social_account_id);

create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

create trigger account_groups_set_updated_at
  before update on public.account_groups
  for each row execute function public.set_updated_at();

alter table public.social_accounts enable row level security;
alter table public.account_groups enable row level security;
alter table public.account_group_members enable row level security;
alter table public.oauth_states enable row level security;

alter table public.social_accounts force row level security;
alter table public.account_groups force row level security;
alter table public.account_group_members force row level security;
alter table public.oauth_states force row level security;

create policy social_accounts_select on public.social_accounts
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy social_accounts_insert on public.social_accounts
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy social_accounts_update on public.social_accounts
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy social_accounts_delete on public.social_accounts
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy account_groups_select on public.account_groups
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy account_groups_insert on public.account_groups
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy account_groups_update on public.account_groups
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy account_groups_delete on public.account_groups
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy account_group_members_select on public.account_group_members
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy account_group_members_insert on public.account_group_members
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy account_group_members_delete on public.account_group_members
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy oauth_states_select on public.oauth_states
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy oauth_states_insert on public.oauth_states
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[])
  );

create policy oauth_states_delete on public.oauth_states
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy activity_log_insert on public.activity_log
  for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and (user_id is null or user_id = (select auth.uid()))
  );

revoke all on public.social_accounts from anon, authenticated;
revoke all on public.account_groups from anon, authenticated;
revoke all on public.account_group_members from anon, authenticated;
revoke all on public.oauth_states from anon, authenticated;

grant select (
  id,
  workspace_id,
  platform,
  external_account_id,
  username,
  display_name,
  avatar_url,
  status,
  token_expires_at,
  scopes,
  metadata,
  last_sync_at,
  last_error,
  last_error_at,
  created_at,
  updated_at
) on public.social_accounts to authenticated;
grant insert, update, delete on public.social_accounts to authenticated;
grant select, insert, update, delete on public.account_groups to authenticated;
grant select, insert, delete on public.account_group_members to authenticated;
grant select, insert, delete on public.oauth_states to authenticated;
grant insert on public.activity_log to authenticated;

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

  if not private.has_workspace_role(v_workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]) then
    raise exception 'Only owners and admins can read social account secrets';
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

revoke all on function public.read_social_account_secrets(uuid) from public;
grant execute on function public.read_social_account_secrets(uuid) to authenticated;
