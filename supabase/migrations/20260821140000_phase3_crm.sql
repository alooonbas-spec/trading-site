-- PHASE 3: CRM leads, social profiles, contact relationships, interactions.
-- do_not_contact belongs only on public.leads. Never add it to profiles, relationships, or interactions.

create type public.lead_status as enum (
  'NEW',
  'QUALIFIED',
  'ENGAGED',
  'INTERESTED',
  'CUSTOMER',
  'NOT_INTERESTED',
  'LOST',
  'DO_NOT_CONTACT',
  'ARCHIVED'
);

create type public.contact_status as enum (
  'NOT_CONTACTED',
  'QUEUED',
  'INVITE_PENDING',
  'INVITE_SENT',
  'MESSAGE_PENDING',
  'MESSAGE_SENT',
  'REPLIED',
  'FAILED',
  'BLOCKED'
);

create type public.interaction_type as enum (
  'NOTE',
  'STATUS_CHANGE',
  'PROFILE_LINKED',
  'RELATIONSHIP_CREATED',
  'RELATIONSHIP_UPDATED',
  'MERGE'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) >= 1 and char_length(display_name) <= 120),
  email text,
  phone text,
  notes text,
  status public.lead_status not null default 'NEW',
  do_not_contact boolean not null default false,
  merged_into_id uuid references public.leads (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into_id is null or merged_into_id <> id)
);

create table public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  platform public.social_platform not null,
  external_profile_id text not null check (char_length(trim(external_profile_id)) >= 1),
  username text,
  display_name text,
  profile_url text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_profile_id)
);

create table public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  social_profile_id uuid not null references public.social_profiles (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  status public.contact_status not null default 'NOT_CONTACTED',
  last_interacted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_profile_id, social_account_id)
);

create table public.lead_interactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  social_profile_id uuid references public.social_profiles (id) on delete set null,
  social_account_id uuid references public.social_accounts (id) on delete set null,
  relationship_id uuid references public.contact_relationships (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  type public.interaction_type not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_leads_workspace_id on public.leads (workspace_id);
create index idx_leads_status on public.leads (status);
create index idx_leads_do_not_contact on public.leads (do_not_contact);
create index idx_leads_merged_into_id on public.leads (merged_into_id);
create index idx_leads_created_at on public.leads (created_at);
create index idx_leads_email on public.leads (workspace_id, email);
create index idx_social_profiles_workspace_id on public.social_profiles (workspace_id);
create index idx_social_profiles_lead_id on public.social_profiles (lead_id);
create index idx_social_profiles_platform on public.social_profiles (platform);
create index idx_contact_relationships_workspace_id on public.contact_relationships (workspace_id);
create index idx_contact_relationships_lead_id on public.contact_relationships (lead_id);
create index idx_contact_relationships_status on public.contact_relationships (status);
create index idx_contact_relationships_social_account_id on public.contact_relationships (social_account_id);
create index idx_lead_interactions_workspace_id on public.lead_interactions (workspace_id);
create index idx_lead_interactions_lead_id on public.lead_interactions (lead_id);
create index idx_lead_interactions_created_at on public.lead_interactions (created_at);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger social_profiles_set_updated_at
  before update on public.social_profiles
  for each row execute function public.set_updated_at();

create trigger contact_relationships_set_updated_at
  before update on public.contact_relationships
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;
alter table public.social_profiles enable row level security;
alter table public.contact_relationships enable row level security;
alter table public.lead_interactions enable row level security;

alter table public.leads force row level security;
alter table public.social_profiles force row level security;
alter table public.contact_relationships force row level security;
alter table public.lead_interactions force row level security;

create policy leads_select on public.leads
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy leads_insert on public.leads
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy leads_update on public.leads
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy leads_delete on public.leads
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN']::public.workspace_role[]));

create policy social_profiles_select on public.social_profiles
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy social_profiles_insert on public.social_profiles
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy social_profiles_update on public.social_profiles
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy social_profiles_delete on public.social_profiles
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy contact_relationships_select on public.contact_relationships
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy contact_relationships_insert on public.contact_relationships
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy contact_relationships_update on public.contact_relationships
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy contact_relationships_delete on public.contact_relationships
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy lead_interactions_select on public.lead_interactions
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy lead_interactions_insert on public.lead_interactions
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

create policy lead_interactions_update on public.lead_interactions
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]));

revoke all on public.leads from anon, authenticated;
revoke all on public.social_profiles from anon, authenticated;
revoke all on public.contact_relationships from anon, authenticated;
revoke all on public.lead_interactions from anon, authenticated;

grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.social_profiles to authenticated;
grant select, insert, update, delete on public.contact_relationships to authenticated;
grant select, insert, update on public.lead_interactions to authenticated;
