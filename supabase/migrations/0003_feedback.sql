-- Feedback button submissions (pattern from carpool-app).
-- No location columns: `page` is a path with ?query and #fragment stripped
-- and group ids blanked (/g/_). Rows older than 180 days are purged.
create table feedback (
  id         bigserial primary key,
  kind       text not null default 'other' check (kind in ('problem', 'idea', 'other')),
  message    text not null check (char_length(message) between 1 and 2000),
  contact    text check (contact is null or char_length(contact) <= 200),
  page       text check (page is null or char_length(page) <= 300),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index feedback_created_at on feedback (created_at);
alter table feedback enable row level security;
