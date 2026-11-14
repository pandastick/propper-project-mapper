# XPM (Xcali Project Mapper)

A visual node-graph explorer for mapping project architecture. See your screens, entities, relationships, user flows and **message pipelines** as an interactive graph, not a file tree. Formerly Propper Project Mapper (PPM).

**PPM maps what your project *does*, not how it's organized on disk.**

## What It Looks Like

PPM gives you 4 interactive views of your project architecture:

| View | What It Shows |
|------|--------------|
| **System** | High-level overview: sections > screens > entities in a hierarchy |
| **Screens** | All pages grouped by section, with routes and UI elements |
| **Data Model** | Entities and their relationships (ERD-style) |
| **Flows** | User journey step chains showing how screens connect |

- **Click** any node to see details in the side panel
- **Double-click** a screen to expand/collapse its UI elements
- **Search** to filter and dim non-matching nodes
- **Section filter** to focus on one area of a large project

Dark theme. Monospace font. Minimal UI. Just the graph.

## Privacy & Security

PPM runs **100% locally**. There are no external API calls, no analytics, no telemetry, no data collection of any kind. Your project data never leaves your machine.

Don't take our word for it - `server.js` is ~80 lines. The entire codebase is under 1,000 lines of vanilla JavaScript. You can audit the whole thing in 5 minutes. The only dependency is Express (to serve static files on localhost).

## Quick Start

```bash
git clone https://github.com/pandastick/xpm.git
cd xpm
npm install
```

### Set Your Port

Pick a port you'll remember and save it in a `.env` file so you always come back to the same URL:

```bash
echo "PORT=3333" > .env
```

Then start:

```bash
npm start
```

Open `http://localhost:3333` (or your chosen port) in your browser. You'll see two example projects to explore.

### SwiftBar Menu Bar Control (macOS)

