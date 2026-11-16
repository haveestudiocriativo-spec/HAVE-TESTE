# Relatório de verificação de imagens — Have Studio Criativo

Data: 10/11/2026 · Escopo: todas as imagens em `public/images/` e as capas (`cover.jpg`) e posters em `public/media/`.

## Limites desta verificação (leia primeiro)

- Foi feita **inspeção visual + leitura de metadados** (EXIF, XMP, C2PA, comentários de arquivo).
- **Não foi feita busca reversa de imagem** (Google Lens, TinEye): isso exigiria enviar suas imagens a serviços externos, o que não fiz sem sua autorização.
- Metadados vazios **não provam** que a imagem é livre de direitos; apenas não há nenhum indício de licença ou de banco de imagens nos arquivos.
- Isto **não é parecer jurídico**. Para os itens de risco, confirme com seu advogado.

## Resultado por arquivo

| Arquivo | Onde aparece | O que é | Situação |
|---|---|---|---|
| `images/brand/have-logo-primary.png`, `have-logo-small.png` | Logo, favicon, intro | Logotipo “HAVE” | ✅ Marca própria. Sem indício de terceiros. Confirme que você tem o arquivo-fonte/contrato do designer e registre a marca no INPI (recomendado). |
| `images/about/cinema-camera.jpg` | **Não é usada** em `public/index.html` (só na versão antiga `index.html` da raiz, que o servidor não serve) | Foto de câmera de cinema, com aspecto de imagem **gerada por IA ou banco de imagens** | ⚠️ **Origem desconhecida.** Sem metadados de autoria/licença. Se não vai usar, apague. Se for usar, comprove a licença (compra em banco, ou geração por ferramenta que permita uso comercial). |
| `images/estudio/set/estudio-01.webp` a `estudio-08.webp` | Seção Estúdio (1º carrossel) | Fotos de gravações e do cenário do estúdio; participantes identificáveis em várias; marcas de programas nas telas (PodContar, Follow e outros) | 🔴 **Direito de imagem + LGPD + marcas.** Precisa de autorização das pessoas e dos programas. |
| `images/estudio/convidados/convidado-01.webp` a `convidado-06.webp` | Seção Estúdio (2º carrossel, "Quem já passou por aqui") | Convidados e apresentadores em entrevistas; rostos em destaque; marcas na roupa e nas telas | 🔴 **Direito de imagem + LGPD.** Ao chamar os convidados de "influências" que passaram pelo estúdio, o uso tem caráter promocional: exija autorização escrita de cada pessoa. |
| `images/clientes/autoeste-multimarcas.webp` | Portfólio, seção "Empresas que já trabalharam com a HAVE" | Logo **Autoeste Multimarcas** (fundo removido) | 🟠 **Marca de terceiro.** Peça autorização por escrito do cliente para usar a logo. |
| `images/clientes/fiat-autofoz.webp` | Portfólio, seção "Empresas que já trabalharam com a HAVE" | Logo **Fiat AutoFoz** (concessionária; fundo removido) | 🟠 **Marca registrada da Fiat + marca da concessionária.** Peça autorização por escrito da AutoFoz, que deve confirmar que pode autorizar o uso da marca Fiat. |
| `images/clientes/geely.webp` | Portfólio, seção "Empresas que já trabalharam com a HAVE" | Logo **Geely** (fundo removido) | 🟠 **Marca registrada de terceiro (montadora).** Use só se a HAVE trabalhou para a Geely ou para uma concessionária autorizada, e peça autorização por escrito para exibir a marca. |
| `images/clientes/champion-fried-chicken.webp` | Portfólio, seção "Empresas que já trabalharam com a HAVE" | Logo **Champion Fried Chicken** (fundo removido) | 🟠 **Marca de terceiro.** Mesma recomendação: autorização por escrito do cliente para usar a logo. |
| `images/clientes/idisa-50-anos.webp` | Portfólio, seção "Empresas que já trabalharam com a HAVE" | Logo comemorativa **Idisa 50 anos** (fundo removido) | 🟠 **Marca de terceiro.** Mostrar a logo de um cliente é comum, mas peça ao cliente uma autorização por escrito (e-mail basta) para usá-la como referência. |
| `media/portfolio/wonder-park/cover.jpg` | Capa do projeto Wonder Park | Carro **Mach 5 (Speed Racer)** em cenografia do parque | 🟠 **Propriedade intelectual de terceiros** (personagem/veículo da franquia). Aparece como parte do filme do cliente; use apenas com autorização do Wonder Park e evite destacá-lo como capa. |
| `media/portfolio/aniversario-guarda-municipal/cover.jpg` | Capa | Guarda e **uma criança** na rua | 🔴 **Criança identificável** (LGPD art. 14) + agente público. Exija autorização do responsável legal ou troque a capa. |
| `media/portfolio/institucional-idisa/cover.jpg` | Capa | Funcionários da Idisa; logo “idisa” visível | 🟠 Imagem de pessoas e marca de cliente. Verifique cláusula de uso em portfólio no contrato e autorização dos funcionários. |
| `media/portfolio/centro-de-convencoes/cover.jpg` | Capa | Espaço interno, sem pessoas | ✅ Baixo risco. Confirme a autorização do cliente. |
| `media/portfolio/rodeio-show-santa-terezinha/cover.jpg` | Capa | Vista aérea do evento; logo “Rodeio Show” | 🟠 Marca do evento/prefeitura. Confirme autorização do cliente. |
| `media/cortes/talksaude-corte-01.jpg`, `-02.jpg` | Seção Cortes | Quadros do Talk Saúde Podcast; apresentador identificável; marca do programa | 🔴 **Direito de imagem + marca do cliente.** Precisa de autorização do apresentador e do programa. Obs.: os arquivos trazem uma credencial C2PA que apenas registra que foram processados por uma ferramenta de IA; isso **não afeta** o direito sobre o conteúdo. |
| `media/portfolio/{aurora-campanha, festival-de-verao, manifesto-institucional, noite-adentro, raizes}/cover.jpg` | **Não aparecem** em `projects.json` | Gradientes abstratos (parecem gerados/criados) | ✅ Sem terceiros. Arquivos sem uso; pode apagar. |

