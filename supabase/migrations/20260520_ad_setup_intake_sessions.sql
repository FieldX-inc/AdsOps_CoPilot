alter table ad_setup_intakes
  add column if not exists title text not null default '新しい広告準備',
  add column if not exists archived_at timestamptz;

alter table ad_setup_intakes
  drop constraint if exists ad_setup_intakes_workspace_id_user_id_status_key;

create index if not exists idx_ad_setup_intakes_active_updated
on ad_setup_intakes(workspace_id, user_id, archived_at, updated_at desc);

comment on column ad_setup_intakes.title is
  'User-facing label for a setup intake session, such as a product or media preparation name.';

comment on column ad_setup_intakes.archived_at is
  'When set, hides the setup intake from the default session list without deleting conversation history.';
