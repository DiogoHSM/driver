# Non-goals

Things the project will not do. They are promises: the plan builds and tests none of them. Format: one line per item, `N-nn <statement> (reason) -> R-nnn`.

- N-01 No admin dashboard (sign-ups are read from the database directly) -> R-007
- N-02 No referral links or invite codes (out of scope for this version) -> R-008
- N-03 No payment handling (keeps the risk level low) -> R-009

Rules:

- Number `N-nn` in creation order. Never renumber.
- The `-> R-nnn` part is added at the exit, after `req.add` with `kind: "non-goal"` returns the ids. Before that, write `-> -`.
- A non-goal that the user later wants is not edited away. Retire its requirement with `req.retire` citing a decision, then add a normal requirement.
