-- Server-side writes execute plan-limit triggers that call helpers in the
-- private app schema. Supabase service_role bypasses RLS but still needs
-- schema USAGE to resolve those helper functions.
grant usage on schema app to service_role;

-- Rollback (only if server-side writes no longer execute app-schema triggers):
-- revoke usage on schema app from service_role;
