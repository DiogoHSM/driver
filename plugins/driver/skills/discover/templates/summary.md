# summary.md (you write this one)

The only Discover file you write with Write (requirement files go through `mcp__driver__req_doc`). If `.claude/driver/discover/summary.md` exists, Read it first, then Write it. Then show the same text in full as the final message of the turn, with no tool call after it. This is a user document: write it entirely in the user's language, headings included (the English structure below is only a guide). Keep the section order. Keep each section short.

Structure:

1. Goal (one or two sentences, and the success signal).
2. What will be built.
3. What you decided (the user's answers).
4. What I decided for you (each assumption with its reason, grouped by area).
5. What stays out.
6. Open questions (omit if none).
7. Size class (and one line if the answers contradict it).
8. One closing line: reply "accept", or say what to change, ask why something was decided, or open a skipped area.

## Worked example (Portuguese)

```
# Resumo do Discover

**Objetivo.** Uma página de lista de espera para o app, para juntar 200 e-mails em 30 dias.

**O que será construído.** Uma página única com formulário de e-mail, mensagem de confirmação e um lugar para guardar os e-mails.

**O que você decidiu.**
- Público: desenvolvedores independentes.
- Indispensável: formulário de e-mail e confirmação na tela.
- Sinal de sucesso: 200 e-mails em 30 dias.

**O que eu decidi por você.**
- Infraestrutura e hospedagem: Vercel com plano gratuito (você já tem conta e o tráfego é baixo).
- Dados e privacidade: guardar só o e-mail e a data (não há motivo para coletar mais).
- Design e conteúdo: uma língua, português (o público é brasileiro).
- Métricas: contagem de cadastros no banco, sem ferramenta de analytics (custo e consentimento a menos).

**O que fica de fora.** Painel de administração, links de indicação, pagamentos.

**Em aberto.** Nenhuma.

**Tamanho.** S (alguns dias), compatível com as respostas.

Responda "aceito", ou diga o que mudar, pergunte por que decidi algo, ou peça para abrir uma área que pulei.
```
