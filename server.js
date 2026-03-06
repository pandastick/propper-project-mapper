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

app.use(express.static(path.join(__dirname, "public")));

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
