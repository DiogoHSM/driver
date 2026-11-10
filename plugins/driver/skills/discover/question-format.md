# Question format for the Discover interview

Read this before the first question. It describes how to call `AskUserQuestion` in the interview.

## Shape

Each call carries 1 to 4 questions. In the interview you send one, except in round 1 (two) and the exit (one). Each question has:

| Field | Rule |
|---|---|
| `question` | One decision, one sentence, then `Why it matters: ...` (one sentence). User's language. |
| `header` | Up to 12 characters. A noun: `Domain`, `Auth`, `Hosting`. |
| `multiSelect` | `false` for decisions. `true` only for non-goal candidates and similar lists. |
| `options` | 2 to 4. Two or three real options, then a final "Not sure / decide for me". |
| option `label` | Short. The recommended option comes first and ends with `(Recommended)`. |
| option `description` | The consequence of choosing it: cost, risk, what it unlocks or rules out. |

The tool adds an "Other" free-text field. Do not add an option for it. Do not repeat the list of options in the question text.

Recommend so that a plain "yes" is a good answer: the first option is what you would choose for this user, given what they told you.

Every question has a node `Q-nn` in `interview.md`. After the answer, write it in `## Rounds` in the same turn.

## Worked example 1 (Portuguese, domain of a new project)

The user wrote: `/driver:discover "página de lista de espera para um app"`. Language: Portuguese.

```json
{
  "questions": [
    {
      "question": "Que tipo de entrega é essa? Por que importa: define as camadas de teste e os provedores que vou sugerir.",
      "header": "Domínio",
      "multiSelect": false,
      "options": [
        {"label": "Site ou app web (Recommended)", "description": "Página pública com formulário; precisa de hospedagem e de um lugar para guardar e-mails."},
        {"label": "Documento ou apresentação", "description": "Entrega em arquivo; sem backend, a verificação é revisão visual."},
        {"label": "Automação ou dados", "description": "Script ou planilha; a verificação é rodar com dados de exemplo."},
        {"label": "Não sei / decida por mim", "description": "Assumo site web pela descrição e registro como premissa."}
      ]
    },
    {
      "question": "Quanto esforço você estima? Por que importa: define quantas rodadas de perguntas faço e quantos blocos o plano terá.",
      "header": "Tamanho",
      "multiSelect": false,
      "options": [
        {"label": "Uma tarde", "description": "Uma rodada curta, de 2 a 4 blocos."},
        {"label": "Alguns dias (Recommended)", "description": "Duas rodadas, de 4 a 8 blocos."},
        {"label": "Algumas semanas", "description": "Três rodadas, de 8 a 15 blocos."},
        {"label": "Meses ou um time", "description": "Entrevista longa, de 15 a 30 blocos."}
      ]
    }
  ]
}
```

The size question has four real options, so there is no "Not sure" slot. When that happens, rely on "Other": if the user types "não sei", infer the class, log `A-nn`, and say so. Use this four-option shape only in round 1.

## Worked example 2 (English, a decision with a safe default)

Round 2, class S. Node `Q-04`: where to store sign-ups. Facts already researched: the repo has no database, and the user listed `SUPABASE_URL` in the environment earlier.

```json
{
  "questions": [
    {
      "question": "Where should the sign-up emails be stored? Why it matters: it decides the provider, the credentials the project needs and how the signup block is tested.",
      "header": "Storage",
      "multiSelect": false,
      "options": [
        {"label": "Supabase table (Recommended)", "description": "You already use it. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as env vars. Real database, easy export."},
        {"label": "A CSV or JSON file", "description": "No account or credentials. Fine for a demo, loses data on serverless hosts."},
        {"label": "Not sure / decide for me", "description": "I adopt the recommended option and log it as assumption A-03 for you to confirm at the play back."}
      ]
    }
  ]
}
```

If the user picks "Not sure": adopt Supabase, add `A-03 Sign-ups are stored in a Supabase table` to `assumptions.md` with `Accepted: pending`, mark `Q-04` as `assumed` in the tree, and carry on.

## Worked example 3 (multiSelect, non-goals in round 3)

Offer candidates the user did not ask for but that the project could drift into. Two to four per question. If you have more, send them over several turns.

```json
{
  "questions": [
    {
      "question": "Which of these should we explicitly leave out? Why it matters: a non-goal is a promise, and the plan will not build or test it.",
      "header": "Non-goals",
      "multiSelect": true,
      "options": [
        {"label": "Admin dashboard", "description": "Sign-ups are read straight from the database. No login, no UI to maintain."},
        {"label": "Referral links", "description": "No invite codes or sharing mechanics in this version."},
        {"label": "Multi-language", "description": "One language only. Translations would need a content block per language."},
        {"label": "Payments", "description": "No billing, no money handling, which also keeps the risk level low."}
      ]
    }
  ]
}
```

Each selected item becomes `N-nn` in `non-goals.md` and a `non-goal` requirement at the exit. Items not selected are not recorded. The user can add others through "Other".

## Exit questions

Play back, then one question with `header` `Review`:

- "Accept all (Recommended)": the play back is complete and correct.
- "Change something": ask what, update the files, play back again.
- "Something is missing": ask what, add nodes to the tree, ask them, play back again.

## Do not

- Do not ask about things you can read from the repo or the docs.
- Do not ask two decisions in one question.
- Do not write long option descriptions. One sentence of consequence is enough.
- Do not treat a timeout or an empty answer as acceptance.
