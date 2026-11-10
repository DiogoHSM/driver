---
id: B-004
title: "Signup API"
---

# B-004 Signup API

## Spec

Signup API for the waitlist: one HTTP endpoint that validates an email, stores it once in the `waitlist` table and returns a result the landing page can show. Covers R-001 and R-003. Out of scope: the confirmation email (B-006) and any admin view (non-goal N-01).

## Acceptance criteria

- [ ] `POST /api/waitlist` with a valid email returns 201 and the row exists in `waitlist`.
- [ ] The same email posted twice returns 200 and the table still holds one row for it.
- [ ] An invalid email returns 422 with a field error and writes nothing.
- [ ] More than 10 requests per minute from one IP return 429.
- [ ] No credential value appears in the repository, logs or responses.

## Notes

Input: `waitlist` table schema from B-003; the validated email string from the landing page form (B-004).
Output: `app/api/waitlist/route.ts` and a passing integration test file `tests/api/waitlist.test.ts`.
Risk: medium, external database integration; mitigated by a test against a local Supabase instance and a retry-safe insert (unique index on email).
Provider: database via supabase (cli), credentials SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

## Handoff

