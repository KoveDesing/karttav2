-- ============================================================================
-- KARTTA — Centro de soporte y reportes + Políticas y privacidad (central)
-- Migración 20261101_soporte_politicas.sql   ·   NO APLICADA hasta que la ejecutes.
--
-- Qué hace
--   1) legal_document_versions  : fuente ÚNICA de los textos legales (versionados, publicables).
--      legal_contact            : datos del responsable/canal legal (vacíos hasta que los configures).
--      Los textos vigentes se leen desde el panel de CADA restaurante; no hay copias por restaurante.
--   2) support_tickets / support_messages / support_attachments / support_ticket_events
--      + bucket PRIVADO support-attachments (5 MB, solo png/jpg/webp).
--   3) TODA escritura pasa por funciones del servidor (security definer). El navegador NO inserta ni
--      actualiza tablas: la identidad (usuario, restaurante, correo, plan) sale de auth.uid() y la BD.
--   4) Administración: solo private.is_platform_admin() (ya existe en tu proyecto).
--
-- Requisitos previos (ya existentes en tu proyecto): private.has_role(uuid,text[]),
--   private.is_platform_admin(), tablas restaurants / restaurant_members / profiles / subscriptions,
--   public.legal_documents (consentimientos), extensión pgcrypto o gen_random_uuid().
--
-- Reversión: ver bloque «ROLLBACK» al final (comentado).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) DOCUMENTOS LEGALES (fuente central)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_document_versions (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('privacy','data_processing','terms','cookies','security','rights')),
  version        text not null check (char_length(version) between 1 and 20),
  title          text not null check (char_length(title) between 3 and 160),
  summary        text,
  content        jsonb not null default '[]'::jsonb,   -- [{ "h": "Título", "p": ["párrafo", ...] }]
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  legal_review   text not null default 'pending' check (legal_review in ('pending','reviewed')),
  effective_date date,
  published_at   timestamptz,
  published_by   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (doc_type, version)
);
-- una sola versión publicada por documento
create unique index if not exists legal_one_published_idx on public.legal_document_versions (doc_type) where status = 'published';
alter table public.legal_document_versions enable row level security;
drop policy if exists legal_versions_read on public.legal_document_versions;
create policy legal_versions_read on public.legal_document_versions for select to authenticated
  using (status = 'published' or private.is_platform_admin());
revoke all on public.legal_document_versions from anon, authenticated;
grant select on public.legal_document_versions to authenticated;

create table if not exists public.legal_contact (
  id            boolean primary key default true check (id),   -- fila única
  legal_name    text,
  nit           text,
  address       text,
  privacy_email text,
  phone         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
insert into public.legal_contact (id) values (true) on conflict (id) do nothing;
alter table public.legal_contact enable row level security;
drop policy if exists legal_contact_read on public.legal_contact;
create policy legal_contact_read on public.legal_contact for select to authenticated using (true);
revoke all on public.legal_contact from anon, authenticated;
grant select on public.legal_contact to authenticated;

-- ---------------------------------------------------------------------------
-- 2) SOPORTE
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id                  uuid primary key default gen_random_uuid(),
  ticket_number       bigint generated always as identity,
  restaurant_id       uuid references public.restaurants(id) on delete set null,   -- el ticket sobrevive si se elimina el negocio
  created_by          uuid references auth.users(id) on delete set null,
  -- datos del momento de crear el reporte (los rellena el SERVIDOR, nunca el navegador)
  business_name       text,
  creator_name        text,
  creator_email       text,
  business_whatsapp   text,
  restaurant_slug     text,
  plan_id             text,
  subscription_status text,
  -- contenido
  subject             text not null check (char_length(btrim(subject)) between 3 and 140),
  category            text not null check (category in ('technical','menu','orders','billing','tables_kitchen','images_ai','access','help','suggestion','other')),
  perceived_priority  text not null default 'normal' check (perceived_priority in ('low','normal','high','urgent')),  -- la elige el cliente: solo referencia
  priority            text not null default 'normal' check (priority in ('low','normal','high','urgent')),            -- la confirma el equipo
  status              text not null default 'received' check (status in ('received','in_review','in_progress','waiting_customer','resolved','closed')),
  description         text not null check (char_length(btrim(description)) between 10 and 5000),
  client_request_id   uuid,
  last_message_at     timestamptz not null default now(),
  last_message_by     text not null default 'customer' check (last_message_by in ('customer','admin')),
  resolved_at         timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists support_tickets_number_idx on public.support_tickets (ticket_number);
create unique index if not exists support_tickets_idem_idx on public.support_tickets (created_by, client_request_id) where client_request_id is not null;
create index if not exists support_tickets_rest_idx   on public.support_tickets (restaurant_id, last_message_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, priority, last_message_at desc);

create table if not exists public.support_messages (
  id                 uuid primary key default gen_random_uuid(),
  ticket_id          uuid not null references public.support_tickets(id) on delete cascade,
  author_id          uuid references auth.users(id) on delete set null,
  author_role        text not null check (author_role in ('customer','admin')),
  author_name        text,
  kind               text not null default 'public' check (kind in ('public','internal_note')),
  body               text not null check (char_length(btrim(body)) between 1 and 5000),
  client_request_id  uuid,
  read_by_admin_at   timestamptz,
  read_by_customer_at timestamptz,
  created_at         timestamptz not null default now(),
  constraint support_note_only_admin check (kind = 'public' or author_role = 'admin')
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create unique index if not exists support_messages_idem_idx on public.support_messages (author_id, client_request_id) where client_request_id is not null;

create table if not exists public.support_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.support_tickets(id) on delete cascade,
  message_id    uuid references public.support_messages(id) on delete cascade,
  uploaded_by   uuid references auth.users(id) on delete set null,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 200),
  mime_type     text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at    timestamptz not null default now()
);
create index if not exists support_attachments_ticket_idx on public.support_attachments (ticket_id);

