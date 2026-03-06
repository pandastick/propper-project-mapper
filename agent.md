# PPM (Propper Project Mapper) - Agent Setup Guide

You are setting up **PPM (Propper Project Mapper)**, a visual node-graph explorer that maps project architecture. Your job is to scan the user's project(s), understand their structure, and generate manifest JSON files that power the visualization.

**PPM maps screens, entities, relationships, and user flows - NOT file/folder structure.**

---

## Step 1: Detect Installation Context

First, determine how PPM is installed by looking at the surrounding directory structure.

### Option A: Multi-Project Directory
PPM sits alongside multiple project folders:
```
~/projects/
  propper-project-mapper/    <-- you are here
  project-a/
  project-b/
  project-c/
```

If this is the case:
1. List all sibling directories (excluding `propper-project-mapper`, `node_modules`, hidden folders)
2. Present them to the user: *"I found these projects next to PPM: [list]. Which ones should I map?"*
3. Let the user pick all, some, or specify others

### Option B: Inside a Single Project
PPM is nested within one project:
```
~/projects/my-app/
  tools/propper-project-mapper/    <-- you are here
  src/
  package.json
```

If this is the case:
1. Tell the user: *"PPM is installed inside a single project. I'll map this project."*
2. Use the parent directory as the project root

### Option C: Standalone / Unclear
If you can't determine the context:
1. Ask the user: *"Where are the projects you want to map? Give me the path(s)."*

### Port & Manifests Setup

Before scanning projects, check if a `.env` file exists in the PPM directory. If not, configure it:

**1. Port**

Ask the user to pick a port:

*"What port should PPM run on? Pick something you'll remember so you can always bookmark it. Common choices: 3333, 4444, 5555, 8080."*

**2. Manifests location**

By default, manifests live in PPM's local `manifests/` folder. But the user might want them elsewhere. Ask:

*"Where should I store your project manifests? Options:"*
- **Default (`manifests/` inside PPM)** - simplest, everything in one place
- **A shared folder** - useful if you want teammates to access manifests, or if you sync via Dropbox/iCloud/Google Drive
- **A separate private repo** - good if PPM is public but your project data is private

If they choose an external location:
- Verify the directory exists (create it if needed)
- Set `MANIFESTS_DIR` in `.env` to the absolute path

Create the `.env` file:
```
PORT=<chosen-port>
MANIFESTS_DIR=<path-to-manifests>   # only if external, omit for default
```

This ensures they always come back to the same URL and manifests location.

---

## Step 2: Scan Each Project

For each project to map, gather this information by reading the codebase:

### 2a. Project Basics
- **Name**: Use the folder name or `package.json` name, cleaned up
- **Description**: Read README or package.json description
- **Tech stack**: Check `package.json` dependencies, config files (next.config, vite.config, etc.)

### 2b. Sections (Logical Areas)
Look for natural groupings. Common patterns:
- **Route folders**: `/app/(dashboard)/`, `/app/(auth)/`, `/app/(admin)/`
- **Feature folders**: `src/features/billing/`, `src/features/settings/`
- **Navigation structure**: Sidebar items, tab groups, route layouts
- **README or docs**: Often describe the app's main areas

Create 2-8 sections. If a project is small, 1-2 sections is fine.

### 2c. Screens (Pages/Views)
Look for:
- **Route files**: `app/page.tsx`, `pages/*.vue`, `routes/*.svelte`
- **Named routes in router config**: `router.ts`, `routes.ts`
- **Navigation components**: Sidebar links, breadcrumbs

For each screen, capture:
- `id`: kebab-case identifier (e.g., `user-settings`)
- `name`: Human-readable (e.g., `User Settings`)
- `route`: URL path (e.g., `/settings/user`)
- `section`: Which section it belongs to
- `description`: One sentence about what this screen does
- `status`: `live` (default), `planned`, or `deprecated`
- `access`: Optional - `admin`, `authenticated`, etc.
- `elements`: UI components visible on this screen (see below)

