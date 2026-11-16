-- =====================================================================
-- Link do YouTube por projeto
-- Rodar no Supabase: SQL Editor → colar tudo → Run. É idempotente.
--
-- O botão "assistir ao filme completo" do site abre este link no YouTube.
-- Projetos sem link continuam abrindo o player do próprio site.
-- =====================================================================

-- Aceita só links https do YouTube (youtube.com, www/m.youtube.com, youtu.be).
alter table public.projects
  add column if not exists youtube text;

alter table public.projects
  drop constraint if exists projects_youtube_check;
alter table public.projects
  add constraint projects_youtube_check check (
    youtube is null
    or (length(youtube) <= 300
        and youtube ~* '^https://((www|m)\.)?(youtube\.com|youtu\.be)/[^[:space:][:cntrl:]]+$')
  );

-- Links atuais dos filmes
update public.projects as p
   set youtube = v.url
  from (values
    ('rodeio-show-santa-terezinha',  'https://youtu.be/SjuTTXBVvFw'),
    ('institucional-idisa',          'https://youtu.be/uO5PrJuySkI'),
    ('wonder-park',                  'https://www.youtube.com/watch?v=Ss9ZTtUfZBw'),
    ('centro-de-convencoes',         'https://www.youtube.com/watch?v=uXiBL21fi7g'),
    ('aniversario-guarda-municipal', 'https://youtu.be/mMIUvL3u8CI')
  ) as v(id, url)
 where p.id = v.id;

-- Conferir
select id, title, youtube from public.projects order by sort_order;
