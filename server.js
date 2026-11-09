const express = require("express");
const fs = require("fs");
const path = require("path");

// Load .env file if it exists (no dependency needed)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

const app = express();
const PORT = process.env.PORT || 3333;
const MANIFESTS_DIR = process.env.MANIFESTS_DIR || path.join(__dirname, "manifests");
// Private execution events and drafts live outside git (see .gitignore). Examples ship under examples/.
const EVENTS_DIR = process.env.XPM_EVENTS_DIR || path.join(__dirname, "events");
const DRAFTS_DIR = process.env.XPM_DRAFTS_DIR || path.join(__dirname, "drafts");
const REPOS_FILE = process.env.XPM_REPOS || path.join(__dirname, ".xpm-repos.json");
const EXAMPLES = path.join(__dirname, "examples");
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
const xpm = require("./lib/pipeline");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "200kb" }));

// Ids become file names: only plain ids, never paths.
app.param("id", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "Bad project id" })));
app.param("pid", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "Bad pipeline id" })));

function readManifest(id) {
  const filePath = path.join(MANIFESTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function findPipeline(req, res) {
  let manifest;
  try {
    manifest = readManifest(req.params.id);
  } catch (err) {
    res.status(500).json({ error: `Invalid JSON: ${err.message}` });
    return null;
  }
  const pipeline = manifest && (manifest.pipelines || []).find((p) => p.id === req.params.pid);
  if (!pipeline) {
    res.status(404).json({ error: "Pipeline not found" });
    return null;
  }
  return { manifest, pipeline };
}

// Real events win; the example project falls back to its synthetic events.
function eventsDirFor(project) {
  const real = path.join(EVENTS_DIR, project);
  if (fs.existsSync(real)) return real;
  const example = path.join(EXAMPLES, "events", project);
  return project.startsWith("example-") && fs.existsSync(example) ? example : null;
}

function reposFor(project) {
  if (fs.existsSync(REPOS_FILE)) return xpm.loadRepos(REPOS_FILE);
  return project.startsWith("example-") ? xpm.loadRepos(path.join(__dirname, ".xpm-repos.example.json")) : {};
}

// List all available project manifests
app.get("/api/projects", (req, res) => {
  const files = fs.readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith(".json"));
  const projects = [];

  files.forEach((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, f), "utf-8"));
      projects.push({
        id: data.id,
        name: data.name,
        description: data.description,
        tech: data.tech,
        screenCount: data.screens?.length || 0,
        entityCount: data.entities?.length || 0,
        pipelineCount: data.pipelines?.length || 0,
      });
    } catch (err) {
      console.error(`  Error reading ${f}: ${err.message}`);
    }
  });

  res.json(projects);
});

// Get a specific project manifest
app.get("/api/project/:id", (req, res) => {
  const filePath = path.join(MANIFESTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Project not found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Invalid JSON: ${err.message}` });
  }
});

// Pipeline: the map, its code check, and the last runs laid over it
app.get("/api/project/:id/pipeline/:pid", (req, res) => {
  const found = findPipeline(req, res);
  if (!found) return;
  const { pipeline } = found;
  const errors = xpm.validatePipeline(pipeline);
  const anchors = errors.length ? [] : xpm.checkAnchors(pipeline, reposFor(req.params.id));
  const dir = eventsDirFor(req.params.id);
  const { events, rejected } = xpm.loadEvents(dir, pipeline.id);
  const last50 = xpm.foldRuns(events).slice(0, 50);
  // What the person typed is attached here, for the runs list only. It never enters simulate or a spec.
  const previews = xpm.loadPreviews(dir);
  res.json({
    pipeline,
    check: { errors, anchors },
    overlay: xpm.overlay(pipeline, last50),
    runs: last50.map((r) => ({ ...r, preview: previews.get(r.runId) ?? null })),
    rejectedEvents: rejected.length,
    generatedAt: new Date().toISOString(),
  });
});

// Drafts saved for a pipeline (private folder, examples for the example project)
app.get("/api/project/:id/pipeline/:pid/drafts", (req, res) => {
  const dirs = [path.join(DRAFTS_DIR, req.params.id)];
  if (req.params.id.startsWith("example-")) dirs.push(path.join(EXAMPLES, "drafts"));
  const drafts = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        const savedAt = fs.statSync(path.join(dir, f)).mtime.toISOString();
        if (!d.pipeline || d.pipeline === req.params.pid) drafts.push({ ...d, file: f, savedAt });
      } catch (err) {
        console.error(`  Error reading draft ${f}: ${err.message}`);
      }
    }
  }
  res.json(drafts);
});

// What-if: replay the recorded runs through a draft. Nothing is written.
app.post("/api/project/:id/pipeline/:pid/simulate", (req, res) => {
  const found = findPipeline(req, res);
  if (!found) return;
  const draft = req.body && typeof req.body === "object" ? req.body : {};
  const runs = xpm.foldRuns(xpm.loadEvents(eventsDirFor(req.params.id), found.pipeline.id).events);
  const result = xpm.simulate(found.pipeline, draft, runs);
  if (!result.ok) return res.status(400).json(result);
  // Only the runs that change route travel back; that is all the result table needs.
  res.json({ ...result, perRun: result.perRun.filter((r) => r.changed), spec: xpm.draftToSpec(found.pipeline, draft, result) });
});

// Validate a manifest (re-reads and reports stats)
app.post("/api/regenerate/:id", (req, res) => {
  const filePath = path.join(MANIFESTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "Manifest not found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const stats = {
      sections: data.sections?.length || 0,
      screens: data.screens?.length || 0,
      entities: data.entities?.length || 0,
      relationships: data.relationships?.length || 0,
      flows: data.flows?.length || 0,
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  const count = fs.readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith(".json")).length;
  console.log(`\n  PPM (Propper Project Mapper) running at http://localhost:${PORT}`);
  console.log(`  Manifests: ${MANIFESTS_DIR} (${count} projects)\n`);
});
