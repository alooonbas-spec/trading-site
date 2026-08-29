-- PHASE 20: official inbox replies. do_not_contact stays only on public.leads.
-- Outbound inbox replies record interaction_type MESSAGE and store reply_kind on events.

alter type public.interaction_type add value 'MESSAGE';

alter table public.inbox_events
  add column reply_kind text
  check (reply_kind is null or reply_kind in ('direct_message', 'comment', 'mention'));

create index idx_inbox_events_reply_kind
  on public.inbox_events (workspace_id, reply_kind)
  where reply_kind is not null;
