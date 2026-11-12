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

## Worked example (English)

The user wrote `/driver:discover "waitlist page for an app"`. Language: English.

```
# Discover summary

**Goal.** A waitlist page for the app, to collect 200 emails in 30 days.

**What will be built.** A single page with an email form, a confirmation message and a place to store the emails.

**What you decided.**
- Audience: indie developers.
- Must have: email form and on-screen confirmation.
- Success signal: 200 emails in 30 days.

**What I decided for you.**
- Infrastructure and hosting: Vercel on the free plan (you already have an account and traffic is low).
- Data and privacy: store only the email and the date (there is no reason to collect more).
- Design and content: one language, English (the audience is English-speaking).
- Metrics: count of signups in the database, no analytics tool (less cost and no consent banner).

**What stays out.** Admin dashboard, referral links, payments.

**Open questions.** None.

**Size.** S (a few days), consistent with the answers.

Reply "accept", or say what to change, ask why I decided something, or ask me to open an area I skipped.
```
