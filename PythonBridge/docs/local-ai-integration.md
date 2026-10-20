# Local AI API and database gateway

Implemented for the desktop validation deployment. Ollama runs Qwen3.5 4B locally; the model does not receive a database connection, credentials or executable tools.

## Temporary VM rollout pause

The AI launcher is intentionally disabled in this release via LOCAL_AI_LAUNCHER_DISABLED in webapp/src/feature-flags.ts. It remains visible with a disabled tooltip and makes no AI calls. Keep LOCAL_AI_ENABLED=0 on the VM. No Ollama installation is required for the normal application. Re-enable the launcher only after validation by changing the flag and rebuilding; API enablement remains a separate deployment decision.

## User workflow (when re-enabled)

Refresh the webapp and choose the round **AI assistant** chatbot icon at the bottom-right. The non-modal panel lets you continue using the workspace. Enter sends; Shift+Enter adds a line. Closing minimizes it, including while a reply is running.

There are no Task, Dataset or Search selectors. Ask naturally, as in a normal conversation:

- "How do I create a Product Mix?"
- "Show products for Aldi EU."
- "How many Opportunities are in processing now, and created by me? List the basic details."
- "What about closed ones?" (continues the previous filters).
- "Extract these requirements: Demo Retailer, almonds 150g, 1000 annual units, 20DC pallet loaded."

A constrained local-model plan chooses a read-only capability; the server validates it and enforces permissions. Ambiguous or unsupported requests receive a clarification/limitation instead of a guessed action. No business records are created or updated.

Database facts are displayed separately from the model-generated summary. AI answers may be wrong: verify them against the evidence and normal application screens. Lookups return at most ten detail rows. Opportunity header lookups also return an exact SQL count over all matching records, not a count inferred from the sample. Prefix matching includes related Customer names for Products and Opportunities. Pricing, request details, reminders and write actions are not supported by this first integration.

Completed question/reply pairs are stored privately in SQL under the authenticated user ID. Use Chat history to reopen a conversation, New chat to start another, and the trash icon to permanently delete your own conversation. Chat text is not written to browser storage. The server logs metadata, not prompts/responses. Deleting chat removes application rows, not database backups or transient model memory.

## API

- GET /api/ai/status: model readiness and permission-filtered datasets.
- POST /api/ai/preview: legacy one-shot preview, no history.
- GET /api/ai/conversations: own conversation IDs only.
- GET /api/ai/conversations/{uuid}: own turns, permission-redacted.
- POST /api/ai/chat/preview: message plus conversation_id and request_id UUIDs only; mode/source/search and caller identity are rejected. Routing is server-owned. Saves the completed pair, not business records. Repeating the same request ID/payload returns the saved reply without another generation; reusing it for different input returns 409.
- DELETE /api/ai/conversations/{uuid}: delete only your own chat, including for Admin users.

Chat endpoints are available to display-only business users and protected by existing identity/page checks. Caller-supplied history, identities, tools or system messages are not accepted.

Legacy one-shot /api/ai/preview example (not used by the conversational UI):

```json
{"mode":"lookup","source":"products","search":"Aldi","message":"Explain which returned Products are ready for an Opportunity."}
```

The legacy /preview endpoint retains internal modes help, lookup and extract. Lookup requires a source. Search is an optional literal prefix, at most 80 characters. Message limit is 4000 characters; an additional total UTF-8 prompt budget prevents oversized contexts. Caller-supplied SQL, model names, URLs, tools, identity and arbitrary fields are rejected.

Results identify the model, mark read_only=true, and contain answer, citations, evidence, truncated and extracted. Missing extraction values are null, not guessed defaults. Extracted fields are not validated as existing master records and must not be applied without the normal master/workflow validation.

## Security and limits

