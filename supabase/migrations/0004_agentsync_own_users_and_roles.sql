-- Replace Supabase Auth with AgentSync's own identity tables.
--
-- Users, their credentials and their roles all live in this schema. Nothing
-- references auth.users any more, and no policy depends on auth.uid().
--
-- Identity for a request comes from the `agentsync.user_id` setting, which the
-- application sets once per connection/transaction after it has verified the
-- caller:  set local agentsync.user_id = '<uuid>';
--
-- Passwords are stored only as a bcrypt hash produced inside the database by
-- agentsync.set_password(), so plaintext never travels through application logs
-- or query history. password_hash is excluded from every read grant.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create type agentsync.user_state as enum ('ACTIVE', 'SUSPENDED', 'INVITED', 'SERVICE');

create table agentsync.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  display_name text not null,
  -- bcrypt hash, written only by agentsync.set_password()
  password_hash text,
  password_updated_at timestamptz,
  -- platform-wide role; per-tenant roles live in tenant_users
  role agentsync.user_role not null default 'VIEWER',
  state agentsync.user_state not null default 'ACTIVE',
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email is matched case-insensitively everywhere, so uniqueness is too.
create unique index users_email_key on agentsync.users (lower(email));

create trigger users_touch_updated_at
  before update on agentsync.users
  for each row execute function agentsync.touch_updated_at();

-- ---------------------------------------------------------------------------
-- repoint the two foreign keys that used auth.users
-- ---------------------------------------------------------------------------

alter table agentsync.tenant_users
  drop constraint tenant_users_user_id_fkey,
  add constraint tenant_users_user_id_fkey
    foreign key (user_id) references agentsync.users (id) on delete cascade;

alter table agentsync.task_approvals
  drop constraint task_approvals_decided_by_fkey,
  add constraint task_approvals_decided_by_fkey
    foreign key (decided_by) references agentsync.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- current user resolution: a session setting, not a JWT
-- ---------------------------------------------------------------------------

create or replace function agentsync.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('agentsync.user_id', true), '')::uuid;
$$;

create or replace function agentsync.is_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from agentsync.tenant_users tu
    join agentsync.users u on u.id = tu.user_id
    where tu.tenant_id = target_tenant
      and tu.user_id = agentsync.current_user_id()
      and tu.state <> 'SUSPENDED'
      and u.state = 'ACTIVE'
  );
$$;

create or replace function agentsync.has_role(
  target_tenant uuid,
  allowed agentsync.user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from agentsync.tenant_users tu
    join agentsync.users u on u.id = tu.user_id
    where tu.tenant_id = target_tenant
      and tu.user_id = agentsync.current_user_id()
      and tu.state = 'ACTIVE'
      and u.state = 'ACTIVE'
      and (tu.role = any (allowed) or u.role = 'SUPER_ADMIN')
  );
$$;

create or replace function agentsync.can_configure(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select agentsync.has_role(
    target_tenant,
    array['SUPER_ADMIN', 'TENANT_ADMIN', 'PROJECT_MANAGER']::agentsync.user_role[]
  );
$$;

-- ---------------------------------------------------------------------------
-- credentials
-- ---------------------------------------------------------------------------

-- Hashing happens here so plaintext never appears in application logs.
create or replace function agentsync.set_password(target_user uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(new_password) < 12 then
    raise exception 'password must be at least 12 characters';
  end if;

  update agentsync.users
     set password_hash = extensions.crypt(new_password, extensions.gen_salt('bf', 12)),
         password_updated_at = now(),
         failed_login_attempts = 0,
         locked_until = null
   where id = target_user;

  if not found then
    raise exception 'no such user %', target_user;
  end if;
end;
$$;

-- Returns the user id on success and null otherwise.
create or replace function agentsync.verify_password(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
begin
  select id, password_hash, state, locked_until, failed_login_attempts
    into u
    from agentsync.users
   where lower(email) = lower(p_email);

  if not found or u.password_hash is null or u.state <> 'ACTIVE' then
    return null;
  end if;

  if u.locked_until is not null and u.locked_until > now() then
    return null;
  end if;

  if u.password_hash = extensions.crypt(p_password, u.password_hash) then
    update agentsync.users
       set last_login_at = now(), failed_login_attempts = 0, locked_until = null
     where id = u.id;
    return u.id;
  end if;

  -- five strikes locks the account for fifteen minutes
  update agentsync.users
     set failed_login_attempts = failed_login_attempts + 1,
         locked_until = case
           when failed_login_attempts + 1 >= 5 then now() + interval '15 minutes'
           else locked_until
         end
   where id = u.id;

  return null;
end;
$$;

create or replace function agentsync.create_user(
  p_email text,
  p_display_name text,
  p_password text,
  p_role agentsync.user_role default 'VIEWER'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into agentsync.users (email, display_name, role)
  values (p_email, p_display_name, p_role)
  returning id into new_id;

  perform agentsync.set_password(new_id, p_password);
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- row level security for users
-- ---------------------------------------------------------------------------

alter table agentsync.users enable row level security;
alter table agentsync.users force row level security;

-- A user always sees their own row; platform admins see everyone; tenant admins
-- see the members of a tenant they administer.
create policy users_select on agentsync.users
  for select to authenticated
  using (
    id = agentsync.current_user_id()
    or exists (
      select 1 from agentsync.users me
      where me.id = agentsync.current_user_id()
        and me.role = 'SUPER_ADMIN'
        and me.state = 'ACTIVE'
    )
    or exists (
      select 1
      from agentsync.tenant_users target
      join agentsync.tenant_users mine on mine.tenant_id = target.tenant_id
      where target.user_id = agentsync.users.id
        and mine.user_id = agentsync.current_user_id()
        and mine.role in ('SUPER_ADMIN', 'TENANT_ADMIN')
        and mine.state = 'ACTIVE'
    )
  );

create policy users_update_self on agentsync.users
  for update to authenticated
  using (id = agentsync.current_user_id())
  with check (id = agentsync.current_user_id());

-- ---------------------------------------------------------------------------
-- grants: password_hash is never selectable or writable outside the helpers
-- ---------------------------------------------------------------------------

revoke all on agentsync.users from anon, authenticated;

grant select (
  id, email, display_name, role, state, last_login_at,
  password_updated_at, locked_until, created_at, updated_at
) on agentsync.users to authenticated;

grant update (email, display_name) on agentsync.users to authenticated;

grant select, insert, update, delete on agentsync.users to service_role;

-- Credential helpers are callable only by trusted server-side code.
revoke all on function agentsync.set_password(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.verify_password(text, text) from public, anon, authenticated;
revoke all on function agentsync.create_user(text, text, text, agentsync.user_role) from public, anon, authenticated;

grant execute on function agentsync.set_password(uuid, text) to service_role;
grant execute on function agentsync.verify_password(text, text) to service_role;
grant execute on function agentsync.create_user(text, text, text, agentsync.user_role) to service_role;

comment on column agentsync.users.password_hash is
  'bcrypt hash written only by agentsync.set_password(); excluded from all read grants.';
