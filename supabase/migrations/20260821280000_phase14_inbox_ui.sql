-- PHASE 14: inbox listing indexes. do_not_contact stays only on public.leads.

create index idx_inbox_events_workspace_unmatched
  on public.inbox_events (workspace_id, received_at desc)
  where social_profile_id is null;

create index idx_inbox_events_social_profile_id
  on public.inbox_events (social_profile_id);