- Existing Windows/proxy identity, active-user scopes and workspace page permissions are enforced before data access. Source access is checked again inside the gateway. Fixed SQL reads recheck the live user's scope.
- Read projections include only selected business fields: no passwords, connection settings, attachments, row-version tokens or commercial pricing fields.
- SQL identifiers are fixed in server code; search terms are bound parameters with literal wildcard escaping. The model cannot select SQL or execute anything.
- One generation at a time across API workers, coordinated by a SQL session application lock. Busy requests receive 429 and Retry-After: 5 rather than occupying an unbounded model queue.
- The lock is released on success/error. It creates no schema objects or business records.
- The local HTTP client uses only 127.0.0.1:11434. It does not follow redirects, use an external proxy, accept another endpoint, or fall back to a cloud model.
- Responses have byte limits, timeouts and Pydantic validation. Invented citation IDs, incomplete outputs and invalid extracted fields fail closed.
- User text and database strings are treated as untrusted prompt data. This is not a guarantee against misleading model output; the hard security boundary is the absence of write/execution tools and the server-controlled retrieval.
- Existing application database credentials are reused. This is a read-only gateway, not a newly provisioned SQL read-only login. Review database-account least privilege before production.
- Audit metadata contains user ID, mode, dataset, row count, outcome and duration. Configure application logging/retention appropriately. No prompts or retrieved rows are intentionally logged.

Runtime inference uses a bounded 8192-token context and up to 900 generated tokens. This overrides the desktop runtime's default context for gateway requests only. There is no claim that the desktop can serve 100 simultaneous AI generations.

## Deployment

LOCAL_AI_ENABLED=1 enables the gateway. It defaults on in development/test and off when APP_ENV=production. The example environment keeps it off. Enable it in a production service only after installing the approved local model/runtime and testing permissions and load.

The installed desktop Ollama is configured with OLLAMA_NO_CLOUD=1 and a loopback listener. Preserve those settings. Model tag is fixed to qwen3.5:4b in this initial gateway. A separate AI VM or remote model gateway requires a separately reviewed deployment change; a remote URL is deliberately not configurable here.

The local API has been started on 127.0.0.1:8000 with four workers. Ollama remains on 127.0.0.1:11434. Startup logs are logs/local-ai-api.stdout.log and logs/local-ai-api.stderr.log. Apply sql/122_local_ai_chat.sql before deploying the chat UI/API. This adds only a private chat table/index and does not modify business records.

## Verification

Focused unit/HTTP tests cover scope/page denials, display-only previews, request allowlists, bound search terms, evidence limits, extraction, context limits, timeout sanitization, unsupported citations, lock contention and lock release. Browser checks cover evidence rendering as text, extraction drafts, busy retries and unavailable model handling.

Local live checks exercised authenticated HTTP -> authorized SQL -> Qwen summaries, synthetic requirement extraction and cross-session application-lock contention. These checks do not certify general model accuracy or production load capacity.


## Conversation context and model improvement

History improves follow-up understanding, not model weights or guaranteed factual accuracy. At most the six latest permitted turns are considered, trimmed further to the existing 6500-byte prompt budget. Lookup always refreshes current evidence; old answers are explicitly historical/untrusted. Literal extraction uses only the latest requirement text to avoid mixing old requirements into a new extraction.

Lookup-source dependencies propagate into follow-up answers. Removing access to any dependent dataset redacts the whole affected turn on retrieval and excludes it from model context. Access is owner-bound even for administrators. AI responses carry no-store/private cache headers. Chat history is business data: apply normal database/service-account and backup protections; this feature does not add database encryption.

Limits: 20 conversations per user, 100 completed turns per conversation. Old conversations must be manually deleted when the quota is reached; no automatic retention or background scheduler is configured. There is one generation across workers, with busy responses rather than an unbounded queue. A failed generation creates no partial saved turn. The same generation lock serializes deletion and saves.

No automatic retraining or cross-user memory is enabled. Raw chats can contain confidential facts, incorrect answers and prompt injection. For future fine-tuning, first obtain explicit approval/consent, curate corrected examples, redact business/personal data, preserve permission boundaries, and evaluate against a held-out regression set before deploying a separate adapter. Current database facts should continue to come from authorized live retrieval, not memorized model weights.


## Natural chat routing and opportunity counts

The model produces a schema-validated plan, not SQL. All routing schema fields are required in model output to avoid omitted filters on the 4B model. The server exposes only four fixed read projections and a fixed Opportunity count/list query. It never accepts model-selected SQL, tools, user IDs or business writes.

