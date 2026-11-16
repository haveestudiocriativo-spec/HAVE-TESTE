# Have Studio Criativo — site institucional

Site da Have Studio Criativo, produtora audiovisual em Foz do Iguaçu. A página apresenta o portfólio em vídeo, informações institucionais e canais de contato. O painel de administração (`/admin.html`) usa **Supabase** (login, banco de dados e armazenamento de arquivos).

## Como rodar

Requer **Node.js 18+**. O servidor não tem dependências para instalar.

```bash
npm start
```

- Site: http://localhost:3000
- Painel: http://localhost:3000/admin.html
- Outra porta (PowerShell): `$env:PORT = "8080"; npm start` · (macOS/Linux): `PORT=8080 npm start`

Não precisa de `.env` para rodar: o endereço e a chave **publishable** do Supabase já vêm configurados. Quem roda o projeto usa o **mesmo** banco do Supabase.

## Como o sistema funciona

| Parte | Onde fica |
|---|---|
| Site público (HTML/CSS/JS, vídeos do portfólio existentes) | `public/` servido por `src/server.js` |
| Lista de projetos do site | Supabase (`projects`), lida pelo servidor em `/api/projects` (com cache de 15 s e `data/projects.json` como reserva se o Supabase cair) |
| Login do painel | Supabase Auth (e-mail + senha) |
| Projetos, mensagens, usuários, configurações | Supabase (Postgres com RLS) |
| Vídeos e imagens enviados pelo painel | Supabase Storage, bucket `portfolio` |
| Criar/aprovar/remover administradores | Edge Functions `admin-users` e `admin-signup` |

O projeto Supabase é o `gkypknwysbswbciptqpu` ("haveestudiocriativo-spec's Project"). A chave publishable está em `public/js/supabase-config.js` e em `src/server.js`; ela é pública por desenho (a segurança vem das regras RLS do banco). **Nunca** coloque a `service_role` no código.

## Painel de administração

- **Entrar:** e-mail e senha cadastrados no Supabase. Só entra quem tem perfil de administrador (`public.profiles`).
- **Solicitar acesso:** na tela de login. A pessoa envia usuário, e-mail e senha; fica **bloqueada** até que **outro administrador aprove** na aba *Usuários → Solicitações de acesso*. Recusar apaga o cadastro.
- **Cadastrar usuário direto:** aba *Usuários* (feito por um administrador).
- **Portfólio:** *+ Novo projeto*, envie o vídeo (vai para o Storage), capa e versão para celular, use ▲ ▼ para ordenar e desmarque "Publicado" para ocultar. Mudanças aparecem no site em até ~15 s.
- **Mensagens:** aba *Mensagens* lê a tabela `contact_messages`.
- Limite de arquivo do Storage: **50 MB** no plano Free (aumente no Supabase em planos pagos).

### Primeiro administrador (projeto novo)

1. No Supabase: *Authentication → Providers → Email* e **desligue "Allow new users to sign up"**.
2. *Authentication → Users → Add user* (e-mail + senha, marque **Auto Confirm User**).
3. No SQL Editor:

```sql
insert into public.profiles (id, username)
select id, 'admin' from auth.users where email = 'SEU_EMAIL_AQUI';
```

### Recriar o Supabase do zero

1. Rode `supabase/schema.sql` no SQL Editor (tabelas, RLS, bucket e policies).
2. Publique as funções de `supabase/functions/`: `admin-users` (com verificação de JWT ligada) e `admin-signup` (**sem** verificação de JWT, é pública).
3. Troque a URL e a chave em `public/js/supabase-config.js` e `src/server.js` (ou use `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`).

## Estrutura

```
server.js                     atalho que inicia src/server.js (para hospedagens que rodam "node server.js")
src/server.js                 backend: arquivos estáticos com streaming + API pública
data/projects.json            reserva dos projetos (usada só se o Supabase falhar)
data/contacts.json            contatos oficiais públicos (/data/contacts.json)
data/contact-messages.json    legado; não usado pelo painel
data/lgpd-requests.json       pedidos LGPD do site (criado ao rodar; fora do Git)
public/index.html             landing page
public/admin.html             painel
public/css/ public/js/        estilos e scripts (public/js/vendor/supabase.js é a biblioteca do Supabase, local por causa da CSP)
public/images/ public/media/  imagens e vídeos (intro, cortes e portfólio original)
public/legal/                 páginas legais e LGPD
supabase/schema.sql           banco de dados, RLS e Storage
supabase/functions/           Edge Functions (admin-users, admin-signup)
.env.example                  variáveis de ambiente de produção
```

