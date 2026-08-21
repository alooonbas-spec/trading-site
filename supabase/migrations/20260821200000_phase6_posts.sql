-- PHASE 6: posts, post targets, and PUBLISH jobs.
-- do_not_contact stays only on public.leads. Never add it to posts or post_targets.

alter type public.job_type add value 'PUBLISH';

create type public.post_status as enum (
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIAL',
  'FAILED',
  'CANCELLED'
);

create type public.post_target_status as enum (
  'PENDING',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'SKIPPED',
  'CANCELLED'
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  body text not null check (char_length(trim(body)) >= 1 and char_length(body) <= 4000),
  media jsonb not null default '[]'::jsonb,
  status public.post_status not null default 'DRAFT',
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  status public.post_target_status not null default 'PENDING',
  external_post_id text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, social_account_id)
);

alter table public.jobs
  add column post_id uuid references public.posts (id) on delete cascade,
  add column post_target_id uuid references public.post_targets (id) on delete cascade;

alter table public.jobs
  alter column lead_id drop not null,
  alter column action drop not null;

alter table public.jobs
  add constraint jobs_shape check (
    (
      type = 'CONTACT'
      and lead_id is not null
      and action is not null
    )
    or
    (
      type = 'PUBLISH'
      and post_id is not null
      and post_target_id is not null
    )
  );

create index idx_posts_workspace_id on public.posts (workspace_id);
create index idx_posts_status on public.posts (status);
create index idx_posts_created_at on public.posts (created_at);
create index idx_posts_scheduled_at on public.posts (scheduled_at);
create index idx_post_targets_workspace_id on public.post_targets (workspace_id);
create index idx_post_targets_post_id on public.post_targets (post_id);
create index idx_post_targets_social_account_id on public.post_targets (social_account_id);
create index idx_post_targets_status on public.post_targets (status);
create index idx_jobs_post_id on public.jobs (post_id);
create index idx_jobs_post_target_id on public.jobs (post_target_id);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

create trigger post_targets_set_updated_at
  before update on public.post_targets
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;
alter table public.post_targets enable row level security;
alter table public.posts force row level security;
alter table public.post_targets force row level security;

create policy posts_select on public.posts
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy posts_insert on public.posts
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy posts_update on public.posts
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy posts_delete on public.posts
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy post_targets_select on public.post_targets
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy post_targets_insert on public.post_targets
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy post_targets_update on public.post_targets
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy post_targets_delete on public.post_targets
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

revoke all on public.posts from anon, authenticated;
revoke all on public.post_targets from anon, authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.post_targets to authenticated;
