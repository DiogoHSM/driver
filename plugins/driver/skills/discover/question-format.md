# Question format for the Discover interview

Read this before the first question. It describes how to call `AskUserQuestion` in the interview.

## Shape

Each call carries 1 to 4 questions. In the interview you send one, except in the classify call (two). The summary is never asked with this tool: it is the final message of a turn. Each question has:

| Field | Rule |
|---|---|
| `question` | Progress marker, one decision in one sentence, then `Why it matters: ...` (one sentence). User's language. |
| `header` | Up to 12 characters. A noun: `Audience`, `Hosting`, `Areas`. |
| `multiSelect` | `false` for decisions. `true` only for the areas gate and lists of candidates. |
| `options` | 2 to 4. Real options first, then "Not sure / decide for me", and from the third question on "That is enough, summarize". |
| option `label` | Short. The recommended option comes first and ends with `(Recommended)`. |
| option `description` | The consequence of choosing it: cost, risk, what it unlocks or rules out. |

The tool adds an "Other" free-text field. Do not add an option for it. Do not repeat the list of options in the question text.

Recommend so that a plain "yes" is a good answer: the first option is what you would choose for this user, given what they told you.

## Progress and the "enough" option

- Budgets by class, all ceilings and not targets:

  | Class | Core questions | Area questions in total (max 3 per area) | Areas gate | Always-ask (outside both budgets) | Checkpoint |
  |---|---|---|---|---|---|
  | XS | 2 | 0 | skipped | at most 2 | no |
  | S | 4 | 3 | 1 question | at most 2 | no |
  | M | 6 | 6 | 1 question | at most 2 | up to 3 exchanges |
  | L | 8 | 9 | 1 question | at most 2 | up to 3 exchanges |

- Start every question text with the progress, for example `(3 of ~6)`. Count every question after the classify call (core, areas gate, area questions, always-ask). The number after `~` is your best estimate of how many you will ask in total. It can change, but never exceeds the ceilings above. Right after the areas gate, the next question's text states the real remaining total, for example `(6 of ~9: 3 more questions in your areas, then the summary)`. Orientation lines and "I assumed X" notes also go inside the question text, never in a separate message before the tool call (it is condensed in the terminal).
- The classify call has no progress marker and is not counted.
- Everything the user sees is in the user's language: the "(Recommended)" suffix, "Not sure / decide for me", "That is enough, summarize", headers and descriptions are all translated into the user's language. The examples below are for an English-speaking user.
- From the third question on, one option is "That is enough, summarize" (translated). Picking it: create and assume, with a `why`, every remaining decision the plan needs (in chosen and unchosen areas), log `checkpoint: skipped` when the class had a checkpoint, and jump to the Summary.
- Slot budget: the tool allows at most 4 options. From the third question on, "Not sure / decide for me" and "That is enough, summarize" take two slots, so a question has at most 2 real options. Before the third question it can have 3 real options.
- multiSelect lists (the areas gate, candidate non-goals) have neither "Not sure" nor "enough": selecting nothing means "none of these, decide for me".

## Worked example 1 (English, the classify call, not counted)

The user wrote: `/driver:discover "waitlist page for an app"`. Language: English.

```json
{
  "questions": [
    {
      "question": "What kind of deliverable is this? Why it matters: it sets the providers and the test layers I will suggest.",
      "header": "Domain",
      "multiSelect": false,
      "options": [
        {"label": "Website or web app (Recommended)", "description": "Public page with a form; needs hosting and a place to store emails."},
        {"label": "Document or presentation", "description": "File deliverable; with no backend, verification is a visual review."},
        {"label": "Automation or data", "description": "Script or spreadsheet; verification is running it with sample data."},
        {"label": "Not sure / decide for me", "description": "I assume a website from the description and record it as an assumption."}
      ]
    },
    {
      "question": "How much effort do you estimate? Why it matters: it sets how many product questions I ask and how many blocks the plan will have.",
      "header": "Size",
      "multiSelect": false,
      "options": [
        {"label": "One afternoon", "description": "2 questions, no areas, 2 to 4 blocks."},
        {"label": "A few days (Recommended)", "description": "Up to 4 product questions and up to 3 in the areas you choose, 4 to 8 blocks."},
        {"label": "A few weeks", "description": "Up to 6 product questions, up to 6 in the areas and a checkpoint, 8 to 15 blocks."},
        {"label": "Months or a team", "description": "Up to 8 product questions, up to 9 in the areas and a checkpoint, 15 to 30 blocks."}
      ]
    }
  ]
}
```

