-- PHASE 1 foundation: auth profiles, workspaces, membership, activity log, RLS.
-- do_not_contact must never be added to these tables. It belongs only on public.leads (PHASE 3).

create extension if not exists pgcrypto;

create schema if not exists private;

create type public.workspace_role as enum ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  platform text,
  social_account_id uuid,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_profiles_email on public.profiles (email);
create index idx_workspaces_created_by on public.workspaces (created_by);
create index idx_workspaces_created_at on public.workspaces (created_at);
create index idx_workspace_members_workspace_id on public.workspace_members (workspace_id);
create index idx_workspace_members_user_id on public.workspace_members (user_id);
create index idx_workspace_members_role on public.workspace_members (role);
create index idx_activity_log_workspace_id on public.activity_log (workspace_id);
create index idx_activity_log_user_id on public.activity_log (user_id);
create index idx_activity_log_created_at on public.activity_log (created_at);
create index idx_activity_log_action on public.activity_log (action);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = coalesce(new.email, ''),
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_updated();

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function private.current_workspace_role(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function private.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create or replace function private.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid()
      and b.user_id = p_user_id
  );
$$;

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;

  v_base_slug := public.slugify(trim(p_name));
  if v_base_slug is null or v_base_slug = '' then
    v_base_slug := 'workspace';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.workspaces w where w.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.workspaces (name, slug, created_by)
  values (trim(p_name), v_slug, v_user_id)
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'OWNER');

  insert into public.activity_log (workspace_id, user_id, action, entity_type, entity_id)
  values (v_workspace_id, v_user_id, 'WORKSPACE_CREATED', 'workspace', v_workspace_id);

  return v_workspace_id;
end;
$$;

create or replace function public.update_workspace(p_workspace_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not private.has_workspace_role(p_workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]) then
    raise exception 'Only owners and admins can update this workspace';
  end if;

  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;

  update public.workspaces
  set name = trim(p_name)
  where id = p_workspace_id;

  insert into public.activity_log (workspace_id, user_id, action, entity_type, entity_id)
  values (p_workspace_id, auth.uid(), 'WORKSPACE_UPDATED', 'workspace', p_workspace_id);
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not private.has_workspace_role(p_workspace_id, array['OWNER']::public.workspace_role[]) then
    raise exception 'Only owners can delete this workspace';
  end if;

  delete from public.workspaces where id = p_workspace_id;
end;
$$;

create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.workspace_role;
  v_profile public.profiles%rowtype;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_actor_role := private.current_workspace_role(p_workspace_id);
  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN') then
    raise exception 'Only owners and admins can add members';
  end if;

  if p_role = 'OWNER' then
    raise exception 'Owner role cannot be assigned through invite';
  end if;

  if v_actor_role = 'ADMIN' and p_role not in ('OPERATOR', 'VIEWER') then
    raise exception 'Admins can only assign operator or viewer roles';
  end if;

  select * into v_profile
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if not found then
    raise exception 'User must already have an account';
  end if;

  if v_profile.id = auth.uid() then
    raise exception 'You are already a member of this workspace';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, v_profile.id, p_role)
  on conflict (workspace_id, user_id) do nothing
  returning id into v_member_id;

  if v_member_id is null then
    raise exception 'User is already a member of this workspace';
  end if;

  insert into public.activity_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
  values (
    p_workspace_id,
    auth.uid(),
    'MEMBER_ADDED',
    'workspace_member',
    v_member_id,
    jsonb_build_object('member_user_id', v_profile.id, 'role', p_role)
  );

  return v_member_id;
end;
$$;

create or replace function public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
  v_owner_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_actor_role := private.current_workspace_role(p_workspace_id);
  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN') then
    raise exception 'Only owners and admins can change roles';
  end if;

  if p_role = 'OWNER' then
    raise exception 'Owner role cannot be assigned this way';
  end if;

  select role into v_target_role
  from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'OWNER' then
    select count(*) into v_owner_count
    from public.workspace_members
    where workspace_id = p_workspace_id
      and role = 'OWNER';

    if v_owner_count <= 1 then
      raise exception 'A workspace must keep at least one owner';
    end if;
  end if;

  if v_actor_role = 'ADMIN' and (v_target_role in ('OWNER', 'ADMIN') or p_role not in ('OPERATOR', 'VIEWER')) then
    raise exception 'Admins can only manage operator and viewer roles';
  end if;

  update public.workspace_members
  set role = p_role
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  insert into public.activity_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
  values (
    p_workspace_id,
    auth.uid(),
    'MEMBER_ROLE_UPDATED',
    'workspace_member',
    p_user_id,
    jsonb_build_object('member_user_id', p_user_id, 'role', p_role)
  );
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.workspace_role;
  v_target_role public.workspace_role;
  v_owner_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_actor_role := private.current_workspace_role(p_workspace_id);
  if v_actor_role is null then
    raise exception 'Not a workspace member';
  end if;

  select role into v_target_role
  from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if p_user_id <> auth.uid() and v_actor_role not in ('OWNER', 'ADMIN') then
    raise exception 'Only owners and admins can remove other members';
  end if;

  if v_actor_role = 'ADMIN' and v_target_role in ('OWNER', 'ADMIN') and p_user_id <> auth.uid() then
    raise exception 'Admins cannot remove owners or other admins';
  end if;

  if v_target_role = 'OWNER' then
    select count(*) into v_owner_count
    from public.workspace_members
    where workspace_id = p_workspace_id
      and role = 'OWNER';

    if v_owner_count <= 1 then
      raise exception 'A workspace must keep at least one owner';
    end if;
  end if;

  delete from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  insert into public.activity_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
  values (
    p_workspace_id,
    auth.uid(),
    'MEMBER_REMOVED',
    'workspace_member',
    p_user_id,
    jsonb_build_object('member_user_id', p_user_id)
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.activity_log enable row level security;

alter table public.profiles force row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;
alter table public.activity_log force row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace_with(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id));

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy activity_log_select on public.activity_log
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

revoke all on public.profiles from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.activity_log from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.activity_log to authenticated;

revoke all on function public.create_workspace(text) from public;
revoke all on function public.update_workspace(uuid, text) from public;
revoke all on function public.delete_workspace(uuid) from public;
revoke all on function public.add_workspace_member(uuid, text, public.workspace_role) from public;
revoke all on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) from public;
revoke all on function public.remove_workspace_member(uuid, uuid) from public;

grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.update_workspace(uuid, text) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;
grant execute on function public.add_workspace_member(uuid, text, public.workspace_role) to authenticated;
grant execute on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
