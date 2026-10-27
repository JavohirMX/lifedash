# Optional AI planning and read-only MCP

Initial slice, not autonomous task execution. AI is off until a user opens the planner and approves an exact request. There are no background inference calls, provider retries, automatic task writes, remote MCP endpoints or model installation steps.

## Plan with AI

Open **Plan with AI** in the sidebar (mobile: More). It starts in
**On-device** mode: select tasks and choose **Summarize selected tasks on this
device** for rule-based ranking by due date and priority. This is not model
inference, supports no free-text request, and sends nothing over the network.
Suggestions do not change tasks.

For model advice, select **Model provider**. Enter an OpenAI-compatible API
base URL and the exact model ID you have installed or selected:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`
- Cloud provider: its HTTPS OpenAI-compatible base URL

The app does not fetch model lists or test credentials automatically. A provider must support browser requests from the app's actual origin (CORS). HTTPS-hosted apps may face browser restrictions when reaching localhost. Configure narrowly scoped allowed origins according to the provider's docs; do not expose an unauthenticated model server to the network. There is no unsafe CORS proxy or server-side key storage fallback.

In Model provider mode, choose tasks, write your request and click **Review request**. Nothing is selected by default. Context contains only selected task titles, due dates, priority and status. No task notes, journal, attachments, sync credentials or full database are read by the AI module. The user-written request can itself contain private information, so review it too. The page shows the actual destination, model, prompt and context before the approval checkbox and Send button.

Approval is consumed by each send. Changing settings, request or selected task data invalidates the review. API keys stay in component memory only and disappear on close. No provider credentials are stored in localStorage, IndexedDB or sync. Provider responses are plain text and have no action execution path. Cookies are omitted; redirects fail rather than forwarding the request. Requests time out after 60 seconds and can be aborted. Aborting only stops waiting locally and may not cancel provider processing or billing.

A localhost URL is not proof of local inference: Ollama can forward cloud models. Confirm the model's actual execution location. Cloud providers can charge and retain prompts under their policies. Permission to develop this feature did not approve any paid calls or private-data disclosure during development.

## Local read-only MCP

MCP is a separate Node 20+ process under `mcp/`; no dependency or route is added to the sync server. It reads one explicitly chosen **version 2 LifeDash JSON export**, at startup, into an immutable narrow projection. It never reads browser IndexedDB or the live sync database. It is a stale snapshot, not live access. To refresh, export again and restart.

```sh
cd mcp
npm ci
node server.mjs --snapshot /absolute/path/to/chosen-export.json
```

Example host configuration (replace both absolute paths):

```json
{
  "mcpServers": {
    "lifedash": {
      "command": "node",
      "args": ["/absolute/path/lifedash/mcp/server.mjs", "--snapshot", "/absolute/path/chosen-export.json"]
    }
  }
}
```

The only tool is `search_tasks`: title search, status filter and limit 1-50. It returns task ID/title/status/due date/priority and export timestamp. No note bodies, projects, journal, attachments, secrets, filesystem path arguments, writes, shell commands, URLs or network requests are exposed. Unknown arguments are rejected by a strict schema. The file must be a regular JSON file below 10 MB. Invalid files fail closed without logging contents. The MCP SDK is pinned and transitive dependencies are locked.

**Privacy:** connecting this server to an external AI host permits that host to read this task projection. Configure approvals in the host and do not attach it to a cloud model unless you accept sharing those fields. Read-only does not mean non-sensitive. Stdio avoids a listening network endpoint, but it does not sandbox the process. Run with a minimal environment and a read-only mount containing only the chosen export if isolation is needed. This process reads only that file by implementation; OS sandboxing is the operator's responsibility.

## Verification and limits

- Provider unit tests: URL/credential transport, request limits, approval gate, changed settings, mocked output/errors, no retries.
- UI: real local Chrome desktop/mobile with synthetic tasks and intercepted model response, request review/consent/reset/close and Escape checks.
- MCP: real stdio client/server initialize, list, read tool call, strict arguments and nonexistent write tool rejection; projection/immutability tests.
- **Not verified:** actual Ollama or LM Studio inference, cloud inference/billing, deployed-origin CORS, native shells, a third-party MCP host, action approvals/write execution. No live model was called.

## Sources checked October 20, 2026

- Ollama API compatibility: https://docs.ollama.com/api/openai-compatibility
- LM Studio compatibility: https://lmstudio.ai/docs/developer/openai-compat
- OpenAI MCP safety: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- MCP SDK (version matched against installed 1.32.1 exports): https://github.com/modelcontextprotocol/TypeScript-sdk/blob/main/docs/server.md
- MCP local-server security: https://modelcontextprotocol.io/docs/draft/tutorials/security/local-server-security
- OWASP MCP security guidance: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html

Upstream SDK main docs currently describe a newer package split; this implementation uses the tested, pinned v1 package's exported imports, not the incompatible main-branch examples.
