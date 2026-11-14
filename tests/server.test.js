const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
let nextPort = 4100 + Math.floor(Math.random() * 400);

function start(env) {
  const port = nextPort++;
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const ready = new Promise((resolve) => {
    const t = setInterval(() => { if (out.includes("running at") || child.exitCode !== null) { clearInterval(t); resolve(); } }, 25);
  });
  return { port, child, ready, log: () => out };
}

// fetch cannot set Host, and the host check is about exactly that header.
function get(port, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

// Stands in for `tailscale whois --json <ip>`: two known devices, everything else unknown.
function fakeTailscale() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-ts-"));
  const bin = path.join(dir, "tailscale");
  fs.writeFileSync(bin, `#!${process.execPath}
const [cmd, flag, ip] = process.argv.slice(2);
const nodes = { "100.64.0.1": { Name: "My-Laptop.example-tailnet.ts.net.", ComputedName: "my-laptop", Hostinfo: { Hostname: "My-Laptop" } }, "100.64.0.2": { Name: "build-box.example-tailnet.ts.net.", ComputedName: "build-box" } };
if (cmd !== "whois" || flag !== "--json" || !nodes[ip]) { console.error("peer not found"); process.exit(1); }
console.log(JSON.stringify({ Node: nodes[ip], UserProfile: { LoginName: "owner@example.com" } }));
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

test("server binds loopback by default", async () => {
  const s = start({ HOST: "" });
  await s.ready;
  assert.match(s.log(), /running at http:\/\/127\.0\.0\.1:/);
  s.child.kill();
});

test("allowed logins: the right Tailscale login gets in, others and no header get 403", async () => {
  const s = start({ XPM_ALLOWED_LOGINS: "owner@example.com" });
  await s.ready;
  const url = `http://127.0.0.1:${s.port}/api/projects`;
  assert.equal((await fetch(url, { headers: { "Tailscale-User-Login": "Owner@Example.com" } })).status, 200);
  assert.equal((await fetch(url, { headers: { "Tailscale-User-Login": "someone@example.com" } })).status, 403);
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/pipeline.html`)).status, 403);
  s.child.kill();
});

test("allowed logins refuse to start on a non-loopback HOST", async () => {
  const s = start({ HOST: "0.0.0.0", XPM_ALLOWED_LOGINS: "owner@example.com" });
  const code = await new Promise((r) => s.child.on("exit", r));
  assert.equal(code, 1);
  assert.match(s.log(), /need HOST on loopback/);
});

test("project ids cannot walk out of the manifests folder", async () => {
  const s = start({});
  await s.ready;
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/project/..%2F..%2Fpackage`)).status, 400);
  s.child.kill();
});

test("host check: on loopback only local names and allowed hosts are answered", async () => {
  const s = start({ XPM_ALLOWED_HOSTS: "Example-Host.example-tailnet.ts.net" });
  await s.ready;
  const status = async (host) => (await get(s.port, "/api/projects", { Host: host })).status;
  assert.equal(await status(`localhost:${s.port}`), 200);
  assert.equal(await status("127.0.0.1"), 200);
  assert.equal(await status(`[::1]:${s.port}`), 200);
  assert.equal(await status("example-host.example-tailnet.ts.net:8450"), 200);
  assert.equal(await status("rebound.attacker.example"), 403);
  assert.equal(await status(`127.0.0.1.attacker.example:${s.port}`), 403);
  assert.equal((await get(s.port, "/pipeline.html", { Host: "rebound.attacker.example" })).status, 403);
  s.child.kill();
});

test("device lists: a denied device is refused, and no answer means no entry", async () => {
  const s = start({ XPM_ALLOWED_LOGINS: "owner@example.com", XPM_DENIED_NODES: "Build-Box", XPM_TAILSCALE_BIN: fakeTailscale() });
  await s.ready;
  const login = { "Tailscale-User-Login": "owner@example.com" };
  const status = async (headers) => (await get(s.port, "/api/projects", { ...login, ...headers })).status;
  assert.equal(await status({ "X-Forwarded-For": "100.64.0.1" }), 200);
  assert.equal(await status({ "X-Forwarded-For": "100.64.0.2" }), 403);
  // A caller can add entries in front; the proxy's own entry is the last one.
  assert.equal(await status({ "X-Forwarded-For": "100.64.0.1, 100.64.0.2" }), 403);
  assert.equal(await status({ "X-Forwarded-For": "100.64.0.2, 100.64.0.1" }), 200);
  assert.equal(await status({ "X-Forwarded-For": "100.64.0.9" }), 403); // tailscale does not know it
  assert.equal(await status({ "X-Forwarded-For": "--help" }), 403);
  assert.equal(await status({}), 403);
  assert.equal((await get(s.port, "/api/projects", { "X-Forwarded-For": "100.64.0.1" })).status, 403); // the login gate still applies
  s.child.kill();
});

