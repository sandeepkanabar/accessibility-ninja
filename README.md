# Accessibility Ninja

Speaker-reviewed slide reading companions for blind and low-vision conference attendees.

## Problem and bounded MVP

Conference slides often communicate their meaning through diagrams, image layout, and sequence. A screen reader may encounter a linear object order that does not preserve the intended relationships. Accessibility Ninja extracts slide text and object order from a `.pptx`, flags missing image descriptions and review items, lets a speaker approve a short explanation, and offers a downloadable HTML reading companion plus hybrid search.

The prototype does **not** rewrite PPTX files, determine the correct reading order, author trusted visual descriptions automatically, or certify accessibility. Speaker review and assistive-technology testing remain necessary.

## Run locally

Requires Node.js 20+ and `unzip`.

```sh
cp .env.example .env
# Fill ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY in .env; never commit or paste the key.
cd app
npm install
npm start
```

Open http://localhost:8080. Without `ELASTICSEARCH_URL`, a clearly identified local in-memory fallback supports simple keyword matching only. For the real Elasticsearch workflow, choose the Vector Database project type in Elastic Cloud Serverless. Copy the project endpoint into `ELASTICSEARCH_URL`, create an Elasticsearch API key, and put it in `ELASTICSEARCH_API_KEY` in the ignored `.env` file. Slide text and speaker-approved explanations are indexed in `accessibility-ninja-slides`, copied into a `semantic_text` field for managed inference, and searched using reciprocal-rank fusion over BM25 keyword and semantic retrieval. This can find an explanation when an attendee phrases a question differently from the slide, while exact technical terms still match lexically. For a Radar deployment, add the endpoint and key to a Kubernetes Secret and inject them as environment variables; never place the key in GitHub, the container image, or chat. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` from the team's Dash0 organization, then run `npm run start:dash0`. HTTP traces, request counters, and privacy-safe operational logs are exported. Telemetry attributes intentionally exclude slide content and search-query text.

## Sponsor integrations — evidence required before claiming

- **Elasticsearch:** intended primary index with BM25 plus `semantic_text` vectors and reciprocal-rank-fusion hybrid search over deck/slide text and approved explanations. This requires the Serverless Vector Database project and a working EIS inference endpoint.
- **Gitar (Sonar):** `.gitar/review/accessibility.md` defines project-aware review rules. Use Gitar review on feature PRs; record actual PR links and any CI fix in the submission.
- **Dash0:** the scaffold contains OpenTelemetry auto-instrumentation hooks, request counters, and privacy-safe OTLP operational logs. Configure the team's endpoint/token and demonstrate Agent0/MCP diagnosing a real app issue before claiming this integration.
- **Radar:** use the organizer-provided `skyhook-io/cnh-starter` template, retain its Actions/Argo CD manifests, configure team name `accessibility-ninja`, and replace its `app/` contents with this app. Deploy and investigate through Radar UI/MCP before claiming this integration. Do not use another account's cluster.

These integrations are goals, not completed claims. See `HACKATHON_PLAN.md` for the day-of checklist and stop conditions.

## Accessibility feedback

Stéphane Este-Gracias' guidance informed the focus on titles, reading sequence, image descriptions, contrast, and legible type. He has not tested or endorsed this prototype. Automated findings are review prompts and may be incomplete or wrong.
