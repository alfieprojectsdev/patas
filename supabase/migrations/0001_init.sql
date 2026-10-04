-- Patas schema. Deliberately has NO location columns anywhere.
-- If a future change adds lat/lng/address/landmark to any table, reject it.

create table groups (
  id          uuid primary key default gen_random_uuid(),
  join_code   text unique not null,            -- short code shared in GC
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '120 days'
);

create table members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  alias       text not null,                   -- display alias, not legal name
  unique (group_id, alias)
);

create table meetings (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  venue_name  text not null,                   -- public venue name, or 'Host: <alias>'
  venue_place_id text,                         -- Places id; null for host option
  met_on      date not null default current_date
);

-- Rotation ledger: minutes (and later pesos) per member per meeting.
create table burdens (
  meeting_id  uuid not null references meetings(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  minutes     numeric not null check (minutes >= 0),
  pesos       numeric check (pesos >= 0),
  primary key (meeting_id, member_id)
);

create view member_burden as
  select m.group_id, m.id as member_id, m.alias,
         coalesce(sum(b.minutes), 0) as total_minutes,
         coalesce(sum(b.pesos), 0)   as total_pesos
  from members m left join burdens b on b.member_id = m.id
  group by m.group_id, m.id, m.alias;

-- TODO(claude-code): RLS policies scoped by group join_code/session;
-- scheduled job: delete from groups where expires_at < now();
alter table groups   enable row level security;
alter table members  enable row level security;
alter table meetings enable row level security;
alter table burdens  enable row level security;