create table if not exists public.support_ticket_events (
  id                  uuid primary key default gen_random_uuid(),
  ticket_id           uuid not null references public.support_tickets(id) on delete cascade,
  actor_id            uuid references auth.users(id) on delete set null,
  actor_role          text not null check (actor_role in ('customer','admin','system')),
  event_type          text not null check (event_type in ('created','status_changed','priority_changed','reopened','message_public','note_internal','attachment_added','marked_read')),
  old_value           text,
  new_value           text,
  visible_to_customer boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists support_events_ticket_idx on public.support_ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- 3) RLS (solo LECTURA directa; toda escritura va por funciones)
-- ---------------------------------------------------------------------------
alter table public.support_tickets       enable row level security;
alter table public.support_messages      enable row level security;
alter table public.support_attachments   enable row level security;
alter table public.support_ticket_events enable row level security;

-- ¿puede el usuario actual ver este ticket? (dueño/administrador del restaurante, o quien lo creó siendo miembro)
create or replace function private.support_can_see(p_restaurant uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_restaurant is not null and (
    private.has_role(p_restaurant, array['owner','admin'])
    or (p_creator = (select auth.uid()) and private.has_role(p_restaurant, array['owner','admin','staff']))
  );
$$;
revoke all on function private.support_can_see(uuid,uuid) from public, anon;
grant execute on function private.support_can_see(uuid,uuid) to authenticated;

drop policy if exists st_read on public.support_tickets;
create policy st_read on public.support_tickets for select to authenticated
  using (private.is_platform_admin() or private.support_can_see(restaurant_id, created_by));

drop policy if exists sm_read on public.support_messages;
create policy sm_read on public.support_messages for select to authenticated
  using (private.is_platform_admin()
         or (kind = 'public' and exists (select 1 from public.support_tickets t where t.id = ticket_id)));  -- la subconsulta respeta st_read

drop policy if exists sa_read on public.support_attachments;
create policy sa_read on public.support_attachments for select to authenticated
  using (private.is_platform_admin() or exists (select 1 from public.support_tickets t where t.id = ticket_id));

drop policy if exists se_read on public.support_ticket_events;
create policy se_read on public.support_ticket_events for select to authenticated
  using (private.is_platform_admin()
         or (visible_to_customer and exists (select 1 from public.support_tickets t where t.id = ticket_id)));

revoke all on public.support_tickets, public.support_messages, public.support_attachments, public.support_ticket_events from anon, authenticated;
grant select on public.support_tickets, public.support_messages, public.support_attachments, public.support_ticket_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4) ALMACENAMIENTO PRIVADO DE ADJUNTOS
--    Ruta: <restaurant_id>/<ticket_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments','support-attachments', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists support_att_read   on storage.objects;
drop policy if exists support_att_insert on storage.objects;
create policy support_att_read on storage.objects for select to authenticated
  using (bucket_id = 'support-attachments' and (
    private.is_platform_admin()
    or exists (select 1 from public.support_tickets t
               where t.id::text = (storage.foldername(name))[2] and t.restaurant_id::text = (storage.foldername(name))[1])));
create policy support_att_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-attachments' and (
    private.is_platform_admin()
    or exists (select 1 from public.support_tickets t
               where t.id::text = (storage.foldername(name))[2] and t.restaurant_id::text = (storage.foldername(name))[1]
                 and t.status <> 'closed')));
-- (sin políticas de update/delete: nadie modifica ni borra adjuntos desde el navegador)

-- ---------------------------------------------------------------------------
-- 5) FUNCIONES DEL CLIENTE (restaurante)
-- ---------------------------------------------------------------------------
create or replace function private.support_actor_name(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.panel_name),''), nullif(btrim(p.full_name),''), split_part(u.email,'@',1), 'Usuario')
  from auth.users u left join public.profiles p on p.id = u.id where u.id = p_uid;
$$;
revoke all on function private.support_actor_name(uuid) from public, anon, authenticated;

