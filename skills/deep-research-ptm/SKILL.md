# Deep Research PTM mode

## Clarification
Before Deep Research, the agent **judges** whether clarification is needed for this specific question.
- If the question is already clear (gene/site + concrete goal), skip clarification and research immediately.
- Otherwise, generate **1–3 tailored questions** with options grounded in the user's ask (user may skip or type freely).
- Do **not** use a fixed WHO → WHEN → WHERE → WHY pipeline.

## Supervisor (outer ReAct)
You orchestrate database search and, when needed, literature follow-up.
- Use the **ptm-databases** dimension map to judge gaps **for the dimensions the user asked about this turn**, not "any rows exist".
- **Direct intent (default for one dimension):** kinase/upstream → `get_upstream_enzymes`; conditions → `get_site_conditions`; disease → `get_function_disease`. Do **not** default to `breadth_search` then `depth_search`.
- **`breadth_search` (BFS):** multi-dimension or survey questions. One call runs parallel databases then **shallow** literature (titles/PMIDs from entities those hits produced). At most once this turn.
- **`depth_search` (DFS):** one known gap (`focus`) — empty DB, predicted-only, or the user asked for mechanism/papers. After breadth, at most **one** depth on the most important gap; never one depth per empty dimension.
- If the user names a source (e.g. qPTM only), pass `sources` on the intent. To list a full hit set, raise `limit` (max 200).
- If prior-turn database rows already answer a follow-up (list / filter / explain last hits), `finish_research`. Re-call the same intent only when results were truncated and the user wants the full set.
- `finish_research` when this turn can be answered; do not force extra searches because another unused dimension is empty.
- `web_search` only with specific mechanistic queries — never generic `PTM site`. Independent of breadth/depth. Do not default to calling it every turn.

## Planning (inside breadth_search)
1. Parse gene, site, PTM type from question + clarification.
2. Map user question to dimension rows in ptm-databases skill; schedule only matching intents — execute them as **one parallel BFS layer**.
3. Then a second BFS layer: shallow literature per asked dimension, using kinase/entity names from layer-1 rows. No OA full text in breadth.
4. Narrow kinase-only questions must not sweep LLPS/drugs/unrelated intents (prefer a direct intent instead of breadth).
5. Cross-validate conflicting sources and note conflicts in findings.

## Depth search (DFS)
1. Set `focus` to the single gap dimension (kinase, condition, disease, drug, localization, llps, function).
2. If that dimension's DB intent has not already succeeded or returned empty, query it first.
3. Literature query must include gene + focus terms; inject frontier entities (e.g. kinase names) in round 1. Never `GENE phosphorylation review` unless the user asked for a review.
4. Round 2 only if abstracts/DB reveal **new** entities not in round 1. Then merge PMIDs, fetch abstracts, and OA full text for the top hits.
5. Literature supplements gaps; do not treat PubTator titles as qPTM quantitative facts.

## User-visible writing
This skill is for **tool routing**, not for the user-facing answer. The answer composer does **not** load this file. Gap checks stay here for the next tool call; do not dump executive summary, evidence inventories, or a Limitations & gaps chapter into the reply.

Never label user-facing headings as WHO / WHEN / WHERE / WHY.

## Reasoning discipline
- For routing: prefer experimental/curated rows over predictions; web is lowest weight.
- Never collapse predicted scores into experimental claims when judging whether a lookup is enough.
- Do not tell the answer writer to list every empty dimension.
