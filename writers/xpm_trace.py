"""XPM trace writer for Python projects. Copy this file in; standard library only.

One JSONL line per hop, appended to <dir>/<YYYY-MM-DD>.jsonl.
Privacy: only ids, decisions and timings. Never pass message text, user ids or tokens.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from datetime import datetime, timezone

KEYS = ("decision", "durationMs", "status", "errorCode", "attempt", "model", "tokens", "costUsd", "sentAt")
PREVIEW_MAX = 120


def run_id_for(upstream_id: object, salt: str) -> str:
    """Hash an upstream id (for example a Telegram update_id) so the raw id never lands on disk."""
    return hashlib.sha256(f"{salt}:{upstream_id}".encode()).hexdigest()[:16]


class Tracer:
    def __init__(self, directory: str, pipeline: str, enabled: bool = True, previews: bool = False):
        """previews: opt in to keep what the person typed (cut to 120 characters) in <dir>/previews/,
        apart from the events. Leave it off unless the owner of the data has said yes."""
        self.dir, self.pipeline, self.enabled, self.previews = directory, pipeline, enabled, previews
        self._seq: dict[str, int] = {}
        if enabled:
            os.makedirs(directory, exist_ok=True)

    def emit(self, run_id: str, type_: str, node: str | None = None, **metadata) -> None:
        if not self.enabled:
            return
        try:
            meta = {k: metadata[k] for k in KEYS if metadata.get(k) is not None}
            seq = self._seq.get(run_id, 0) + 1
            self._seq[run_id] = seq
            if len(self._seq) > 5000:
                self._seq.pop(next(iter(self._seq)))
            ts = metadata.get("ts") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            event = {"runId": run_id, "ts": ts, "seq": seq, "pipeline": self.pipeline, "type": type_, "metadata": meta}
            if node:
                event["node"] = node
            with open(os.path.join(self.dir, f"{ts[:10]}.jsonl"), "a", encoding="utf-8") as fh:
                fcntl.flock(fh, fcntl.LOCK_EX)
                fh.write(json.dumps(event, separators=(",", ":")) + "\n")
        except Exception:  # Tracing must never break the product.
            pass

    def preview(self, run_id: str, text: str, ts: str | None = None) -> None:
        if not (self.enabled and self.previews):
            return
        try:
            flat = " ".join("".join(" " if ord(c) < 32 or ord(c) == 127 else c for c in str(text or "")).split())
            if len(flat) > PREVIEW_MAX:
                flat = flat[: PREVIEW_MAX - 1] + "\u2026"
            ts = ts or datetime.now(timezone.utc).isoformat()
            pdir = os.path.join(self.dir, "previews")
            os.makedirs(pdir, exist_ok=True)
            with open(os.path.join(pdir, f"{ts[:10]}.jsonl"), "a", encoding="utf-8") as fh:
                fcntl.flock(fh, fcntl.LOCK_EX)
                fh.write(json.dumps({"runId": run_id, "text": flat}, ensure_ascii=False) + "\n")
        except Exception:  # Tracing must never break the product.
            pass

    def start(self, run_id: str, **m) -> None:
        self.emit(run_id, "run.started", **m)

    def node(self, run_id: str, node: str, **m) -> None:
        self.emit(run_id, "node.completed", node, **m)

    def fail(self, run_id: str, node: str, **m) -> None:
        self.emit(run_id, "node.failed", node, **m)

    def decide(self, run_id: str, node: str, decision: dict, **m) -> None:
        self.emit(run_id, "decision", node, decision=decision, **m)

    def end(self, run_id: str, **m) -> None:
        self.emit(run_id, "run.completed", **m)

    def end_failed(self, run_id: str, **m) -> None:
        self.emit(run_id, "run.failed", **m)