create or replace function public.support_create_ticket(
  p_restaurant uuid, p_subject text, p_category text, p_priority text, p_description text, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r record; t public.support_tickets; v_plan text; v_sub text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.has_role(p_restaurant, array['owner','admin','staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_request_id is not null then
    select * into t from public.support_tickets where created_by = v_uid and client_request_id = p_request_id;
    if found then return jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number, 'status', t.status, 'duplicate', true); end if;
  end if;
  if (select count(*) from public.support_tickets where created_by = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  if p_subject is null or char_length(btrim(p_subject)) not between 3 and 140 then raise exception 'invalid_subject'; end if;
  if p_description is null or char_length(btrim(p_description)) not between 10 and 5000 then raise exception 'invalid_description'; end if;
  if p_category not in ('technical','menu','orders','billing','tables_kitchen','images_ai','access','help','suggestion','other') then raise exception 'invalid_category'; end if;
  if coalesce(p_priority,'normal') not in ('low','normal','high','urgent') then raise exception 'invalid_priority'; end if;
  select name, slug, whatsapp into r from public.restaurants where id = p_restaurant;
  select plan_id, status into v_plan, v_sub from public.subscriptions where restaurant_id = p_restaurant limit 1;
  insert into public.support_tickets (restaurant_id, created_by, business_name, creator_name, creator_email, business_whatsapp, restaurant_slug,
      plan_id, subscription_status, subject, category, perceived_priority, priority, description, client_request_id)
  values (p_restaurant, v_uid, r.name, private.support_actor_name(v_uid), (select email from auth.users where id = v_uid), nullif(btrim(r.whatsapp),''), r.slug,
      v_plan, v_sub, btrim(p_subject), p_category, coalesce(p_priority,'normal'), coalesce(p_priority,'normal'), btrim(p_description), p_request_id)
  returning * into t;
  insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, new_value, visible_to_customer)
  values (t.id, v_uid, 'customer', 'created', t.status, true);
  return jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number, 'status', t.status, 'restaurant_id', t.restaurant_id, 'duplicate', false);
end $$;

create or replace function public.support_reply(p_ticket uuid, p_body text, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t public.support_tickets; m public.support_messages; v_old text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found or not private.support_can_see(t.restaurant_id, t.created_by) then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.status = 'closed' then raise exception 'ticket_closed'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 5000 then raise exception 'invalid_body'; end if;
  if p_request_id is not null then
    select * into m from public.support_messages where author_id = v_uid and client_request_id = p_request_id;
    if found then return jsonb_build_object('id', m.id, 'duplicate', true); end if;
  end if;
  if (select count(*) from public.support_messages where author_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then raise exception 'rate_limited'; end if;
  insert into public.support_messages (ticket_id, author_id, author_role, author_name, kind, body, client_request_id, read_by_customer_at)
  values (t.id, v_uid, 'customer', private.support_actor_name(v_uid), 'public', btrim(p_body), p_request_id, now()) returning * into m;
  v_old := t.status;
  update public.support_tickets set last_message_at = now(), last_message_by = 'customer', updated_at = now(),
         status = case when status in ('waiting_customer','resolved') then 'in_review' else status end,
         resolved_at = case when status = 'resolved' then null else resolved_at end
   where id = t.id;
  insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, visible_to_customer) values (t.id, v_uid, 'customer', 'message_public', false);
  if v_old in ('waiting_customer','resolved') then
    insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, old_value, new_value, visible_to_customer)
    values (t.id, v_uid, 'customer', case when v_old = 'resolved' then 'reopened' else 'status_changed' end, v_old, 'in_review', true);
  end if;
  return jsonb_build_object('id', m.id, 'duplicate', false);
end $$;

create or replace function public.support_add_attachment(p_ticket uuid, p_message uuid, p_path text, p_name text, p_mime text, p_size integer)
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare v_uid uuid := auth.uid(); t public.support_tickets; v_id uuid; v_admin boolean := private.is_platform_admin();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = p_ticket;
  if not found or not (v_admin or private.support_can_see(t.restaurant_id, t.created_by)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.restaurant_id is null or p_path not like (t.restaurant_id::text || '/' || t.id::text || '/%') then raise exception 'invalid_path'; end if;
  if p_mime not in ('image/png','image/jpeg','image/webp') then raise exception 'invalid_type'; end if;
  if p_size is null or p_size <= 0 or p_size > 5242880 then raise exception 'file_too_large'; end if;
  if (select count(*) from public.support_attachments where ticket_id = t.id) >= 40 then raise exception 'too_many_files'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'support-attachments' and o.name = p_path) then raise exception 'file_not_uploaded'; end if;
  if p_message is not null and not exists (select 1 from public.support_messages where id = p_message and ticket_id = t.id and kind = 'public') then raise exception 'invalid_message'; end if;
  insert into public.support_attachments (ticket_id, message_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (t.id, p_message, v_uid, p_path, left(btrim(p_name),200), p_mime, p_size) returning id into v_id;
  insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, new_value, visible_to_customer)
  values (t.id, v_uid, case when v_admin then 'admin' else 'customer' end, 'attachment_added', left(btrim(p_name),200), false);
  return v_id;
end $$;

create or replace function public.support_my_tickets(p_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.has_role(p_restaurant, array['owner','admin','staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'last_message_at') desc) from (
      select jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number, 'subject', t.subject, 'category', t.category,
        'perceived_priority', t.perceived_priority, 'status', t.status, 'created_at', t.created_at, 'last_message_at', t.last_message_at,
        'last_message_by', t.last_message_by,
        'unread', (select count(*) from public.support_messages m where m.ticket_id = t.id and m.author_role = 'admin' and m.kind = 'public' and m.read_by_customer_at is null)) as x
      from public.support_tickets t
      where t.restaurant_id = p_restaurant and private.support_can_see(t.restaurant_id, t.created_by)
      order by t.last_message_at desc limit 200) q), '[]'::jsonb);
end $$;

