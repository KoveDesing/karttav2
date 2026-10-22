-- =====================================================================
-- KARTTA — Verificación de edad (18+) y consentimientos con versión
-- Pegar COMPLETO en Supabase → SQL Editor → Run. Es idempotente (se puede repetir).
-- NO toca auth.users, profiles, restaurants ni los datos existentes.
-- Añade 4 tablas nuevas, 3 funciones y 1 trigger sobre restaurants.
-- =====================================================================

-- 1) Versiones vigentes de los documentos legales (fuente única de verdad).
--    Si cambias el texto de una página legal, sube su versión aquí (UPDATE) y en la página.
create table if not exists public.legal_documents (
  doc_type   text primary key check (doc_type in ('terms','privacy','cookies')),
  version    text not null,
  updated_at timestamptz not null default now()
);
alter table public.legal_documents enable row level security;
drop policy if exists legal_documents_read on public.legal_documents;
create policy legal_documents_read on public.legal_documents for select to anon, authenticated using (true);
revoke all on public.legal_documents from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;
insert into public.legal_documents (doc_type, version) values
  ('terms','2.0'), ('privacy','1.0'), ('cookies','1.0')
on conflict (doc_type) do nothing;

-- 2) Historial de aceptaciones (solo se añade; el usuario NO puede escribir ni borrar).
create table if not exists public.user_consents (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc_type    text not null check (doc_type in ('terms','privacy','age_confirmation')),
  version     text not null,
  accepted_at timestamptz not null default now()
);
create index if not exists user_consents_user_doc_idx on public.user_consents (user_id, doc_type, version);
alter table public.user_consents enable row level security;
drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents for select to authenticated using (user_id = auth.uid());
revoke all on public.user_consents from anon, authenticated;
grant select on public.user_consents to authenticated;

-- 3) Resultado de la verificación de edad. NO se guarda la fecha de nacimiento
--    (minimización de datos): solo "es mayor de edad" y cuándo se verificó.
create table if not exists public.user_compliance (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  adult_verified_at timestamptz,
  age_blocked_at    timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.user_compliance enable row level security;
drop policy if exists user_compliance_select_own on public.user_compliance;
create policy user_compliance_select_own on public.user_compliance for select to authenticated using (user_id = auth.uid());
revoke all on public.user_compliance from anon, authenticated;
grant select on public.user_compliance to authenticated;

-- 4) Documentos pendientes de aceptar para un usuario (uso interno).
create or replace function public._missing_docs(p_uid uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(d.doc_type order by d.doc_type), '{}')
  from public.legal_documents d
  where d.doc_type in ('terms','privacy')
    and not exists (
      select 1 from public.user_consents c
      where c.user_id = p_uid and c.doc_type = d.doc_type and c.version = d.version
    );
$$;
revoke all on function public._missing_docs(uuid) from public, anon, authenticated;

-- 5) Estado de requisitos del usuario autenticado.
create or replace function public.my_requirements()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c public.user_compliance;
  v_missing text[];
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.user_compliance where user_id = v_uid;
  v_missing := public._missing_docs(v_uid);
  return jsonb_build_object(
    'adult',    c.adult_verified_at is not null,
    'blocked',  (c.age_blocked_at is not null and c.adult_verified_at is null),
    'missing',  to_jsonb(v_missing),
    'versions', (select coalesce(jsonb_object_agg(doc_type, version), '{}'::jsonb) from public.legal_documents),
    'ok',       (c.adult_verified_at is not null and cardinality(v_missing) = 0)
  );
end;
$$;

-- 6) Completar requisitos. La edad la calcula el SERVIDOR con la fecha actual de la base.
create or replace function public.complete_requirements(
  p_birth_date      date,
  p_age_confirmed   boolean,
  p_accept_terms    boolean,
  p_accept_privacy  boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c public.user_compliance;
  v_missing text[];
  v_doc text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into c from public.user_compliance where user_id = v_uid;

  -- Un usuario ya bloqueado por edad no puede reintentar con otra fecha.
  if c.age_blocked_at is not null and c.adult_verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  if c.adult_verified_at is null then
    if p_birth_date is null or p_birth_date > current_date or p_birth_date < date '1900-01-01' then
      raise exception 'invalid_birth_date' using errcode = '22007';
    end if;
    if date_part('year', age(current_date, p_birth_date)) < 18 then
      insert into public.user_compliance (user_id, age_blocked_at)
        values (v_uid, now())
        on conflict (user_id) do update set age_blocked_at = now(), updated_at = now();
      return jsonb_build_object('ok', false, 'reason', 'blocked');
    end if;
    if p_age_confirmed is not true then
      raise exception 'age_confirmation_required' using errcode = '22023';
    end if;
    insert into public.user_compliance (user_id, adult_verified_at)
      values (v_uid, now())
      on conflict (user_id) do update set adult_verified_at = now(), age_blocked_at = null, updated_at = now();
    insert into public.user_consents (user_id, doc_type, version) values (v_uid, 'age_confirmation', '18');
  end if;

  v_missing := public._missing_docs(v_uid);
  if 'terms' = any(v_missing) and p_accept_terms is not true then
    raise exception 'terms_required' using errcode = '22023';
  end if;
  if 'privacy' = any(v_missing) and p_accept_privacy is not true then
    raise exception 'privacy_required' using errcode = '22023';
  end if;
  foreach v_doc in array v_missing loop
    insert into public.user_consents (user_id, doc_type, version)
      select v_uid, v_doc, d.version from public.legal_documents d where d.doc_type = v_doc;
  end loop;

  return public.my_requirements();
end;
$$;

revoke all on function public.my_requirements() from public, anon;
revoke all on function public.complete_requirements(date, boolean, boolean, boolean) from public, anon;
grant execute on function public.my_requirements() to authenticated;
grant execute on function public.complete_requirements(date, boolean, boolean, boolean) to authenticated;

-- 7) Barrera en la base de datos: un usuario autenticado que no cumpla los requisitos
--    NO puede crear un negocio (aunque alguien manipule el JavaScript del navegador).
--    No afecta negocios existentes ni operaciones del servidor (service_role / SQL Editor
--    no tienen auth.uid()).
create or replace function public.enforce_requirements_before_restaurant()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and not coalesce((public.my_requirements() ->> 'ok')::boolean, false) then
    raise exception 'requirements_pending' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_requirements_before_restaurant() from public, anon, authenticated;

drop trigger if exists trg_enforce_requirements_restaurant on public.restaurants;
create trigger trg_enforce_requirements_restaurant
  before insert on public.restaurants
  for each row execute function public.enforce_requirements_before_restaurant();
