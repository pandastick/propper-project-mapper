const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const xpm = require("../lib/pipeline");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-src-"));
  const mirror = path.join(root, "mirror"), truth = path.join(root, "truth");
  fs.mkdirSync(path.join(mirror, "telegram"), { recursive: true });
  fs.writeFileSync(path.join(mirror, "telegram", "a.ts"), "export const a = 1\n");
  fs.writeFileSync(path.join(mirror, "telegram", "b.ts"), "export const b = 1\n");
  fs.writeFileSync(path.join(mirror, "telegram", "gone.ts"), "old\n");
  fs.writeFileSync(path.join(mirror, "telegram", "notes.md"), "not code\n");
  const git = (...a) => execFileSync("git", ["-C", mirror, ...a], { stdio: "pipe" });
  git("init", "-q"); git("-c", "user.email=t@t", "-c", "user.name=t", "add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  // The truth is the live box: same folder name, one file changed, one only on the box, one deleted, plus noise that must be skipped.
  fs.mkdirSync(path.join(truth, "telegram", "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(truth, "telegram", "a.ts"), "export const a = 1\n");
  fs.writeFileSync(path.join(truth, "telegram", "b.ts"), "export const b = 2\n");
  fs.writeFileSync(path.join(truth, "telegram", "box-only.ts"), "new\n");
  fs.writeFileSync(path.join(truth, "telegram", "b.ts.PRE-fix-20261109"), "backup\n");
  fs.writeFileSync(path.join(truth, "telegram", "node_modules", "x", "i.js"), "dep\n");
  return { root, mirror, truth };
}

test("blobSha matches git's own id for the bytes", () => {
  const { mirror } = fixture();
  const want = execFileSync("git", ["-C", mirror, "hash-object", "telegram/a.ts"], { encoding: "utf8" }).trim();
  assert.equal(xpm.blobSha(fs.readFileSync(path.join(mirror, "telegram/a.ts"))), want);
});

test("compareMirror: changed, truth-only and mirror-only files, noise skipped", () => {
  const { mirror, truth } = fixture();
  const r = xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "HEAD", paths: ["telegram"] });
  assert.deepEqual(r.differ, ["telegram/b.ts"]);
  assert.deepEqual(r.onlyTruth, ["telegram/box-only.ts"]);
  assert.deepEqual(r.onlyMirror, ["telegram/gone.ts"]);
  assert.equal(r.same, 1);
  assert.match(r.commitDate, /^\d{4}-\d{2}-\d{2}T/);
});

