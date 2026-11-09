# Accessibility Ninja — hackathon execution plan

## Product slice

1. Upload one small PPTX.
2. Extract slide text, title candidates, picture descriptions, and the order objects appear in the slide XML.
3. Flag missing image descriptions / ambiguous title landmarks for human review.
4. Speaker authors or correct descriptions; nothing is presented as approved unless reviewed.
5. Generate an independently navigable HTML reading companion and search its contents.

Cut: automatic diagram interpretation, PPTX write-back, animation narration, OCR, arbitrary reading-order repair, RAG/chat, attendee accounts, and venue navigation. Search is intentionally focused: Elastic-managed text embeddings and hybrid retrieval over slide content.

## Four sponsor-tool evidence checklist

The organizer email says using all four sponsor tools is expected for the top-10 demo swag/book giveaway. The public event pages say track entry depends on genuine tool use. Treat this email as additional organizer guidance and document concrete evidence for each tool; never claim a checkbox based on configuration alone.

### Sonar / Gitar

- Install/connect Gitar only after reviewing requested GitHub permissions.
- Add `.gitar/review/accessibility.md` and any supported repository rules.
- Land at least two small features through PRs actually reviewed by Gitar.
- If Gitar finds a real CI or code problem, use diagnosis/auto-apply and record what it changed. Do not invent a failure just for the demo.
- Record PR links and what the tool found/fixed.

### Dash0

- Add OpenTelemetry traces/logs/metrics across upload, parse, index, and search.
- Send telemetry to the team's Dash0 project.
- Create a small dashboard / SLO.
- Use a real issue encountered during upload, parsing, indexing, or search; ask Agent0 or Dash0 MCP to diagnose it, then fix it. Avoid sending deck/query contents or personal data as telemetry attributes.

### Radar

- Build from the organizer-provided `skyhook-io/cnh-starter` template, configure team name `accessibility-ninja`, then deploy to its team namespace/cluster (the status page says it is ready). Do not use the currently selected personal AWS context.
- Use Radar UI and MCP during operation.
- Run one AI investigation on the actual running app and show the evidence, reasoning, and resulting decision/fix. The starter says an all-clear investigation after a release counts; do not break the app on purpose.
- The event's starter instructions require a public GitHub repository for Argo CD to read. Do not publish secrets, uploaded decks, or credentials.

### Elasticsearch

- Use as the app's searchable slide-content index, not just a decorative sidecar.
- Index slide title, extracted text, and speaker-approved explanation.
- Use the Vector Database project type and the managed `semantic_text` field.
- Index slide title, extracted text, and speaker-approved explanation in Elasticsearch; keep exact-text `content` alongside its semantic field.
- Demonstrate reciprocal-rank-fusion hybrid search so exact technical terms and natural-language questions can both retrieve the right slide.
- If the 14-day trial's inference setup is unavailable or time is too short, show only verified BM25 search and state that semantic search was not completed.

## Submission checklist

- Public repository link; ensure no secrets, personal decks, or attendee data are committed.
- Public or unlisted demo video under 3 minutes.
- Select only tracks whose tools were actually used; also select Merge Forward if appropriate.
- Answer each selected track's question with links/evidence; do not claim work that was not completed.
- Maintain explicit product limitation: automated review is not accessibility certification.
