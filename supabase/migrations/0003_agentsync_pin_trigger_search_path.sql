-- Pin search_path on the trigger functions. Neither references an unqualified
-- object, so an empty search_path is safe and closes the Supabase linter's
-- function_search_path_mutable warning.

alter function agentsync.touch_updated_at() set search_path = '';
alter function agentsync.reject_event_mutation() set search_path = '';