Opportunity predicates support header stage (Draft, In progress, Closed, Canceled), created by the signed-in user, and a literal name/code prefix. "Processing" means header stage In progress; this interpretation is included in the answer. "Me" is bound from authenticated AccessContext.user_id, never a model/caller-selected identity. SQL rechecks active identity and Opportunity scope. COUNT_BIG(*) OVER() computes the exact count and a TOP(10) detail list in one statement. The answer/count is server-composed, not model arithmetic.

Dates, other creators, Opportunity item-stage filters, other datasets' exact counts, detailed Packaging response/PIC queries and write actions are not supported. The router asks/explains the limitation; hard guards prevent returning a partial prefix lookup as a non-Opportunity count or silently dropping common date filters. History includes the previous validated intent for contextual follow-ups, with the existing source-permission redaction rules.

Help, prefix lookup summaries and explicit requirement extraction generally use one extra bounded local planning inference before the answer inference. Opportunity count/list uses planning plus fixed SQL and a deterministic answer. The existing one-generation-at-a-time cross-worker lock covers the whole turn, including planning, to prevent a new unbounded queue. No new SQL migration is needed for natural chat routing. Existing stored chats remain readable; new turns store their validated intent inside the result JSON.


## Related Opportunity item counts and record references

The assistant now supports top-level item/request-presence counts. A follow-up such as "How many items in these opportunities already have a Packaging Request?" resolves "these" from server-produced evidence in the latest relevant Opportunity list. No caller/model-supplied record IDs are accepted. Legacy saved Opportunity lists can supply their evidence IDs too. An intervening lookup of another dataset does not silently reuse an older Opportunity list; a missing referent asks for a list first.

A displayed list contains at most ten Opportunity rows. "These/listed opportunities" refers only to those displayed IDs, not undisplayed matches. A fresh matching-scope item question can aggregate all headers matching the supported mine/stage/prefix predicates. Current business data is read again and a UTC checked-at timestamp is returned.

Counts use the existing Opportunity view's top-level convention (ParentItemID IS NULL), not Mix child rows. Each item is counted once using request-existence checks, even with multiple historical requests:

- TotalItems: top-level Opportunity items.
- LinkedItems: items ever linked to any Packaging Request, including completed/canceled requests.
- OpenRequestItems: items with at least one request item where IsOpen=1.
- UnrequestedItems: items never linked to any request.

The presence counts expose no response/pricing content or PIC details. They use Opportunity scope/page checks and a fresh active-identity/scope check in SQL, matching the request-link visibility already present in the Opportunity view. SQL parameters bind the authenticated creator ID, filters and server-selected IDs. No arbitrary SQL or write tools are exposed.

## When an answer is incorrect

1. Expand Database evidence and check the database-checked timestamp. Compare the exact record references and filter definitions with the normal application screen.
2. If the request was ambiguous, clarify it in chat, for example: "For the opportunities just listed, count top-level items with currently open Packaging Requests; exclude Mix children." Ask again to refresh changed source data.
3. Use **Report incorrect answer** below the reply. Supply the expected result, record reference, definition/filter difference and source evidence; do not include passwords or secrets. Save the report.
4. Share the report reference and relevant screenshot/text through the usual support channel to request manual review. Saving a report does not send a notification or schedule a review. There is no cross-user Admin review UI in this change.
5. Correct the actual cause: inaccurate source data through the authorized master/transaction editor; wrong counts/joins/visibility through the server query plus a regression test; incorrect guidance through the workflow reference/prompt plus example tests. Fine-tuning is not the first remedy for a missing query or stale data.

Reports are owner-bound even for Admin users. Feedback is not replayed as model context, treated as a verified fact, or automatically used for training. The original answer is preserved; a report does not overwrite it or alter business records. Existing source permissions are checked when reporting/reopening a reply. Deleting the conversation deletes its report rows with it, but does not erase backups.

Apply **sql/123_local_ai_feedback.sql after 122** before deploying this version. The local test database was backed up with COPY_ONLY/CHECKSUM and RESTORE VERIFYONLY before application. This migration adds only nullable feedback fields and a bounded-text constraint to the private chat table.

Verification includes a rollback-only SQL fixture with duplicate requests, canceled/closed requests, Mix children, out-of-selection records and zero/empty selections; independent live counts; private feedback ownership/source checks; history restoration; and browser regression coverage. It does not certify arbitrary natural-language questions or eliminate model mistakes.
