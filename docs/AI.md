# Optional AI Planning, Contextual Helpers & MCP

Lifedash provides an optional, privacy-preserving AI suite built strictly on local-first principles. AI is off until a user opens an AI action and approves a request. All suggestions are subject to human-in-the-loop review before any data changes.

## 1. Master AI Toggle & Settings

AI features can be configured and completely disabled from **Settings → Connection & display → AI features**:
- **Master Switch:** Users can toggle AI features on or off for the current device at any time.
- **Complete Deactivation:** When turned off:
  - "Plan with AI" is removed from the sidebar and navigation.
  - All contextual AI buttons ("Suggest subtasks" in Task Detail, "AI Plan" in Day Planner, "Extract tasks with AI" in Notes, and "Draft with AI" in Weekly Review) are completely hidden.
  - All background or dialog AI execution is halted with zero network activity.
  - The AI settings dialog dims model fields and displays a clear explanation banner.
- **Live Reactivity:** Toggling AI on or off takes effect immediately across all views on the device without requiring a page reload.

## 2. Plan with AI (Assistant Dialog)

Open **Plan with AI** from the sidebar (or mobile navigation / command palette).

### Modes
- **On-device:** Fast rule-based task ranking by due date and priority. 100% offline, zero network requests, no model required.
- **Model provider:** Connect to local or cloud OpenAI-compatible endpoints with streaming advice and interactive proposal reviews.

### Supported Providers & Presets (Configured in Settings)
Provider connections, presets, API keys, and streaming options are managed exclusively in **Settings → Connection & display → AI features**.
- **Ollama (Local):** `http://localhost:11434/v1` (e.g. `llama3.2`, `mistral`)
- **LM Studio (Local):** `http://localhost:1234/v1` (local model server)
- **OpenRouter (Cloud):** `https://openrouter.ai/api/v1`
- **OpenAI (Cloud):** `https://api.openai.com/v1`
- **Custom Provider:** Any OpenAI-compatible `/chat/completions` endpoint

### Security & Privacy
- **Settings Persistence:** Base URL and Model ID are persisted locally in `localStorage`. API keys remain in memory only by default, with an optional "Remember API key on this device" checkbox.
- **Transparent Review Gate:** Every request presents the exact destination, model, prompt, and formatted context before the user approves and sends.
- **Multi-Entity Context:** Optionally include active tasks, goals, habits, pinned notes, and today's schedule into the bounded context (up to 24,000 characters).
- **Streaming & Markdown:** Streaming token responses with clean, safe typography (headings, bullet lists, bold text, code blocks).
- **Interactive Review & Apply:** When the model outputs structured proposals (subtasks, schedule time-blocks, or new tasks), interactive proposal cards display checkboxes for each item. Nothing changes until the user clicks "Apply".

---

## 3. In-Context View Helpers

Lifedash embeds focused AI helpers directly into primary workflows:
1. **Task Detail — Subtask Breakdown:** Click "Suggest" in the Subtasks card to break complex tasks into 3–5 actionable subtasks with one-click creation.
2. **Day Planner — AI Day Plan:** Click "AI Plan" in the Planner capacity bar to propose time-blocking slots for unscheduled tasks around existing commitments.
3. **Notes View — Action Items Extractor:** Click the sparkle icon in the note header to extract explicit and implied action items into linked tasks.
4. **Weekly Review — Reflection Companion:** Click "Draft with AI" in step 4 of the guided weekly review to draft grounded reflections and next week's focus based on past-week completion and habit data.

---

## 4. Model Context Protocol (MCP)

Lifedash provides two MCP servers:

### A. Read-Only Snapshot MCP (`mcp/server.mjs`)
Reads an explicitly selected version 2 Lifedash JSON export into an immutable, safe projection.

```sh
cd mcp
npm ci
node server.mjs --snapshot /path/to/lifedash-export.json
```

**Registered Tools:**
- `search_tasks`: search task titles, due dates, priority, and status.
- `list_projects`: list project hierarchy, colors, active and done task counts.
- `get_habits`: inspect active habits, schedules, and recent completions.
- `get_goals`: inspect goals, target dates, and progress.
- `search_notes`: search note titles and text excerpts.
- `get_day_schedule`: get tasks and timeline blocks for a specific date (YYYY-MM-DD).

### B. Live Agent API MCP (`mcp/agent-server.mjs`)
Connects to a running Lifedash self-hosted server using a revocable Agent API token created in **Settings → Agent API keys**.

```sh
export LIFEDASH_SERVER_URL="http://localhost:8787"
export LIFEDASH_AGENT_TOKEN="your_agent_token"
node mcp/agent-server.mjs
```

**Registered Live Tools:**
- `search_tasks`: search live tasks.
- `create_task`: create tasks with invariants and cycle checks.
- `update_task`: update status, due dates, priority, titles.
- `list_projects`: retrieve active projects.
- `list_habits`: retrieve habits and recent logs.
- `list_goals`: retrieve long-horizon goals.
- `search_notes`: query rich notes.
