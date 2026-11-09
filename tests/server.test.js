const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");

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

test("server binds loopback by default", async () => {
  const s = start({ HOST: "" });
  await s.ready;
  assert.match(s.log(), /running at http:\/\/127\.0\.0\.1:/);
  s.child.kill();
});

test("allowed logins: the right Tailscale login gets in, others and no header get 403", async () => {
  const s = start({ XPM_ALLOWED_LOGINS: "peter@example.com" });
  await s.ready;
  const url = `http://127.0.0.1:${s.port}/api/projects`;
  assert.equal((await fetch(url, { headers: { "Tailscale-User-Login": "Peter@Example.com" } })).status, 200);
  assert.equal((await fetch(url, { headers: { "Tailscale-User-Login": "someone@example.com" } })).status, 403);
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/pipeline.html`)).status, 403);
  s.child.kill();
});

test("allowed logins refuse to start on a non-loopback HOST", async () => {
  const s = start({ HOST: "0.0.0.0", XPM_ALLOWED_LOGINS: "peter@example.com" });
  const code = await new Promise((r) => s.child.on("exit", r));
  assert.equal(code, 1);
  assert.match(s.log(), /needs HOST on loopback/);
});

test("project ids cannot walk out of the manifests folder", async () => {
  const s = start({});
  await s.ready;
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/project/..%2F..%2Fpackage`)).status, 400);
  s.child.kill();
});