If you use [SwiftBar](https://swiftbar.app), PPM includes a menu bar plugin for one-click start/stop/open:

1. Copy `extras/ppm-tool.5s.sh` to your SwiftBar plugins folder
2. Edit the `PROPPER_DIR` path inside the script to point to your installation
3. Make it executable: `chmod +x ppm-tool.5s.sh`

You get a menu bar item showing `P:3` (number of mapped projects) when running, or `P:off` when stopped. Click to start, stop, open in browser, or open the folder.

### Custom Manifests Directory

By default, PPM reads manifests from the local `manifests/` folder. If you want to store your manifests elsewhere - for example in a shared team folder, a Dropbox/iCloud directory, or a separate private repo - set `MANIFESTS_DIR` in your `.env`:

```bash
echo "PORT=3333" > .env
echo "MANIFESTS_DIR=/path/to/my/shared-manifests" >> .env
```

`MANIFESTS_DIR` may also list several folders separated by `:`, for example your own manifests plus a team folder. The first folder that has a project wins.

This is useful when:
- You want to **share manifests with your team** without sharing the PPM app itself
- PPM is nested inside a project but you want manifests in a central location
- You keep manifests in a **private repo** separate from the open-source tool

## How It Works

PPM reads **manifest files** from the `manifests/` folder (or your custom `MANIFESTS_DIR`). Each manifest defines your project's conceptual architecture: what screens exist, what data entities the system uses, how they relate, and what user flows connect them.

Drop a new `.json` file in the manifests directory and it appears in the dropdown. Click "Refresh" to reload from disk while the server runs.

## Pipelines: see how a message really moves (XPM 2)

A pipeline is the path a message takes through a product: which step receives it, what decides where it goes, which model answers, what sends the reply. XPM draws it like a workflow editor, then checks it three ways so you can trust it.

| Layer | What you get | Why you can trust it |
|---|---|---|
| **Map** | Every step as a node, every hand-off as an edge, conditions on the edges (`mode = planner`) | Each node points at a file and function. `xpm check` fails when one moves or disappears |
| **Runs** | Real executions laid over the map: traffic per edge, time per node, failures | Each step writes one event line. A step the map does not know shows up as a **ghost** |
| **Draft** | Add or rewire steps and replay recorded runs through the change | Recorded decisions replayed on the new graph, no product code runs. Exports a change spec |

### The Pipeline view

Open `http://localhost:3333/pipeline.html` (or the **Pipeline** button on a project that has pipelines). Three views, one segmented toggle:

- **Map:** the declared pipeline in lanes, with hits and median time over the last 50 runs. Tap a step for its file, function and code check.
- **Runs:** the last 50 runs, newest first, each with what was typed, when the channel received it and the run id. Pick one to light its path, step through it, and see ghost steps the map does not know. `?run=<id>` links straight to a run.
- **Draft:** a change drawn in dashed blue, replayed against the recorded runs, with the verdict, the runs that change route, and **Export spec**. A ghost step in Runs can become a draft in one tap.

A long pipeline does not become one strip: when the lanes side by side would be much wider than the window, they wrap into rows like words in a paragraph (short lanes share a row), and the lines between rows run in the gaps, never through a card. The **Overview** lens folds each lane into one card; open the lane you want to read. A map the engine refuses is shown as its list of problems, not as a half-drawn canvas.

Plain JavaScript, no build step, no new dependencies. Every control is a real button at least 44px tall, scrolling is native, and the page has no touch handlers (safe for Apple Pencil on iPad). On a phone the runs list stacks under the canvas and one picker holds project and pipeline.

### Try it

```bash
npm install
npm test                                   # engine and layout tests
npm run test:click                         # a headless browser taps through Map, Runs and Draft (needs Chromium, or CHROMIUM=/path)
node bin/xpm.js check manifests/example-bot.json --repos .xpm-repos.example.json
node bin/xpm.js runs manifests/example-bot.json --pipeline inbound --events examples/events/example-bot
node bin/xpm.js simulate manifests/example-bot.json --pipeline inbound \
  --events examples/events/example-bot --draft examples/drafts/example-bot-classifier-first.json
```

The example bot, its code and its events are synthetic.

### Pipeline schema (inside a project manifest)

```json
"pipelines": [{
  "id": "inbound", "name": "A message reaches the bot", "entry": "receive",
  "lanes": ["door", "brain", "after"],
  "nodes": [{ "id": "mode-gate", "name": "Which mode is on", "kind": "mode", "lane": "door",
              "decides": "mode", "values": ["normal", "planner"],
              "anchor": { "repo": "bot", "path": "src/modes.js", "symbol": "currentMode" } }],
  "edges": [{ "from": "mode-gate", "to": "planner-hold", "when": { "decision": "mode", "equals": "planner" } },
            { "from": "mode-gate", "to": "fast-path" }]
}]
```

- **Node kinds:** `door, hook, router, classifier, mode, model, tool, queue, store, gate, sender`.
- **Routing rule:** a node with `when` edges follows the ones that match; its plain edges are the else. A node with only plain edges follows all of them.
- **Values:** `decides` names what a node decides and `values` lists every label it can give. Values a link tests are known already; list the rest here, or Runs reads them as `other`.
- **Anchors:** `repo` names a root in `.xpm-repos.json` (git-ignored, `{ "bot": "~/code/bot" }`).

### Events (one JSON line per step)

```json
{"runId":"934cf907af95fcb7","ts":"2026-11-07T08:00:00.007Z","seq":3,"pipeline":"inbound","type":"decision","node":"dedupe","metadata":{"decision":{"duplicate":"no"},"durationMs":2}}
```

- Types: `run.started, node.started, node.completed, node.failed, decision, run.completed, run.failed`.
- `metadata` keeps only `decision, durationMs, status, errorCode, attempt, model, tokens, costUsd, sentAt`. Everything else is dropped on write and on read. **Never put message text or user ids in an event.**
- A `decision` is a label, not a sentence: each key and each text value is one token of up to 32 letters, digits or `_ . : / -`, with no spaces. Anything else is dropped. On read, a text value the map does not name (in a link's `when.equals`, in the node's `values`, or one of `yes, no, on, off, true, false, other`) is shown as `other`, so the run takes the else link. The writers take the same list up front: `createTracer({ ..., decisions: { mode: ["normal", "planner"] } })`.
- Use one tracer per pipeline per process: the step counter (`seq`) lives in the tracer.
- `sentAt` is when the channel received the message (Unix seconds), shown in local time in Runs.
- Drop-in writers with no dependencies: `writers/xpm-trace.js` (Node, TypeScript) and `writers/xpm_trace.py` (Python). `runIdFor(updateId, salt)` hashes the upstream id.
- Real events go in `events/<project>/YYYY-MM-DD.jsonl` (or `XPM_EVENTS_DIR`), drafts in `drafts/<project>/` (or `XPM_DRAFTS_DIR`). Both are git-ignored.

### Previews: what was typed (opt-in, kept apart)

Runs can show what the person typed, so a run is easy to find. That text never goes into the event stream:

- The writers keep it only when created with `previews: true`, in `events/<project>/previews/YYYY-MM-DD.jsonl`.
- Control characters are flattened and the text is cut to 120 characters.
- It is shown in the Runs list and strip only. It never enters a draft, a replay result or an exported spec.
- `node bin/xpm.js prune events/<project> --days 14` deletes old events and their previews together.
- A run without a preview shows `(no preview)`.

### Source profile: where the code really lives

XPM adapts to each product; it never asks a product to change how it deploys. Each project gets one entry in `.xpm-projects.json` (git-ignored, or `XPM_PROJECTS`) on the machine XPM runs on. The **Setup** screen shows the six settings with what is true on that machine right now, and the Map says **Not set up** until a project has one.

```json
{
  "example-bot": {
    "truth":  { "label": "Live files on example-host", "repo": "bot" },
    "mirror": { "label": "GitHub your-org/your-app main", "checkout": "bot-git", "ref": "origin/main", "paths": ["src"], "ignore": ["*.service", "deploy.sh"], "fetch": false },
    "runsOn": "example-host",
    "traces": { "writer": "the-owner", "previews": false, "neverPreview": ["private chats"] },
    "access": { "label": "The owner's Tailscale login only" },
    "mapOwner": "the-owner",
    "confirmed": { "by": "the-owner", "at": "2026-11-09", "note": "every anchor checked against the live files" }
  }
}
```

| Setting | Meaning |
|---|---|
| `truth.repo` | The repo name the map's anchors use, mapped to a folder in `.xpm-repos.json`. `xpm check` and the anchor status read this folder. |
| `mirror` | Optional. A git checkout (repo name or absolute path) and a ref to compare the truth with, file by file over `paths` (`prefix` when the mirror keeps them in a subfolder). XPM reports the drift; it never enforces it. `fetch: true` lets XPM run `git fetch` first. `ignore` lists files to leave out on both sides (`"*.service"` matches a file name anywhere, `"deploy/*.sh"` a path). Folders with `backup` in their name are always left out. |
| `runsOn` | The machine where the truth and the traces are readable. On any other machine Setup says so. |
| `traces` | Who writes them, whether previews of typed text are on, and what is never previewed. The events folder itself is `XPM_EVENTS_DIR/<project>`. Previews are shown only when `previews` is `true` here, whatever is on disk. |
| `access` | A label. The real gate is `XPM_ALLOWED_LOGINS` or `XPM_ALLOWED_NODES`. A project with no gate that is reachable from other devices is flagged in Setup, previews or not (unless `public: true`, for synthetic data). |
| `mapOwner`, `confirmed` | Who confirms the map against the truth, and when they last did. |

### Serving it on a tailnet

- `HOST` (default `127.0.0.1`): XPM listens on loopback only. Put `tailscale serve` (or another proxy) in front to reach it from other devices.
- `XPM_ALLOWED_HOSTS` (comma separated, for example `example-host.your-tailnet.ts.net`): on loopback XPM answers only to `localhost`, `127.0.0.1`, `[::1]` and the names listed here, so a web page cannot reach it by pointing its own name at your machine. **Behind a proxy, list the name the proxy serves it under, or every request gets 403.**
- `XPM_ALLOWED_LOGINS` (comma separated, for example `you@example.com`): behind `tailscale serve`, only these Tailscale logins get in; everyone else, and tagged devices (which send no login), get 403.
- `XPM_ALLOWED_NODES` and `XPM_DENIED_NODES` (comma separated device names, for example `my-laptop,my-phone`): one login can own many devices, and these let in or keep out single ones. XPM takes the caller's tailnet address from the last entry of `X-Forwarded-For` (set by `tailscale serve`) and asks `tailscale whois` which device it is. A denied device gets 403; with an allowed list, only listed devices get in. No address, or no answer from tailscale, also means 403. `XPM_TAILSCALE_BIN` names the binary when it is not on the path.
- XPM refuses to start with a login or device list unless `HOST` is loopback, because the proxy's headers could otherwise be forged. Set a gate before turning on previews.

### API

| Route | Returns |
|---|---|
| `GET /api/project/:id/pipeline/:pid` | map, code check, overlay, last 50 runs |
| `GET /api/project/:id/pipeline/:pid/drafts` | saved drafts |
| `POST /api/project/:id/pipeline/:pid/simulate` | what-if result and change spec for the draft in the body |

### Credits

Ideas, not code, from: [AgentFlow Visualization](https://github.com/Elyon0517/AgentFlow-Visualization) (MIT, event envelope and replay), [langgraph-replay](https://github.com/devendra116/agent-replay-engine) (MIT, replay modes), [Graph of Trace](https://github.com/NeuroAIHub/Graph-of-Trace) (MIT), [Statefold](https://github.com/ioteverythin/statefold) (Apache 2.0, invariants), and n8n's executions view.

## Setting Up Your Projects

### The AI-Powered Way (Recommended)

If you use an AI coding agent like **Claude Code**, **Cursor**, or **Windsurf**, just point it at the `agents.md` file in this repo. It contains detailed instructions for the AI to:

1. Scan your project(s) and understand the architecture
2. Ask you smart questions about what it finds
3. Auto-generate manifest files for each project

This is the fastest way to get set up. The AI does the tedious work of mapping routes, finding database schemas, and building the manifest JSON.

```
# In Claude Code, just say:
"Read agents.md and set up PPM for my projects"
```

### Manual Setup

Create a JSON file in `manifests/` following the schema below. See the example manifests for reference.

## Manifest Schema

Each manifest is a JSON file at `manifests/{project-id}.json`:

```json
{
  "id": "my-project",
  "name": "My Project",
  "description": "What this project is",
  "tech": "Next.js, Supabase, Tailwind",

  "sections": [
    { "id": "section-id", "name": "Section Name", "icon": "lucide-icon-name" }
  ],

  "screens": [
    {
      "id": "screen-id",
      "name": "Screen Name",
      "route": "/path/to/page",
      "section": "section-id",
      "description": "What this screen does",
      "status": "live",
      "access": "admin",
      "elements": [
        { "name": "Element Name", "type": "button", "notes": "What it does" }
      ]
    }
  ],

  "entities": [
    {
      "id": "entity-id",
      "name": "Entity Name",
      "description": "What this data represents",
      "fields": ["field_a", "field_b"],
      "screens": ["screen-id-1", "screen-id-2"]
    }
  ],

  "relationships": [
    { "from": "entity-a", "to": "entity-b", "label": "has many", "type": "one-to-many" }
  ],

  "flows": [
    {
      "id": "flow-id",
      "name": "Flow Name",
      "description": "What this journey represents",
      "steps": ["screen-id-1", "entity-id-1", "screen-id-2"]
    }
  ]
}
```

### Field Reference

**Sections** group screens into logical areas of your app (e.g., "Dashboard", "Settings", "Admin").

**Screens** are individual pages/views. Each has:
- `route` - The URL path
- `section` - Which section it belongs to
- `status` - `live`, `planned`, or `deprecated`
- `access` - Optional, e.g. `admin` (shown as a badge)
- `elements` - UI components on that screen

**Entities** are your data models. Link them to screens where they're displayed or modified.

**Relationships** connect entities: `one-to-many`, `many-to-many`, `one-to-one`, `many-to-one`.

**Flows** are user journeys - ordered lists of screen/entity IDs showing how a user moves through the system.

### Element Types

| Type | Color | Use For |
|------|-------|---------|
| `button` | Green | Clickable actions |
| `form` | Amber | Input forms |
| `table` | Blue | Data tables |
| `list` | Purple | Lists of items |
| `cards` | Orange | Card-based layouts |
| `chart` | Cyan | Visualizations |
| `dialog` | Red | Modal popups |
| `sheet` | Pink | Side panels |
| `panel` | Gray | Fixed panels |
| `section` | Dark gray | Content sections |
| `controls` | Light gray | Filter/sort/navigation |
| `tabs` | Light gray | Tab navigation |
| `input` | Green | Search/text inputs |
| `dropdown` | Purple | Select dropdowns |
| `tags` | Rose | Tag chips |
| `timeline` | Amber | Chronological logs |
| `kanban` | Indigo | Drag-drop boards |
| `display` | White | Read-only displays |
| `interaction` | Emerald | Gesture-based interactions |

## Multi-Project Setup

PPM works great as a central viewer for multiple projects. Just add one manifest per project to `manifests/`. Name them descriptively:

```
manifests/
  my-saas-app.json
  my-blog.json
  my-mobile-app.json
  internal-tools.json
```

For related sub-projects, use a naming convention:

```
manifests/
  acme--web-app.json
  acme--mobile-app.json
  acme--admin-panel.json
```

All projects appear in the dropdown selector, sorted alphabetically.

## Installation Locations

PPM can live anywhere. Two common patterns:

**Alongside your projects** (recommended for multi-project):
```
~/projects/
  xpm/    <-- here
  my-app/
  my-other-app/
```

**Inside a single project** (for dedicated use):
```
~/projects/my-app/
  tools/xpm/    <-- here
  src/
  package.json
```

## File Structure

```
xpm/
  server.js           Express server, serves manifests as API
  package.json        Dependencies (just express)
  agents.md           Instructions for AI agents to auto-setup
  .env                Port + optional MANIFESTS_DIR (created by you, git-ignored)
  manifests/          One JSON per project
    example-saas.json
    example-blog.json
  public/
    index.html        Shell with 4 view tabs
    app.js            Graph rendering, panels, interactions
    pipeline.html     Pipeline view: Map, Runs, Draft
    pipeline.js       The view (state, rendering, actions)
    pipeline-layout.js  Where every card and line goes (pure, tested in Node)
    style.css         Dark theme styling
  tests/              node --test; tests/click/ drives a real browser
  extras/
    ppm-tool.5s.sh    SwiftBar menu bar plugin (macOS)
```

## Contributing

PRs welcome. Keep it simple - this is intentionally a lightweight tool.

## License

MIT