create or replace function public.support_mark_read(p_ticket uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; n integer;
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found or not private.support_can_see(t.restaurant_id, t.created_by) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.support_messages set read_by_customer_at = now()
   where ticket_id = t.id and author_role = 'admin' and kind = 'public' and read_by_customer_at is null;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.support_unread_count(p_restaurant uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.support_messages m join public.support_tickets t on t.id = m.ticket_id
  where t.restaurant_id = p_restaurant and private.support_can_see(t.restaurant_id, t.created_by)
    and m.author_role = 'admin' and m.kind = 'public' and m.read_by_customer_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 6) FUNCIONES DE ADMINISTRACIÓN (solo private.is_platform_admin())
-- ---------------------------------------------------------------------------
create or replace function public.admin_support_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'total', count(*),
    'unread', count(*) filter (where exists (select 1 from public.support_messages m where m.ticket_id = t.id and m.author_role = 'customer' and m.read_by_admin_at is null)) ,
    'received', count(*) filter (where status = 'received'),
    'in_review', count(*) filter (where status = 'in_review'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'waiting_customer', count(*) filter (where status = 'waiting_customer'),
    'needs_admin_reply', count(*) filter (where status not in ('resolved','closed','waiting_customer') and last_message_by = 'customer'),
    'resolved', count(*) filter (where status = 'resolved'),
    'closed', count(*) filter (where status = 'closed'),
    'urgent_open', count(*) filter (where priority = 'urgent' and status not in ('resolved','closed')))
    from public.support_tickets t);
end $$;

create or replace function public.admin_support_list(
  p_status text default null, p_category text default null, p_priority text default null, p_restaurant uuid default null,
  p_from date default null, p_to date default null, p_unread_only boolean default false, p_needs_reply boolean default false,
  p_search text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_search,'')),'');
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(q.x order by q.o1 desc, q.o2 desc, q.o3 desc, q.ts desc) from (
    select jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number, 'subject', t.subject, 'category', t.category, 'status', t.status,
      'priority', t.priority, 'perceived_priority', t.perceived_priority, 'business_name', coalesce(r.name, t.business_name), 'restaurant_id', t.restaurant_id,
      'created_at', t.created_at, 'last_message_at', t.last_message_at, 'last_message_by', t.last_message_by,
      'unread', (select count(*) from public.support_messages m where m.ticket_id = t.id and m.author_role = 'customer' and m.read_by_admin_at is null)) as x,
      (t.priority = 'urgent' and t.status not in ('resolved','closed')) as o1,
      (t.status = 'received') as o2,
      (t.status not in ('resolved','closed','waiting_customer') and t.last_message_by = 'customer') as o3,
      t.last_message_at as ts
    from public.support_tickets t left join public.restaurants r on r.id = t.restaurant_id
    where (p_status is null or t.status = p_status) and (p_category is null or t.category = p_category)
      and (p_priority is null or t.priority = p_priority) and (p_restaurant is null or t.restaurant_id = p_restaurant)
      and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to + 1)
      and (not coalesce(p_unread_only,false) or exists (select 1 from public.support_messages m where m.ticket_id = t.id and m.author_role = 'customer' and m.read_by_admin_at is null))
      and (not coalesce(p_needs_reply,false) or (t.status not in ('resolved','closed','waiting_customer') and t.last_message_by = 'customer'))
      and (v_q is null or t.subject ilike '%' || v_q || '%' or coalesce(r.name, t.business_name,'') ilike '%' || v_q || '%'
           or ('KT-' || lpad(t.ticket_number::text, 6, '0')) ilike '%' || v_q || '%' or t.ticket_number::text = ltrim(v_q,'#'))
    order by o1 desc, o2 desc, o3 desc, ts desc
    limit least(greatest(coalesce(p_limit,100),1),200) offset greatest(coalesce(p_offset,0),0)) q), '[]'::jsonb);
end $$;

create or replace function public.admin_support_get(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.support_tickets; r record; s record;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = p_ticket;
  if not found then raise exception 'not_found'; end if;
  select name, slug, whatsapp, logo_path, cover_path, is_published into r from public.restaurants where id = t.restaurant_id;
  select plan_id, status, current_period_end into s from public.subscriptions where restaurant_id = t.restaurant_id limit 1;
  return jsonb_build_object('ticket', to_jsonb(t),
    'restaurant', jsonb_build_object('id', t.restaurant_id, 'name', coalesce(r.name, t.business_name), 'slug', coalesce(r.slug, t.restaurant_slug),
        'whatsapp', coalesce(nullif(btrim(r.whatsapp),''), t.business_whatsapp), 'logo_path', r.logo_path, 'cover_path', r.cover_path, 'is_published', r.is_published,
        'plan_id', coalesce(s.plan_id, t.plan_id), 'subscription_status', coalesce(s.status, t.subscription_status), 'current_period_end', s.current_period_end),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.support_ticket_events e where e.ticket_id = t.id), '[]'::jsonb));
end $$;

