# Propper Project Mapper (PPM)

A visual node-graph explorer for mapping project architecture. See your screens, entities, relationships, and user flows as an interactive graph - not a file tree.

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
git clone https://github.com/pandastick/propper-project-mapper.git
cd propper-project-mapper
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

This is useful when:
- You want to **share manifests with your team** without sharing the PPM app itself
- PPM is nested inside a project but you want manifests in a central location
- You keep manifests in a **private repo** separate from the open-source tool

## How It Works

PPM reads **manifest files** from the `manifests/` folder (or your custom `MANIFESTS_DIR`). Each manifest defines your project's conceptual architecture: what screens exist, what data entities the system uses, how they relate, and what user flows connect them.

Drop a new `.json` file in the manifests directory and it appears in the dropdown. Click "Refresh" to reload from disk while the server runs.

## Setting Up Your Projects

### The AI-Powered Way (Recommended)

If you use an AI coding agent like **Claude Code**, **Cursor**, or **Windsurf**, just point it at the `agent.md` file in this repo. It contains detailed instructions for the AI to:

1. Scan your project(s) and understand the architecture
2. Ask you smart questions about what it finds
3. Auto-generate manifest files for each project

This is the fastest way to get set up. The AI does the tedious work of mapping routes, finding database schemas, and building the manifest JSON.

```
# In Claude Code, just say:
"Read agent.md and set up PPM for my projects"
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
  propper-project-mapper/    <-- here
  my-app/
  my-other-app/
```

**Inside a single project** (for dedicated use):
```
~/projects/my-app/
  tools/propper-project-mapper/    <-- here
  src/
  package.json
```

## File Structure

```
propper-project-mapper/
  server.js           Express server, serves manifests as API
  package.json        Dependencies (just express)
  agent.md            Instructions for AI agents to auto-setup
  .env                Port + optional MANIFESTS_DIR (created by you, git-ignored)
  manifests/          One JSON per project
    example-saas.json
    example-blog.json
  public/
    index.html        Shell with 4 view tabs
    app.js            Graph rendering, panels, interactions
    style.css         Dark theme styling
  extras/
    ppm-tool.5s.sh    SwiftBar menu bar plugin (macOS)
```

## Contributing

PRs welcome. Keep it simple - this is intentionally a lightweight tool.

## License

MIT
