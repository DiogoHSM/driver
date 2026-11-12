# release/checklist.md (you write this one)

Path: `.claude/driver/release/checklist.md`. Read it first if it exists, then Write it. User document: write it entirely in the user's language, headings included. Compact: one line per item, a status of ok, fixed, not applicable or open.

Structure: version and commit; one line per checklist item (rollback plan with its paragraph, documentation, observability, pending credentials by name, tests and build); destination chosen and result; what the user still has to do.

## Worked example (English)

The user wrote `/driver:discover "waitlist page for an app"`. Language: English.

```
# Release checklist 0.2.0

**Rollback.** Revert commit 3fa91c and redeploy the previous version; no data migration. ok
**Documentation.** README and release notes updated. fixed
**Observability.** Errors go to the host log; no alerts. not applicable to a local tool
**Credentials.** SUPABASE_URL set on the host; RESEND_API_KEY pending. open, yours
**Tests and build.** 48 tests pass, build ok. ok

**Destination.** Keep local, no push.
**Still to do by you.** Set RESEND_API_KEY on the host before enabling the emails.
```
