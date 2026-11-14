// This repo is public. House names (machines, people, private products, tailnets) must never land in it.
// The list of names is itself private, so it lives in a git-ignored file: .private-names, one pattern per line
// (a regular expression, case does not matter, lines starting with # are comments). No file, no check.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LIST = path.join(ROOT, ".private-names");

test("no private name in a tracked file", { skip: fs.existsSync(LIST) ? false : "no .private-names file on this machine" }, () => {
  const patterns = fs.readFileSync(LIST, "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l, "i"));
  const files = execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const hits = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), "utf-8"); } catch { continue; }
    text.split("\n").forEach((line, i) => {
      for (const re of patterns) if (re.test(line) || re.test(f)) hits.push(`${f}:${i + 1} matches ${re.source}`);
    });
  }
  assert.deepEqual(hits.slice(0, 20), []);
});
