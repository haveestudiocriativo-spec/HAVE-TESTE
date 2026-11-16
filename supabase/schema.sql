-- =====================================================================
-- Have Studio Criativo — estrutura segura para o painel (admin.html)
-- Rodar no Supabase: SQL Editor → colar tudo → Run. É idempotente.
--
-- Substitui os arquivos data/*.json e o login próprio do server.js:
--   users.json            → auth.users (Supabase Auth) + public.profiles
--   projects.json         → public.projects
--   contact-messages.json → public.contact_messages
--   contacts.json         → public.site_settings (chave 'contacts')
--   public/media/portfolio→ Storage, bucket 'portfolio'
--
-- Modelo de acesso:
--   anon          lê projetos publicados e contatos do site; só INSERE mensagens
--   authenticated só entra no painel quem tem linha em public.profiles (is_admin())
--   service_role  (Edge Function) cria/remove usuários — nunca no navegador
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Aceita só caminhos locais (/media/...) ou https:// — mesma regra do server.js.
create or replace function public.is_media_url(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is null
      or v = ''
      or (length(v) <= 1000
          and v ~ '^(/(?!/)[^\\[:space:][:cntrl:]]*|https://[^\\[:space:][:cntrl:]]+)$');
$$;


-- ---------------------------------------------------------------------
-- 1. Perfis de administrador
--    Quem tem linha aqui entra no painel. Todos têm o mesmo acesso
--    (igual ao painel atual). Não há cadastro aberto: ver passo 9.
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique
              check (username ~ '^[a-z0-9._-]{3,32}$'),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Definida depois de profiles porque consulta a tabela. SECURITY DEFINER evita
-- recursão de RLS; search_path vazio evita sequestro de funções.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- O painel precisa de pelo menos um usuário (regra do server.js).
create or replace function public.profiles_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.profiles) <= 1 then
    raise exception 'O painel precisa ter pelo menos um usuário.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_keep_one on public.profiles;
create trigger profiles_keep_one
  before delete on public.profiles
  for each row execute function public.profiles_keep_one();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Ninguém remove o próprio usuário (o painel desabilita esse botão).
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin() and id <> (select auth.uid()));

-- Sem policy de INSERT/UPDATE: só service_role (Edge Function) cria ou altera perfis.


-- ---------------------------------------------------------------------
-- 2. Projetos do portfólio
--    Campos camelCase do JSON → snake_case:
--    videoMobile→video_mobile, order→sort_order,
--    createdAt/updatedAt→created_at/updated_at
-- ---------------------------------------------------------------------

create table if not exists public.projects (
  id           text primary key
               check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 60),
  title        text not null check (length(btrim(title)) between 1 and 200),
  subtitle     text check (length(subtitle) <= 200),
  category     text not null default 'Publicidade'
               check (category in ('Publicidade','Entretenimento','Institucional',
                                   'Videoclipe','Documentário','Eventos')),
  client       text check (length(client) <= 200),
  director     text check (length(director) <= 200),
  year         integer check (year between 1900 and 2100),
  description  text check (length(description) <= 2000),
  video        text not null check (video <> '' and public.is_media_url(video)),
  preview      text check (public.is_media_url(preview)),
  video_mobile text check (public.is_media_url(video_mobile)),
  poster       text check (public.is_media_url(poster)),
  youtube      text check (youtube is null or (length(youtube) <= 300
               and youtube ~* '^https://((www|m)\.)?(youtube\.com|youtu\.be)/[^[:space:][:cntrl:]]+$')),
  published    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null default auth.uid()
);

-- Bancos criados antes da coluna youtube: ver supabase/youtube-links.sql.
alter table public.projects add column if not exists youtube text;

create index if not exists projects_public_idx
  on public.projects (sort_order) where published;
create index if not exists projects_order_idx
  on public.projects (sort_order);

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.projects force row level security;

-- Site público: só o que está publicado.
drop policy if exists projects_public_read on public.projects;
create policy projects_public_read on public.projects
  for select to anon, authenticated
  using (published);

-- Painel: administradores veem, criam, editam e excluem tudo (inclusive ocultos).
drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Reordenação atômica (substitui os vários PUT {order} do admin.js).
-- SECURITY INVOKER: a RLS acima continua valendo.
create or replace function public.reorder_projects(ids text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.projects p
     set sort_order = o.ord
    from unnest(ids) with ordinality as o(id, ord)
   where p.id = o.id;
$$;

revoke all on function public.reorder_projects(text[]) from public, anon;
grant execute on function public.reorder_projects(text[]) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Mensagens do formulário de contato
--    Visitante só INSERE. Só admin lê, marca como lida e apaga.
-- ---------------------------------------------------------------------

create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 2 and 120),
  email      text not null check (length(email) <= 160
                                  and email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone      text check (length(phone) <= 40),
  company    text check (length(company) <= 120),
  service    text check (length(service) <= 60),
  message    text not null check (length(btrim(message)) between 10 and 3000),
  ip         text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);
create index if not exists contact_messages_ip_idx
  on public.contact_messages (ip, created_at desc);

-- Antes de inserir: força campos controlados pelo servidor, grava o IP e aplica
-- limite (5 por IP / 10 min, 100 no total / hora) e teto de 5000 mensagens.
create or replace function public.contact_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hdrs jsonb;
  client_ip text;
begin
  begin
    hdrs := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    hdrs := '{}'::jsonb;
  end;

  client_ip := left(nullif(btrim(coalesce(
    hdrs ->> 'cf-connecting-ip',
    split_part(hdrs ->> 'x-forwarded-for', ',', 1)
  )), ''), 64);

  new.id         := gen_random_uuid();
  new.created_at := now();
  new.read_at    := null;
  new.ip         := client_ip;
  new.email      := lower(btrim(new.email));

  if client_ip is not null and
     (select count(*) from public.contact_messages
       where ip = client_ip and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Muitas mensagens em pouco tempo. Tente novamente mais tarde.'
      using errcode = 'P0001';
  end if;

  if (select count(*) from public.contact_messages
       where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Muitas mensagens em pouco tempo. Tente novamente mais tarde.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists contact_messages_guard on public.contact_messages;
create trigger contact_messages_guard
  before insert on public.contact_messages
  for each row execute function public.contact_messages_guard();

-- Mantém no máximo 5000 mensagens (apaga as mais antigas), como o server.js.
create or replace function public.contact_messages_prune()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.contact_messages
   where id in (
     select id from public.contact_messages
      order by created_at desc
     offset 5000
   );
  return null;
end;
$$;

drop trigger if exists contact_messages_prune on public.contact_messages;
create trigger contact_messages_prune
  after insert on public.contact_messages
  for each statement execute function public.contact_messages_prune();

alter table public.contact_messages enable row level security;
alter table public.contact_messages force row level security;

drop policy if exists contact_insert_public on public.contact_messages;
create policy contact_insert_public on public.contact_messages
  for insert to anon, authenticated
  with check (true);  -- validação fica nos CHECKs e no trigger acima

drop policy if exists contact_admin_select on public.contact_messages;
create policy contact_admin_select on public.contact_messages
  for select to authenticated using (public.is_admin());

drop policy if exists contact_admin_update on public.contact_messages;
create policy contact_admin_update on public.contact_messages
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists contact_admin_delete on public.contact_messages;
create policy contact_admin_delete on public.contact_messages
  for delete to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------
-- 4. Configurações públicas do site (substitui data/contacts.json)
-- ---------------------------------------------------------------------

create table if not exists public.site_settings (
  key        text primary key check (key in ('contacts')),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;
alter table public.site_settings force row level security;

drop policy if exists settings_public_read on public.site_settings;
create policy settings_public_read on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists settings_admin_write on public.site_settings;
create policy settings_admin_write on public.site_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.site_settings (key, value) values ('contacts', $json$
{
  "whatsapp": {
    "number": "+55 (45) 9978-2555",
    "url": "https://wa.me/554599782555?text=Ol%C3%A1%2C%20equipe%20Have!%20Gostaria%20de%20falar%20sobre%20um%20projeto."
  },
  "instagram": {
    "handle": "@haveestudiocriativo",
    "url": "https://instagram.com/haveestudiocriativo"
  },
  "youtube": {
    "url": "https://www.youtube.com/@HAVEESTUDIOCRIATIVO"
  },
  "email": {
    "address": "haveestudiocriativo@gmail.com",
    "url": "mailto:haveestudiocriativo@gmail.com?subject=Contato%20via%20Site"
  },
  "address": {
    "full": "Rua Bartolomeu de Gusmão, 1379 - Sala 17 - Centro, Foz do Iguaçu - PR, 85852-130",
    "mapsUrl": "https://www.google.com/maps/search/?api=1&query=Rua+Bartolomeu+de+Gusm%C3%A3o,+1379+-+Sala+17+-+Centro,+Foz+do+Igua%C3%A7u+-+PR,+85852-130",
    "embedUrl": "https://www.google.com/maps?q=Rua+Bartolomeu+de+Gusm%C3%A3o,+1379+-+Sala+17+-+Centro,+Foz+do+Igua%C3%A7u+-+PR,+85852-130&output=embed"
  }
}
$json$::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 5. Trilha de auditoria (quem criou/alterou/removeu o quê)
--    Só leitura para admin; ninguém escreve pelo cliente.
-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  table_name text not null,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor, action, table_name, row_id, old_data, new_data)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    rec ->> 'id',
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

drop trigger if exists projects_audit on public.projects;
create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function public.audit_row();

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or delete on public.profiles
  for each row execute function public.audit_row();


-- ---------------------------------------------------------------------
-- 6. Storage — bucket 'portfolio' (substitui /media/portfolio no disco)
--    Leitura pública por URL; envio/remoção só admin.
--    Caminho obrigatório: <slug-do-projeto>/<arquivo>.<ext>
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio', 'portfolio', true,
  52428800,  -- 50 MB (limite do plano Free; em planos pagos aumente aqui e em Storage → Settings)
  array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sem policy de SELECT para anon: a URL pública funciona, mas não dá para listar o bucket.
drop policy if exists portfolio_admin_select on storage.objects;
create policy portfolio_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'portfolio' and public.is_admin());

drop policy if exists portfolio_admin_insert on storage.objects;
create policy portfolio_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portfolio'
    and public.is_admin()
    and name ~* '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9._-]+\.(mp4|webm|mov|jpe?g|png|webp)$'
  );

drop policy if exists portfolio_admin_update on storage.objects;
create policy portfolio_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'portfolio' and public.is_admin())
  with check (bucket_id = 'portfolio' and public.is_admin());

drop policy if exists portfolio_admin_delete on storage.objects;
create policy portfolio_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio' and public.is_admin());


-- ---------------------------------------------------------------------
-- 7. Privilégios mínimos (defesa em profundidade além da RLS)
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.projects, public.contact_messages,
              public.site_settings, public.audit_log
  from anon, authenticated;

grant select                         on public.projects         to anon;
grant select                         on public.site_settings    to anon;
grant insert (name, email, phone, company, service, message)
                                     on public.contact_messages to anon;

grant select, insert, update, delete on public.projects         to authenticated;
grant select, update, delete         on public.contact_messages to authenticated;
grant insert (name, email, phone, company, service, message)
                                     on public.contact_messages to authenticated;
grant select, insert, update, delete on public.site_settings    to authenticated;
grant select, delete                 on public.profiles         to authenticated;
grant select                         on public.audit_log        to authenticated;

-- audit_log.id usa identity; nada a conceder em sequência para o cliente.


-- ---------------------------------------------------------------------
-- 7b. Solicitações de acesso ao painel (aprovação por outro administrador)
--     Criadas pela Edge Function admin-signup (pública) e decididas por
--     admin-users (approve/reject). Ver supabase/functions/.
-- ---------------------------------------------------------------------

create table if not exists public.admin_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  email       text not null check (length(email) <= 160),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  ip          text,
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz
);

create unique index if not exists admin_requests_pending_username_idx
  on public.admin_requests (username) where status = 'pending';
create unique index if not exists admin_requests_pending_email_idx
  on public.admin_requests (lower(email)) where status = 'pending';
create index if not exists admin_requests_user_idx on public.admin_requests (user_id);
create index if not exists admin_requests_decided_by_idx on public.admin_requests (decided_by);
create index if not exists admin_requests_ip_idx on public.admin_requests (ip, created_at desc);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists profiles_created_by_idx on public.profiles (created_by);

alter table public.admin_requests enable row level security;
alter table public.admin_requests force row level security;

drop policy if exists admin_requests_admin_read on public.admin_requests;
create policy admin_requests_admin_read on public.admin_requests
  for select to authenticated using (public.is_admin());

revoke all on public.admin_requests from anon, authenticated;
grant select on public.admin_requests to authenticated;

-- Funções de trigger não devem ser chamáveis pela API REST.
revoke all on function public.profiles_keep_one()          from public, anon, authenticated;
revoke all on function public.contact_messages_guard()     from public, anon, authenticated;
revoke all on function public.contact_messages_prune()     from public, anon, authenticated;
revoke all on function public.audit_row()                  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. Importar os projetos atuais (opcional) — exemplo de uma linha.
--    Gere o restante a partir de data/projects.json.
-- ---------------------------------------------------------------------
-- insert into public.projects
--   (id, title, subtitle, category, client, director, year, description,
--    video, preview, video_mobile, poster, published, sort_order)
-- values
--   ('rodeio-show-santa-terezinha', 'Rodeio Show', 'Rodeio Show Santa Terezinha',
--    'Eventos', 'Prefeitura de Santa Terezinha de Itaipu · Provopar', 'Equipe HAVE', null,
--    'Aftermovie do Rodeio Show Santa Terezinha: montarias, shows e o público na arena.',
--    '/media/portfolio/rodeio-show-santa-terezinha/video.mp4',
--    '/media/portfolio/rodeio-show-santa-terezinha/preview.mp4',
--    '/media/portfolio/rodeio-show-santa-terezinha/video-mobile.mp4',
--    '/media/portfolio/rodeio-show-santa-terezinha/cover.jpg', true, 1);


-- ---------------------------------------------------------------------
-- 9. Primeiro administrador (manual, uma vez)
--    a) Dashboard → Authentication → Providers → Email: DESLIGUE
--       "Allow new users to sign up" (cadastro aberto = qualquer um vira usuário).
--    b) Authentication → Users → Add user (e-mail + senha forte, "Auto Confirm").
--       O painel hoje usa "usuário"; no Supabase Auth o login é por e-mail.
--       Pode usar um e-mail interno, ex.: admin@have.local.
--    c) Rode, trocando o e-mail:
--
-- insert into public.profiles (id, username)
-- select id, 'admin' from auth.users where email = 'SEU_EMAIL_AQUI';
--
--    Novos usuários pelo painel: crie uma Edge Function com service_role que
--    chame auth.admin.createUser e insira em public.profiles — após checar
--    is_admin() do chamador. Nunca exponha a service_role no navegador.
-- ---------------------------------------------------------------------
