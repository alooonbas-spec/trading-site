-- PHASE 5: public collection timeline event. No new CRM tables.
-- do_not_contact stays only on public.leads.

alter type public.interaction_type add value 'PROFILE_COLLECTED';