Fontes: **Archivo** (Google Fonts) usa a licença SIL OFL, que permite uso comercial; está ok.
Os ícones do WhatsApp, Instagram e YouTube são desenhos em SVG feitos no código; as marcas pertencem aos seus donos, e o uso como link é prática comum (confira as diretrizes de marca de cada um se quiser usar o logotipo oficial).

## Conclusão

- **Nenhuma imagem trouxe indício técnico de banco de imagens pago ou de copyright de fotógrafo** (sem “Getty”, “Shutterstock”, “Adobe Stock” etc. nos arquivos).
- O risco **real** aqui não é copyright de foto, e sim **direito de imagem, LGPD e marcas de clientes/terceiros**, porque as imagens são quadros de vídeos com pessoas reais.
- **Ações recomendadas**, em ordem de prioridade:
  1. Coletar autorização de uso de imagem das pessoas das fotos dos dois carrosséis do estúdio, das 2 capas de Cortes, da capa da Guarda Municipal (criança: responsável legal) e da Idisa. Use o modelo em `/legal/autorizacao-uso-de-imagem.html`.
  2. Confirmar nos contratos dos clientes (Wonder Park, Idisa, Guarda, Prefeitura, Centro de Convenções, Talk Saúde, PodContar) a cláusula que permite exibição no portfólio.
  3. Trocar ou não destacar a capa do Wonder Park (veículo da franquia Speed Racer).
  4. Definir a origem de `cinema-camera.jpg`; se não houver licença, remova.
  5. Fazer busca reversa (Google Lens/TinEye) nas imagens que você não produziu para ter certeza.
  6. Os **vídeos** (`.mp4`) não foram analisados; eles podem conter músicas, trilhas e imagens de terceiros. Verifique a licença da trilha de cada vídeo (YouTube Audio Library, Epidemic Sound etc.).