create or replace function public.admin_support_mark_read(p_ticket uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.support_messages set read_by_admin_at = now() where ticket_id = p_ticket and author_role = 'customer' and read_by_admin_at is null;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.admin_support_reply(p_ticket uuid, p_body text, p_kind text default 'public', p_set_status text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t public.support_tickets; m public.support_messages; v_new text;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'not_found'; end if;
  if p_kind not in ('public','internal_note') then raise exception 'invalid_kind'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 5000 then raise exception 'invalid_body'; end if;
  if p_set_status is not null and p_set_status not in ('received','in_review','in_progress','waiting_customer','resolved','closed') then raise exception 'invalid_status'; end if;
  if p_request_id is not null then
    select * into m from public.support_messages where author_id = v_uid and client_request_id = p_request_id;
    if found then return jsonb_build_object('id', m.id, 'duplicate', true); end if;
  end if;
  insert into public.support_messages (ticket_id, author_id, author_role, author_name, kind, body, client_request_id, read_by_admin_at)
  values (t.id, v_uid, 'admin', 'Equipo KARTTA', p_kind, btrim(p_body), p_request_id, now()) returning * into m;
  if p_kind = 'public' then
    -- Responder NO resuelve el ticket: solo pasa de «Recibido» a «En revisión», o aplica el estado que el admin eligió.
    v_new := coalesce(p_set_status, case when t.status = 'received' then 'in_review' else t.status end);
    update public.support_tickets set last_message_at = now(), last_message_by = 'admin', updated_at = now(), status = v_new,
        resolved_at = case when v_new = 'resolved' then coalesce(resolved_at, now()) else null end,
        closed_at = case when v_new = 'closed' then coalesce(closed_at, now()) else null end
     where id = t.id;
    insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, visible_to_customer) values (t.id, v_uid, 'admin', 'message_public', false);
    if v_new <> t.status then
      insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, old_value, new_value, visible_to_customer)
      values (t.id, v_uid, 'admin', 'status_changed', t.status, v_new, true);
    end if;
  else
    update public.support_tickets set updated_at = now() where id = t.id;   -- una nota interna no cambia el último mensaje visible
    insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, visible_to_customer) values (t.id, v_uid, 'admin', 'note_internal', false);
  end if;
  return jsonb_build_object('id', m.id, 'duplicate', false);
end $$;

create or replace function public.admin_support_set_status(p_ticket uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('received','in_review','in_progress','waiting_customer','resolved','closed') then raise exception 'invalid_status'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'not_found'; end if;
  if t.status = p_status then return; end if;
  update public.support_tickets set status = p_status, updated_at = now(),
      resolved_at = case when p_status = 'resolved' then coalesce(resolved_at, now()) else null end,
      closed_at   = case when p_status = 'closed'   then coalesce(closed_at, now())   else null end
   where id = t.id;
  insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, old_value, new_value, visible_to_customer)
  values (t.id, auth.uid(), 'admin', case when t.status in ('resolved','closed') and p_status not in ('resolved','closed') then 'reopened' else 'status_changed' end, t.status, p_status, true);
end $$;

