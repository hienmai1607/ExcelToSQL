# Local offline assistant proposal

Historical proposal. The desktop runtime and initial read-only API/database gateway are now installed; see [local AI integration](local-ai-integration.md) for the implemented scope. No autonomous write permissions have been granted.

## Starting point

Trial Ollama with `qwen3.5:4b` locally. The official catalog lists a roughly 4 GB model package, including vision support. This is download size, not a total runtime RAM/VRAM requirement. The inspected desktop has 16 GB RAM, Intel i5-13400F and an RTX 4070 SUPER with 12 GB VRAM. That makes a short-context, single-user 4B-model trial reasonable, but actual latency, memory, extraction accuracy and simultaneous SQL/API load must be measured. Do not assume the VM has this GPU; a VM needs an independently sized CPU/GPU allocation.

Download the runtime/model once while connected, then run the local model offline. Disable cloud features with `OLLAMA_NO_CLOUD=1`, restart Ollama, retain its default loopback bind, and restrict network access. No cloud model fallback. Pin and record the approved model/runtime versions.

## Integration within PythonBridge

Use a side panel, initially read-only, calling the Python API. The API authorizes every request using the current user, then provides only the relevant records and documentation.

- Requirements: extract draft fields from supplied text into a validated JSON schema, highlight missing/ambiguous values, and show the original evidence next to every proposed field.
- Lookups: choose from allowlisted, parameterized existing reads. Enforce permissions, record scope, result limits and timeouts server-side. Return record IDs and descriptions as evidence.
- Help: retrieve current local workflow documentation and explain the next screen/action. Model weights alone do not know the application's workflow.
- Reminders: persist due dates and run deterministic application/OS scheduling. The model may summarize or help draft a reminder but is not the scheduler. Offline reminders only fire when the scheduler host is running.

The model must not execute generated SQL, bypass permission checks, save or delete records, change workflow stages, send messages, or calculate authoritative prices/weights/loading totals. Existing SQL/Python calculations remain authoritative. Any later write capability requires a user-reviewed preview and the normal authenticated/version-checked API.

Treat uploaded requirements and retrieved business text as untrusted data, not tool instructions. Validate output with Pydantic, restrict tools/paths, avoid secrets in prompts/logs, minimize retained conversation data, and audit retrievals. Schema-conforming output can still be wrong; missing evidence should produce an unknown value, not a guessed fact.

## Delivery order and validation

1. Read-only help and scoped data lookup.
2. Requirement extraction into an editable, explicitly confirmed draft.
3. Persisted reminders driven by the application's scheduler.

Benchmark representative English/Vietnamese requirements, difficult units, incomplete source text, conflicting customer names, unauthorized lookups and prompt-injection examples before release. Measure CPU/GPU memory, latency and SQL/API responsiveness under realistic concurrency. Start with one inference at a time and a bounded context/output size. This proposal does not claim these tasks have already been validated on the model.

## Primary sources

- [Qwen3.5 4B model catalog](https://ollama.com/library/qwen3.5:4b)
- [Ollama local-only mode and networking](https://docs.ollama.com/faq)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
