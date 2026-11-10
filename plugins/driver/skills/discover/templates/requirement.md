---
id: R-001
title: Visitors can join the waitlist with an email
kind: functional
source: user
---

## Statement

A visitor who enters a valid email address on the landing page is added to the waitlist and sees a confirmation message. A repeated email is accepted without creating a duplicate.

## Acceptance signal

Observable and testable, in the user's language. Each line can be checked by a person or a test.

- Submitting a valid email shows "You are on the list" within 2 seconds.
- The email appears exactly once in the `waitlist` table after submitting it twice.
- An invalid email shows an inline error and does not write to the table.

## Origin

Q-05 (user answer, round 2)

## Notes

Anything Route or Implement should know: constraints, links, rejected alternatives. Write `-` when empty.

Field rules:

- `id` matches the id returned by `req.add` and the file name (`requirements/R-001.md`).
- `kind` and `source` copy the plan values (`functional | nonfunctional | constraint | non-goal`, `user | assumed`).
- Non-goals: the Statement says what is out of scope, the Acceptance signal says "Not built and not tested", the Origin cites `N-nn`.
- Assumptions: the Origin cites `A-nn` and the Notes say the requirement rests on an unconfirmed premise.