create or replace function public.admin_support_set_priority(p_ticket uuid, p_priority text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid_priority'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'not_found'; end if;
  if t.priority = p_priority then return; end if;
  update public.support_tickets set priority = p_priority, updated_at = now() where id = t.id;
  insert into public.support_ticket_events (ticket_id, actor_id, actor_role, event_type, old_value, new_value, visible_to_customer)
  values (t.id, auth.uid(), 'admin', 'priority_changed', t.priority, p_priority, false);
end $$;

-- Documentos legales: publicar una nueva versión (archiva la anterior). Solo admin.
create or replace function public.admin_legal_publish(
  p_doc_type text, p_version text, p_title text, p_summary text, p_content jsonb, p_effective date,
  p_legal_review text default 'pending', p_require_reacceptance boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_doc_type not in ('privacy','data_processing','terms','cookies','security','rights') then raise exception 'invalid_doc_type'; end if;
  if jsonb_typeof(p_content) <> 'array' then raise exception 'invalid_content'; end if;
  update public.legal_document_versions set status = 'archived' where doc_type = p_doc_type and status = 'published';
  insert into public.legal_document_versions (doc_type, version, title, summary, content, status, legal_review, effective_date, published_at, published_by)
  values (p_doc_type, p_version, p_title, p_summary, p_content, 'published', coalesce(p_legal_review,'pending'), p_effective, now(), auth.uid())
  on conflict (doc_type, version) do update set title = excluded.title, summary = excluded.summary, content = excluded.content, status = 'published',
      legal_review = excluded.legal_review, effective_date = excluded.effective_date, published_at = now(), published_by = auth.uid();
  -- Solo los documentos del flujo de consentimiento (terms/privacy/cookies) pueden exigir una nueva aceptación.
  -- Al subir la versión en public.legal_documents, el flujo existente (my_requirements) vuelve a pedir la aceptación.
  if p_require_reacceptance and p_doc_type in ('terms','privacy','cookies') then
    update public.legal_documents set version = p_version, updated_at = now() where doc_type = p_doc_type;
  end if;
end $$;

create or replace function public.admin_legal_set_contact(p_legal_name text, p_nit text, p_address text, p_privacy_email text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.legal_contact set legal_name = nullif(btrim(p_legal_name),''), nit = nullif(btrim(p_nit),''), address = nullif(btrim(p_address),''),
         privacy_email = nullif(btrim(p_privacy_email),''), phone = nullif(btrim(p_phone),''), updated_at = now(), updated_by = auth.uid() where id = true;
end $$;

-- ---------------------------------------------------------------------------
-- 7) PERMISOS DE EJECUCIÓN (cada función valida identidad/rol por dentro)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'support_create_ticket(uuid,text,text,text,text,uuid)','support_reply(uuid,text,uuid)',
    'support_add_attachment(uuid,uuid,text,text,text,integer)','support_my_tickets(uuid)','support_mark_read(uuid)','support_unread_count(uuid)',
    'admin_support_overview()','admin_support_list(text,text,text,uuid,date,date,boolean,boolean,text,integer,integer)','admin_support_get(uuid)',
    'admin_support_mark_read(uuid)','admin_support_reply(uuid,text,text,text,uuid)','admin_support_set_status(uuid,text)','admin_support_set_priority(uuid,text)',
    'admin_legal_publish(text,text,text,text,jsonb,date,text,boolean)','admin_legal_set_contact(text,text,text,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8) TIEMPO REAL (el chat se actualiza sin recargar; RLS sigue filtrando las notas internas)
-- ---------------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.support_messages; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.support_tickets;  exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 9) TEXTOS LEGALES INICIALES (publicados, PENDIENTES de revisión jurídica)
--    Basados en las páginas privacidad.html / terminos.html / cookies.html ya existentes.
-- ---------------------------------------------------------------------------
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('privacy','1.0',$j$Política de privacidad$j$,$j$Qué datos recopilamos, para qué los usamos, con quién los compartimos y cómo ejercer tus derechos.$j$,$j$[{"h": "1. Quién es el responsable", "p": ["KARTTA trata los datos de tu cuenta como responsable. Los datos de identificación y el canal de consultas están en la sección «Contacto legal y privacidad» de este centro; si todavía aparece como pendiente, es porque aún no se ha configurado."]}, {"h": "2. Qué datos tratamos", "p": ["Cuenta: correo y contraseña (la contraseña la gestiona Supabase Auth y KARTTA no la ve en claro). Si entras con Google, recibimos nombre, correo y foto de perfil; nunca tu contraseña de Google.", "Edad: pedimos la fecha de nacimiento solo para comprobar que tienes 18 años o más. No la conservamos: guardamos únicamente que eres mayor de edad y cuándo se verificó.", "Aceptaciones: qué documentos aceptaste, su versión y la fecha.", "Tu negocio: nombre, tipo, descripción, teléfono, WhatsApp, ciudad, dirección, carta, productos, imágenes, mesas y preferencias del panel (tema y color de acento).", "Clientes de tu negocio: cuando alguien hace un pedido en tu carta pública registramos su nombre, teléfono (opcional), mesa y productos pedidos. Si activas fidelización, también el teléfono o WhatsApp y los puntos del cliente.", "Soporte: los reportes que envías (asunto, descripción, capturas, mensajes) junto con tu correo, el nombre del negocio y su identificador.", "Medición de la carta pública: visitas y escaneos de QR con un identificador de sesión aleatorio, sin perfil publicitario."]}, {"h": "3. Para qué los usamos", "p": ["Para crear y mantener tu cuenta, prestar el servicio (carta, pedidos, estadísticas, asistente), atender tus reportes de soporte, mantener la seguridad, prevenir fraude y cumplir obligaciones legales. No vendemos tus datos."]}, {"h": "4. Autorización y base legal", "p": ["Tratamos tus datos con tu autorización informada al registrarte y aceptar esta política, y cuando sea necesario para ejecutar el servicio que solicitas o cumplir la ley. Puedes revocar la autorización cuando no lo impida un deber legal o contractual."]}, {"h": "5. Ubicación", "p": ["KARTTA no solicita ni recoge tu ubicación. Las direcciones que escribes para tu negocio son datos que tú ingresas."]}, {"h": "6. Proveedores que procesan información", "p": ["Supabase: autenticación, base de datos, archivos y funciones del servidor.", "Vercel: alojamiento del sitio.", "Google: inicio de sesión con Google y tipografías (Google Fonts).", "jsDelivr y cdnjs: entrega de librerías de código.", "Proveedores de inteligencia artificial: el texto o la imagen que envías al asistente o al generador de imágenes se envía al proveedor correspondiente para responderte. No escribas datos sensibles en el chat.", "Estos proveedores pueden tratar datos en servidores fuera de Colombia (transferencia internacional)."]}, {"h": "7. Conservación", "p": ["Conservamos tus datos mientras tu cuenta esté activa y, tras su cierre, durante el plazo que la ley exija. Los registros de aceptación se conservan para poder demostrar tu autorización. Los reportes de soporte se conservan como historial del servicio."]}, {"h": "8. Tus derechos", "p": ["Consulta la sección «Derechos y solicitudes» para saber cómo ejercerlos."]}, {"h": "9. Menores de edad", "p": ["KARTTA no está dirigida a menores de 18 años y no permite su uso."]}, {"h": "10. Cambios", "p": ["Si esta política cambia de forma relevante publicaremos una nueva versión, la verás aquí con su fecha de vigencia y, cuando corresponda, te pediremos aceptarla otra vez."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('data_processing','1.0',$j$Tratamiento de datos personales$j$,$j$Qué datos tratan KARTTA y el restaurante, y quién responde por cada uno.$j$,$j$[{"h": "1. Idea general", "p": ["En KARTTA conviven dos tipos de datos. Los de tu cuenta de dueño o miembro del equipo, que trata KARTTA para darte el servicio, y los de tus clientes, que trata tu restaurante usando la herramienta de KARTTA. La calificación jurídica exacta de cada rol (responsable o encargado) debe ser confirmada en la revisión jurídica de este documento."]}, {"h": "2. Propietarios y miembros del equipo", "p": ["Datos: nombre, correo, rol dentro del restaurante, preferencias del panel y actividad necesaria para la seguridad. Finalidad: crear la cuenta, controlar quién accede a qué y atender el soporte. Acceso: la persona titular, el dueño o administrador del restaurante según su rol y el personal autorizado de KARTTA cuando es necesario para soporte o seguridad."]}, {"h": "3. Clientes finales de tu restaurante", "p": ["Datos: nombre, teléfono (opcional), mesa y productos pedidos; y, si activas fidelización, teléfono o WhatsApp y puntos. El restaurante decide para qué usar esos datos y es quien debe informar a sus clientes y obtener su autorización cuando la ley lo exija. KARTTA los almacena y procesa por encargo del restaurante para prestar el servicio."]}, {"h": "4. Qué responsabilidades tiene cada parte", "p": ["KARTTA: mantener las medidas de seguridad descritas en este centro, aislar los datos de cada restaurante y no usar los datos de tus clientes para fines propios distintos del servicio.", "El restaurante: usar los datos de sus clientes solo para finalidades legítimas y informadas, atender las solicitudes de sus clientes y no cargar datos que no tenga derecho a tratar."]}, {"h": "5. Datos que no debes cargar", "p": ["No cargues datos sensibles (salud, origen racial, orientación sexual, creencias, datos biométricos) ni datos de menores en campos de texto libre, reportes de soporte o en el chat de IA."]}, {"h": "6. Terceros", "p": ["Los proveedores tecnológicos que intervienen se describen en la política de privacidad."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('terms','2.0',$j$Términos y condiciones$j$,$j$Condiciones de uso de KARTTA, responsabilidades, planes, pagos y cierre de cuenta.$j$,$j$[{"h": "1. Qué es KARTTA", "p": ["KARTTA es una plataforma para que restaurantes y negocios gastronómicos administren su carta digital con QR, su página pública, mesas, pedidos y estadísticas, con un asistente de inteligencia artificial disponible en algunos planes."]}, {"h": "2. Quién puede usarla", "p": ["KARTTA es solo para personas de 18 años o más. Las cuentas son personales y debes darnos información veraz."]}, {"h": "3. Tu cuenta y su seguridad", "p": ["Puedes entrar con correo y contraseña o con Google. Eres responsable de mantener segura tu contraseña y de lo que se haga desde tu sesión. Si crees que alguien accedió sin permiso, avísanos de inmediato desde «Soporte y reportes». Cada cuenta solo accede a los datos de su propio negocio."]}, {"h": "4. Normas de uso", "p": ["No suplantes a otras personas ni negocios. No subas contenido ilegal, engañoso o que infrinja derechos de terceros. No intentes acceder a datos de otros negocios, vulnerar la seguridad ni saturar el servicio. No uses KARTTA para fraude o abuso."]}, {"h": "5. Restaurantes, pedidos y servicios", "p": ["El restaurante es responsable de su carta, precios, disponibilidad, atención de los pedidos y del cumplimiento de la normativa que le aplique (sanitaria, de consumo, tributaria). KARTTA ofrece la herramienta; la compra de comida es una relación entre el cliente y el restaurante. Si en el futuro se incorporan pagos, reservas o reembolsos, estos términos se actualizarán antes de activarlos."]}, {"h": "6. Contenido y propiedad intelectual", "p": ["Tu contenido (logo, fotos, textos, carta) sigue siendo tuyo; nos autorizas a alojarlo y mostrarlo para prestarte el servicio. Declaras tener derecho a usarlo. La marca KARTTA, su software y su diseño son de sus titulares."]}, {"h": "7. Asistente de IA", "p": ["Las respuestas y las imágenes generadas por IA son automáticas, pueden contener errores y no sustituyen asesoría profesional. Revísalas antes de usarlas."]}, {"h": "8. Planes, pagos y cancelaciones", "p": ["El plan de prueba dura el periodo indicado en la web. Los planes de pago se cobrarán según los precios publicados al momento de contratarlos. Las condiciones de renovación, cancelación y reembolso se detallarán aquí antes de activar cobros automáticos."]}, {"h": "9. Suspensión y cierre", "p": ["Puedes dejar de usar KARTTA y pedir el cierre de tu cuenta cuando quieras. Podemos restringir o suspender una cuenta si incumple estos términos o por seguridad, indicándote el motivo cuando sea posible."]}, {"h": "10. Limitaciones del servicio", "p": ["Hacemos lo razonable para que el servicio funcione de forma continua y segura, pero puede haber interrupciones. No excluimos la responsabilidad que la ley no permita excluir."]}, {"h": "11. Cambios", "p": ["Si cambiamos estos términos de forma relevante publicaremos una nueva versión y te pediremos aceptarla de nuevo antes de continuar."]}, {"h": "12. Contacto y ley aplicable", "p": ["Los datos de contacto están en la sección «Contacto legal y privacidad». La ley aplicable y el responsable se confirmarán en la revisión jurídica de este documento."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('cookies','1.0',$j$Cookies y tecnologías similares$j$,$j$Qué se guarda en tu navegador, para qué y cómo cambiarlo.$j$,$j$[{"h": "1. Resumen", "p": ["KARTTA no usa cookies de analítica ni de publicidad. Guarda unos pocos datos en tu navegador (almacenamiento local o de sesión), que se explican aquí."]}, {"h": "2. Necesarias (siempre activas)", "p": ["Token de sesión de Supabase (localStorage): mantiene tu sesión iniciada.", "kartta_consent (localStorage): recuerda lo que decidiste sobre las cookies.", "kartta_promo_shown (sessionStorage): evita repetir un aviso durante la sesión.", "kartta_sid (sessionStorage): identificador aleatorio de la visita a una carta pública, para contar visitas."]}, {"h": "3. Preferencias (opcionales)", "p": ["kartta_prefs (localStorage): tema (claro u oscuro) y color de acento del panel en este dispositivo. Si las rechazas, esas preferencias se guardan solo en tu cuenta y se aplican al cargar el panel."]}, {"h": "4. Servicios de terceros", "p": ["Al cargar las páginas, tu navegador solicita archivos a Google Fonts, jsDelivr y cdnjs. Esos proveedores reciben tu dirección IP al servirlos."]}, {"h": "5. Cómo cambiar tu decisión", "p": ["Usa «Configurar cookies» en el pie de la página o borra los datos del sitio desde tu navegador."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('security','1.0',$j$Seguridad y protección de la información$j$,$j$Las medidas de seguridad que existen hoy y lo que depende de ti.$j$,$j$[{"h": "1. Qué hacemos hoy", "p": ["Las conexiones al sitio y a la base de datos usan cifrado en tránsito (HTTPS).", "Cada restaurante solo puede leer y modificar sus propios datos: el acceso se controla con reglas en la base de datos (RLS), no solo en la pantalla.", "La contraseña la gestiona Supabase Auth; KARTTA no la ve en claro.", "Los precios de los pedidos se calculan en el servidor, no en el navegador del cliente.", "Las claves de los servicios de IA y de pagos viven en el servidor y no se exponen en el navegador.", "Los reportes de soporte y sus adjuntos solo los ven el restaurante que los creó y el equipo autorizado de KARTTA; las notas internas nunca se muestran al restaurante."]}, {"h": "2. Lo que depende de ti", "p": ["Usa una contraseña única, no compartas tu sesión, cierra sesión en dispositivos compartidos y da acceso a tu equipo solo con el rol necesario."]}, {"h": "3. Límites", "p": ["Ninguna plataforma puede garantizar una seguridad absoluta. Si detectas un problema de seguridad, repórtalo desde «Soporte y reportes». Si ocurre un incidente que te afecte, te lo informaremos por correo."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;
insert into public.legal_document_versions (doc_type,version,title,summary,content,status,legal_review,effective_date,published_at)
values ('rights','1.0',$j$Derechos y solicitudes$j$,$j$Cómo pedir acceso, actualización, rectificación o supresión de tus datos.$j$,$j$[{"h": "1. Tus derechos", "p": ["Según la Ley 1581 de 2012 y sus normas reglamentarias puedes: conocer, actualizar y rectificar tus datos; solicitar prueba de la autorización; ser informado del uso que se les da; revocar la autorización y pedir la supresión cuando proceda; y presentar quejas ante la Superintendencia de Industria y Comercio (SIC)."]}, {"h": "2. Cómo solicitarlo", "p": ["Desde «Soporte y reportes» crea un reporte con la categoría «Solicitud de ayuda» y explica qué derecho quieres ejercer.", "También puedes usar el canal de la sección «Contacto legal y privacidad» cuando esté configurado.", "Si eres cliente final de un restaurante, tu solicitud sobre tus pedidos o tu tarjeta de puntos debe dirigirse primero a ese restaurante."]}, {"h": "3. Plazos", "p": ["La ley fija plazos para responder consultas y reclamos (en general, 10 y 15 días hábiles respectivamente, prorrogables en los casos que la norma permite). Los plazos exactos y el procedimiento definitivo se confirmarán en la revisión jurídica."]}, {"h": "4. Cierre de cuenta", "p": ["Puedes pedir el cierre de tu cuenta y la eliminación de los datos asociados. Algunos registros pueden conservarse cuando la ley lo exija."]}]$j$::jsonb,'published','pending','2026-11-01',now())
on conflict (doc_type,version) do nothing;

-- ---------------------------------------------------------------------------
-- ROLLBACK (solo si necesitas deshacer; borra TODOS los tickets y textos de esta migración)
--   drop table if exists public.support_ticket_events, public.support_attachments, public.support_messages, public.support_tickets cascade;
--   drop table if exists public.legal_document_versions, public.legal_contact cascade;
--   drop function if exists private.support_can_see(uuid,uuid), private.support_actor_name(uuid);
--   drop function if exists public.support_create_ticket(uuid,text,text,text,text,uuid), public.support_reply(uuid,text,uuid),
--     public.support_add_attachment(uuid,uuid,text,text,text,integer), public.support_my_tickets(uuid), public.support_mark_read(uuid),
--     public.support_unread_count(uuid), public.admin_support_overview(),
--     public.admin_support_list(text,text,text,uuid,date,date,boolean,boolean,text,integer,integer), public.admin_support_get(uuid),
--     public.admin_support_mark_read(uuid), public.admin_support_reply(uuid,text,text,text,uuid), public.admin_support_set_status(uuid,text),
--     public.admin_support_set_priority(uuid,text), public.admin_legal_publish(text,text,text,text,jsonb,date,text,boolean),
--     public.admin_legal_set_contact(text,text,text,text,text);
--   drop policy if exists support_att_read on storage.objects; drop policy if exists support_att_insert on storage.objects;
--   (el bucket support-attachments se elimina desde Storage > Buckets, vaciándolo antes)
-- ---------------------------------------------------------------------------