The size question has four real options, so there is no "Not sure" slot. When that happens, rely on "Other": if the user types "not sure", infer the class, log it as an assumption, and say so. Use this four-option shape only in the classify call.

## Worked example 2 (English, a core question with the "enough" option)

Class M, third question after classify, so the "enough" option appears. Node `Q-05`: who the audience is. Nothing in the repo answers it.

```json
{
  "questions": [
    {
      "question": "(3 of ~6) Who is the first audience for the waitlist page? Why it matters: it sets the tone of the copy and where the page is promoted.",
      "header": "Audience",
      "multiSelect": false,
      "options": [
        {"label": "Indie developers (Recommended)", "description": "Technical tone, short copy, shared on developer communities."},
        {"label": "General consumers", "description": "Plain language, more visuals, needs a wider acquisition plan."},
        {"label": "Not sure / decide for me", "description": "I pick the recommended option and list it as an assumption in the summary."},
        {"label": "That is enough, summarize", "description": "I assume defaults for everything still open and show the summary now."}
      ]
    }
  ]
}
```

Two real options plus the two escape options fill the four slots. If the user picks "Not sure", log the node as assumed with the recommendation and a one-line reason, and carry on.

## Worked example 3 (areas gate, multiSelect)

Class S or larger, after the core. Domain: web app. Two to four areas, derived from the domain.

```json
{
  "questions": [
    {
      "question": "(5 of ~8) Which areas do you want to decide in detail? Why it matters: the areas you skip, I decide and list in the summary with the reason.",
      "header": "Areas",
      "multiSelect": true,
      "options": [
        {"label": "Infrastructure and hosting", "description": "Where it runs, domain, cost. Up to 3 questions."},
        {"label": "Data and privacy", "description": "What is stored, retention, consent. Up to 3 questions."},
        {"label": "Design and content", "description": "Look, copy, languages. Up to 3 questions."},
        {"label": "Metrics", "description": "What you measure and with which tool. Up to 3 questions."}
      ]
    }
  ]
}
```

Other domains, as areas: document or deck (audience and tone, structure and length, visuals and branding, delivery and format); data or automation (data sources and quality, scheduling and triggers, error handling and alerts, outputs and storage). Selecting nothing means "decide everything for me".

A decision that is costly to reverse, spends money, collects sensitive data (payments, health, identity documents, minors) or acts on production is still asked in a skipped area. A contact e-mail field alone is not a reason.

## Worked example 4 (English, a question inside a chosen area)

Area "Infrastructure and hosting", question 2 of up to 3. Facts already researched: the repo is a Next.js app and the user has a Vercel account in the environment.

```json
{
  "questions": [
    {
      "question": "(7 of ~9) Where should the page be hosted? Why it matters: it decides the deploy steps, the monthly cost and the credentials the project needs.",
      "header": "Hosting",
      "multiSelect": false,
      "options": [
        {"label": "Vercel (Recommended)", "description": "You already have an account. Free tier is enough, deploy on every push."},
        {"label": "Cloudflare Pages", "description": "Also free, but needs a new project and a different build setup."},
        {"label": "Not sure / decide for me", "description": "I pick the recommended option and list it as an assumption."},
        {"label": "That is enough, summarize", "description": "I assume defaults for everything still open and show the summary now."}
      ]
    }
  ]
}
```

## Do not

- Do not ask about things you can read from the repo or the docs.
- Do not ask something with a safe default that is cheap to reverse. Log an assumption with a reason.
- Do not ask two decisions in one question.
- Do not write long option descriptions. One sentence of consequence is enough.
- Do not treat a timeout or an empty answer as acceptance.
- Do not ask for acceptance of the summary with this tool. The summary is the final message of the turn, and the user replies in their next message.
