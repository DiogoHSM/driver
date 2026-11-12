# release/checklist.md (you write this one)

Path: `.claude/driver/release/checklist.md`. Read it first if it exists, then Write it. User document: write it entirely in the user's language, headings included. Compact: one line per item, a status of ok, fixed, not applicable or open.

Structure: version and commit; one line per checklist item (rollback plan with its paragraph, documentation, observability, pending credentials by name, tests and build); destination chosen and result; what the user still has to do.

## Worked example (Portuguese)

```
# Checklist de release 0.2.0

**Rollback.** Reverter o commit 3fa91c e reimplantar a versão anterior; sem migração de dados. ok
**Documentação.** README e notas de versão atualizados. corrigido
**Observabilidade.** Erros vão para o log do host; sem alertas. não se aplica a uma ferramenta local
**Credenciais.** SUPABASE_URL definida no host; RESEND_API_KEY pendente. aberto, é sua
**Testes e build.** 48 testes passam, build ok. ok

**Destino.** Manter local, sem push.
**Falta fazer por você.** Definir RESEND_API_KEY no host antes de ativar os e-mails.
```
