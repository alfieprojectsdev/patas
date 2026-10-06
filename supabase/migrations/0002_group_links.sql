-- Group links: each member joins from their own phone.
--
-- The group key K lives only in the share link's #fragment, which browsers
-- never send to the server. The server stores sha256(K) to check it, and
-- each member's H3 cell sealed with AES-256-GCM under a key derived from K.
-- Without K the sealed cells are unreadable, so a database dump reveals no
-- locations.
--
-- EXCEPTION to "no location columns" (agreed 2026-10-06): members.sealed_cell
-- holds ciphertext only and is cleared at sealed_until (48 h after joining).
-- Any other location column is still rejected.

-- Join codes are replaced by the link; nothing reads join_code any more.
alter table groups alter column join_code drop not null;
alter table groups add column key_check text;  -- sha256(K), hex

alter table members add column token_hash   text unique;  -- sha256 of the member's own edit token
alter table members add column sealed_cell  bytea;        -- version | iv | tag | ciphertext
alter table members add column sealed_until timestamptz;
alter table members add column joined_at    timestamptz not null default now();

create index members_sealed_until on members (sealed_until) where sealed_cell is not null;

-- Request counters for the public endpoints (protects the ORS quota).
-- `client` is sha256 of the IP address, never the address itself.
create table rate_limits (
  endpoint     text not null,
  client       text not null,
  count        integer not null,
  window_start timestamptz not null,
  primary key (endpoint, client)
);
alter table rate_limits enable row level security;