### 2d. UI Elements (Per Screen)
Scan each screen's component code for visible UI elements. Map them to these types:

| Type | Look For |
|------|----------|
| `button` | `<Button>`, `<button>`, click handlers, CTAs |
| `form` | `<form>`, `<Form>`, input groups, submit handlers |
| `table` | `<Table>`, `<DataTable>`, `<table>`, grid displays |
| `list` | `<List>`, `<ul>` with mapped items, feed displays |
| `cards` | `<Card>`, grid of card components, tile layouts |
| `chart` | Chart libraries (recharts, chart.js), `<Chart>`, `<Graph>` |
| `dialog` | `<Dialog>`, `<Modal>`, `<AlertDialog>`, popups |
| `sheet` | `<Sheet>`, `<Drawer>`, slide-out panels |
| `panel` | Fixed side panels, detail panels |
| `section` | Content sections, hero sections, feature blocks |
| `controls` | Filter bars, sort dropdowns, pagination, toolbar |
| `tabs` | `<Tabs>`, `<TabList>`, tab navigation |
| `input` | Search bars, text inputs, standalone inputs |
| `dropdown` | `<Select>`, `<Dropdown>`, `<Combobox>` |
| `tags` | Tag chips, badge groups, multi-select tags |
| `timeline` | Activity feeds, chronological event lists |
| `kanban` | Drag-and-drop boards, column-based layouts |
| `display` | Read-only counters, status displays, badges |
| `interaction` | Drag-drop, gesture-based, sortable areas |

Don't be exhaustive - capture the **notable** UI elements, not every `<div>`. Aim for 3-8 elements per screen.

### 2e. Entities (Data Models)
Look for:
- **Database schemas**: Prisma `schema.prisma`, SQL migrations, Supabase types
- **API types**: TypeScript interfaces, GraphQL schemas, OpenAPI specs
- **Model files**: `models/`, `entities/`, `types/`
- **State management**: Redux slices, Zustand stores, Pinia stores

For each entity:
- `id`: kebab-case (e.g., `user-profile`)
- `name`: Human-readable (e.g., `User Profile`)
- `description`: What this data represents
- `fields`: Array of field names (the important ones, not every column)
- `screens`: Which screen IDs display or modify this entity

### 2f. Relationships
Based on the schema/types, identify how entities connect:
- `from` / `to`: Entity IDs
- `label`: Description (e.g., `has many`, `belongs to`, `creates`)
- `type`: `one-to-many`, `many-to-many`, `one-to-one`, `many-to-one`

Look for foreign keys, join tables, nested types, and array references.

### 2g. Flows (User Journeys)
Think about the primary user journeys through the app:
- **Onboarding**: signup > verify > first-use
- **Core loop**: browse > select > detail > action
- **Admin workflows**: list > create/edit > review

Each flow is an ordered list of screen and/or entity IDs. Create 2-5 flows for a typical project.

---

## Step 3: Generate Manifests

For each project, create a manifest file at `{manifests-dir}/{project-id}.json` (where `{manifests-dir}` is either the local `manifests/` folder or the custom `MANIFESTS_DIR` path configured in `.env`).

**Naming convention:**
- Single word: `my-app.json`
- With prefix: `001-my-app.json` (for numbered/ordered projects)
- Sub-projects: `parent--child.json` (double dash separator)

### Manifest Template

```json
{
  "id": "project-id",
  "name": "Project Display Name",
  "description": "One-line description",
  "tech": "Tech stack summary",

  "sections": [
    { "id": "section-id", "name": "Section Name", "icon": "lucide-icon-name" }
  ],

  "screens": [
    {
      "id": "screen-id",
      "name": "Screen Name",
      "route": "/path",
      "section": "section-id",
      "description": "What this screen does",
      "status": "live",
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
      "screens": ["screen-id-1"]
    }
  ],

  "relationships": [
    { "from": "entity-a", "to": "entity-b", "label": "has many", "type": "one-to-many" }
  ],

  "flows": [
    {
      "id": "flow-id",
      "name": "Flow Name",
      "description": "Journey description",
      "steps": ["screen-id-1", "screen-id-2"]
    }
  ]
}
```