test("device lists: with an allowed list only listed devices get in, and a missing tailscale fails closed", async () => {
  const s = start({ XPM_ALLOWED_NODES: "my-laptop.example-tailnet.ts.net", XPM_TAILSCALE_BIN: fakeTailscale() });
  await s.ready;
  const status = async (ip) => (await get(s.port, "/api/projects", { "X-Forwarded-For": ip })).status;
  assert.equal(await status("100.64.0.1"), 200);
  assert.equal(await status("100.64.0.2"), 403);
  s.child.kill();
  const broken = start({ XPM_DENIED_NODES: "build-box", XPM_TAILSCALE_BIN: path.join(os.tmpdir(), "no-such-tailscale") });
  await broken.ready;
  assert.equal((await get(broken.port, "/api/projects", { "X-Forwarded-For": "100.64.0.1" })).status, 403);
  broken.child.kill();
  const open = start({ HOST: "0.0.0.0", XPM_DENIED_NODES: "build-box" });
  assert.equal(await new Promise((r) => open.child.on("exit", r)), 1);
  assert.match(open.log(), /need HOST on loopback/);
});

test("previews are served only when the project's profile says so", async () => {
  const api = "/api/project/example-bot/pipeline/inbound";
  const on = start({});
  await on.ready;
  const shown = (await get(on.port, api)).json();
  assert.ok(shown.runs.some((r) => typeof r.preview === "string" && r.preview.length > 0));
  assert.equal(shown.scrubbedDecisions, 0);
  on.child.kill();
  // Same files on disk, but this machine's profile says previews are off.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-prof-"));
  const profiles = path.join(dir, "projects.json");
  fs.writeFileSync(profiles, JSON.stringify({ "example-bot": { truth: { repo: "example" }, traces: { previews: false } } }));
  const off = start({ XPM_PROJECTS: profiles });
  await off.ready;
  const hidden = (await get(off.port, api)).json();
  assert.equal(hidden.runs.length, 50);
  assert.ok(hidden.runs.every((r) => r.preview === null));
  off.child.kill();
});

test("simulate: the answer and the spec hold no typed text, and a bad draft or map gets the reasons", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-man-"));
  fs.writeFileSync(path.join(dir, "broken.json"), JSON.stringify({ id: "broken", name: "Broken", pipelines: [{ id: "p", name: "No steps" }, { id: "q", nodes: [{ id: "a", kind: "door" }], edges: 5 }] }));
  const s = start({ MANIFESTS_DIR: [path.join(ROOT, "manifests"), dir].join(path.delimiter) });
  await s.ready;
  const api = "/api/project/example-bot/pipeline/inbound";
  const previews = (await get(s.port, api)).json().runs.map((r) => r.preview).filter(Boolean);
  assert.ok(previews.length > 10);
  const draft = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/drafts/example-bot-classifier-first.json"), "utf-8"));
  const res = await get(s.port, `${api}/simulate`, {}, draft);
  assert.equal(res.status, 200);
  assert.ok(res.json().spec.length > 100);
  for (const text of previews) assert.equal(res.text.includes(JSON.stringify(text).slice(1, -1)), false, text);

  for (const bad of [{ addNodes: 5 }, { removeEdges: [null] }, { addNodes: [{ id: "c", assume: { split: {} } }] }]) {
    const r = await get(s.port, `${api}/simulate`, {}, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.json().errors.length > 0);
  }
  for (const pid of ["p", "q"]) {
    const map = await get(s.port, `/api/project/broken/pipeline/${pid}`);
    assert.equal(map.status, 200);
    assert.ok(map.json().check.errors.length > 0);
    assert.equal(map.json().overlay, null);
    assert.equal((await get(s.port, `/api/project/broken/pipeline/${pid}/simulate`, {}, {})).status, 400);
  }
  s.child.kill();
});