## API do servidor

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/projects` | projetos publicados (aceita `?category=`) |
| GET | `/api/projects/:id` | um projeto |
| GET | `/api/categories` | categorias |
| POST | `/api/contact` | `{ name, email, phone, company, service, message }` (grava em `data/contact-messages.json`) |
| POST | `/api/lgpd-request` | pedido de direitos do titular (grava em `data/lgpd-requests.json`) |
| GET | `/api/health` | verificação de saúde |

As rotas `/api/admin/*` pertencem ao **sistema antigo** (login por `users.json`) e ficam **desligadas**. Só funcionam com `LEGACY_ADMIN=1` e `ADMIN_TOKEN` forte, por exemplo para ler `GET /api/admin/lgpd-requests`. Os pedidos LGPD também podem ser lidos direto em `data/lgpd-requests.json`.

## Páginas legais e LGPD

| Página | Arquivo |
|---|---|
| Política de Privacidade | `public/legal/politica-de-privacidade.html` |
| Termos de Serviço | `public/legal/termos-de-servico.html` |
| Aviso de Cookies | `public/legal/aviso-de-cookies.html` |
| Direitos do titular (formulário LGPD) | `public/legal/lgpd-direitos-do-titular.html` → `POST /api/lgpd-request` |
| Autorização de uso de imagem (modelo para imprimir) | `public/legal/autorizacao-uso-de-imagem.html` |

- O banner de cookies (`public/js/cookies.js`) só carrega o mapa do Google após o aceite.
- A política promete eliminar mensagens de contato após 24 meses; o servidor ainda não faz isso automaticamente.
- Veja `RELATORIO-IMAGENS-COPYRIGHT.md` para a análise das imagens do site.

## Deploy (publicar em um domínio)

1. **Hospedagem com Node.js 18+** (não serve hospedagem só de arquivos estáticos). Comando de início: `npm start`. Use **disco persistente** para `data/` (pedidos LGPD) e `public/media/`; sem ele, esses arquivos somem a cada deploy. Os vídeos enviados pelo painel ficam no Supabase e não dependem do disco.
2. **Variáveis de ambiente** (veja `.env.example`): `SITE_URL` (ex.: `https://www.seudominio.com.br`), `TRUST_PROXY=1` e `FORCE_HTTPS=1` atrás de proxy/HTTPS.
3. **Domínio e HTTPS:** aponte o DNS para a hospedagem e ative o certificado. O servidor gera `canonical`, Open Graph, `sitemap.xml` e `robots.txt` com o `SITE_URL`.
4. **Painel:** fica em `https://seudominio.com.br/admin.html`. Não é necessário cadastrar o domínio no Supabase, pois o login é por e-mail e senha.
5. Depois de publicar: confira `/robots.txt`, `/sitemap.xml`, `/legal/politica-de-privacidade.html`, `/admin.html`, teste o compartilhamento no WhatsApp e cadastre o domínio no Google Search Console.
6. Faça backup periódico de `data/` e acompanhe o uso do Storage no Supabase.

## Ajustes rápidos

Em `public/js/site.js`:

- `SLIDE_DURATION`: tempo de cada vídeo antes de avançar (padrão 9 s).
- `INTRO_ONCE_PER_SESSION`: `true` para mostrar a vinheta só na primeira visita da sessão. Para forçar a vinheta, use `/?intro`.

Links das redes sociais: rodapé (`.bar`) e menu mobile em `public/index.html`.

## Navegação

Roda do mouse / trackpad, setas do teclado, swipe no celular ou clique nos pontos à direita. O menu filtra o portfólio por categoria. A vinheta pode ser pulada com o botão, `Esc` ou `Enter`. Se o navegador bloquear o autoplay (ex.: iPhone em modo economia), aparece o botão **Entrar**.