test("compareMirror: a prefix maps truth folders to a subfolder of the mirror", () => {
  const { root, mirror, truth } = fixture();
  const nested = path.join(root, "nested");
  fs.mkdirSync(path.join(nested, "app"), { recursive: true });
  fs.cpSync(path.join(mirror, "telegram"), path.join(nested, "app", "telegram"), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", nested, ...a], { stdio: "pipe" });
  git("init", "-q"); git("-c", "user.email=t@t", "-c", "user.name=t", "add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const r = xpm.compareMirror({ truthRoot: truth, checkout: nested, ref: "HEAD", paths: ["telegram"], prefix: "app" });
  assert.deepEqual(r.differ, ["telegram/b.ts"]);
});

test("validateProfile names what is missing", () => {
  assert.match(xpm.validateProfile({}).join(" "), /truth.repo is required/);
  const mirrorErrors = (mirror) => xpm.validateProfile({ truth: { repo: "x" }, mirror: { checkout: "y", paths: ["src"], ...mirror } }).join(" ");
  assert.match(mirrorErrors({ paths: ["../etc"] }), /must be a folder name inside the repo/);
  assert.match(mirrorErrors({ paths: [""] }), /must be a folder name inside the repo/);
  assert.match(mirrorErrors({ ref: "--upload-pack=x" }), /mirror.ref must be/);
  assert.match(mirrorErrors({ prefix: "../.." }), /mirror.prefix must be/);
  assert.match(mirrorErrors({ ignore: "*.service" }), /mirror.ignore is a list/);
  assert.equal(mirrorErrors({ ref: "origin/main", prefix: "app", ignore: ["*.service"] }), "");
  assert.deepEqual(xpm.validateProfile({ truth: { repo: "x" } }), []);
});

test("setupFacts: not set up, wrong machine, previews without a gate", () => {
  const ctx = { repos: { x: os.tmpdir() }, hostname: "mac", eventsDir: null, allowedLogins: 0, loopback: false };
  const none = xpm.setupFacts(null, ctx);
  assert.equal(none.configured, false);
  assert.equal(none.rows[0].status, "missing");
  const p = { truth: { repo: "x", label: "Live files" }, runsOn: "example-host", traces: { previews: true }, mapOwner: "the-owner" };
  const rows = Object.fromEntries(xpm.setupFacts(p, ctx).rows.map((r) => [r.key, r]));
  assert.equal(rows.truth.status, "ok");
  assert.equal(rows.runsOn.status, "note");
  assert.match(rows.runsOn.value, /example-host, but this XPM is on mac/);
  assert.equal(rows.access.status, "missing");
  assert.equal(rows.owner.status, "note");
  const access = (profile, extra) => xpm.setupFacts(profile, { ...ctx, ...extra }).rows.find((r) => r.key === "access");
  const quiet = { ...p, traces: { previews: false } };
  // No gate is a problem whenever other devices can reach it, previews or not.
  assert.equal(access(quiet, {}).status, "missing");
  assert.match(access(quiet, {}).detail, /file names/);
  assert.equal(access(quiet, { loopback: true, allowedHosts: 1 }).status, "missing");
  assert.equal(access(quiet, { loopback: true, proxied: true }).status, "missing");
  assert.equal(access(quiet, { loopback: true, deniedNodes: 1 }).value, "this machine only");
  assert.equal(access(quiet, { loopback: true, allowedHosts: 1, deniedNodes: 1 }).status, "missing"); // refusing one device is not a gate
  assert.equal(access(quiet, { loopback: true }).status, "ok");
  assert.equal(access(quiet, { loopback: true, allowedHosts: 1, allowedLogins: 1, deniedNodes: 1 }).value, "1 Tailscale login, 1 device refused");
  assert.equal(access(quiet, { loopback: true, allowedHosts: 1, allowedNodes: 2 }).status, "ok");
  const pub = Object.fromEntries(xpm.setupFacts({ ...p, access: { public: true } }, ctx).rows.map((r) => [r.key, r]));
  assert.equal(pub.access.status, "ok");
});

test("setupFacts: previews found while the profile says off is flagged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-ev-"));
  fs.mkdirSync(path.join(dir, "previews"));
  fs.writeFileSync(path.join(dir, "2026-11-09.jsonl"), "");
  const rows = Object.fromEntries(xpm.setupFacts({ truth: { repo: "x" }, traces: { previews: false } }, { repos: {}, hostname: "h", eventsDir: dir, allowedLogins: 0, loopback: true }).rows.map((r) => [r.key, r]));
  assert.equal(rows.traces.status, "missing");
  assert.match(rows.traces.detail, /Previews were found/);
});

test("compareMirror: backup folders and ignored files are left out on both sides, a missing truth folder is an error", () => {
  const { root, mirror, truth } = fixture();
  const git = (...a) => execFileSync("git", ["-C", mirror, ...a], { stdio: "pipe" });
  fs.mkdirSync(path.join(mirror, "telegram", "brand-backups", "old"), { recursive: true });
  fs.writeFileSync(path.join(mirror, "telegram", "brand-backups", "old", "index.html"), "old page\n");
  fs.writeFileSync(path.join(mirror, "telegram", "bot.service"), "[Unit]\n");
  fs.writeFileSync(path.join(mirror, "telegram", "deploy.sh"), "#!/bin/sh\n");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "more");
  fs.mkdirSync(path.join(truth, "telegram", "Backups-2026"), { recursive: true });
  fs.writeFileSync(path.join(truth, "telegram", "Backups-2026", "a.ts"), "old\n");
  const plain = xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "HEAD", paths: ["telegram"] });
  assert.deepEqual(plain.onlyMirror, ["telegram/bot.service", "telegram/deploy.sh", "telegram/gone.ts"]);
  assert.deepEqual(plain.onlyTruth, ["telegram/box-only.ts"]);
  const r = xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "HEAD", paths: ["telegram"], ignore: ["*.service", "telegram/deploy.sh", "box-*.ts"] });
  assert.deepEqual(r.onlyMirror, ["telegram/gone.ts"]);
  assert.deepEqual(r.onlyTruth, []);
  assert.throws(() => xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "HEAD", paths: ["telegrm"] }), /truth folder telegrm was not found/);
  assert.throws(() => xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "--help", paths: ["telegram"] }), /plain names/);
  assert.throws(() => xpm.compareMirror({ truthRoot: truth, checkout: mirror, ref: "HEAD:telegram", paths: ["telegram"] }));
  fs.rmSync(root, { recursive: true, force: true });
});