### Validation Rules

Before saving, verify:
- [ ] Every `screen.section` references a valid section ID
- [ ] Every `entity.screens` entry references a valid screen ID
- [ ] Every `relationship.from` and `.to` references a valid entity ID
- [ ] Every `flow.steps` entry references a valid screen or entity ID
- [ ] No duplicate IDs within the same category
- [ ] All IDs are kebab-case (lowercase, hyphens only)

---

## Step 4: Present Results & Confirm

After generating manifests:

1. **Summarize** what you found for each project:
   - *"I mapped [Project Name]: [N] sections, [N] screens, [N] entities, [N] relationships, [N] flows"*

2. **Ask for review**: *"Want me to walk through any of these, or should I save them all?"*

3. **Save** the manifests to the configured manifests directory

4. **Remove examples** (optional): Ask the user if they want to keep or delete the example manifests (`example-saas.json`, `example-blog.json`)

5. **Start the server**: Offer to run `npm start` so they can see the result

---

## Step 5: Guide Ongoing Use

After setup, explain:

- **To update a manifest**: Edit the JSON in `manifests/`, then click "Refresh" in the browser
- **To add a new project**: Create a new `.json` file in `manifests/` following the same schema
- **To remove a project**: Delete its manifest file
- **Ask your AI agent**: *"Update the PPM manifest for [project] - I added a new [screen/entity/flow]"*

### SwiftBar Setup (macOS)

If the user is on macOS, offer to set up the SwiftBar menu bar plugin:

1. Ask if they use [SwiftBar](https://swiftbar.app). If not, briefly explain: *"SwiftBar lets you put custom scripts in your menu bar. It would give you a one-click way to start/stop PPM and see how many projects are mapped."*

2. If they want it:
   - Find their SwiftBar plugins folder (usually `~/Library/Application Support/SwiftBar/Plugins/` or they may have a custom path)
   - Copy `extras/ppm-tool.5s.sh` to their plugins folder
   - Edit the `PROPPER_DIR` variable inside the script to point to the actual PPM installation path
   - Make it executable: `chmod +x <path>/propper.5s.sh`
   - Tell them: *"You should see 'P:off' in your menu bar. Click it to start the server."*

### Keeping Manifests Updated

When working on a project and you make structural changes (new routes, new database tables, new features), update the corresponding manifest. The agent.md in the project itself can reference this:

```
When making structural changes to this project, also update the PPM manifest at:
[path to propper-project-mapper]/manifests/[project-id].json
```

---

## Reference: Section Icon Names

Use Lucide icon names for section icons. Common ones:

| Icon | Use For |
|------|---------|
| `layout-dashboard` | Dashboard/overview |
| `users` | CRM, contacts, team |
| `settings` | Settings, config |
| `shield` | Admin, security |
| `credit-card` | Billing, payments |
| `megaphone` | Marketing |
| `bar-chart` | Analytics |
| `clipboard-list` | Operations, tasks |
| `globe` | Public-facing pages |
| `pen-tool` | Content management |
| `lock` | Authentication |
| `database` | Data management |
| `mail` | Messaging, notifications |
| `shopping-cart` | E-commerce |
| `code` | Developer tools |

---

## Troubleshooting

**No projects in dropdown**: Check that manifests exist in `manifests/` and are valid JSON.

**Manifest not loading**: Run `node -e "JSON.parse(require('fs').readFileSync('manifests/FILE.json','utf-8'))"` to check for JSON syntax errors.

**Server won't start**: Run `npm install` first. Check that the port in `.env` isn't already in use (`lsof -iTCP:<port>`).

**Graph looks empty**: Make sure screens have `section` values that match section IDs. Orphaned screens won't render.
