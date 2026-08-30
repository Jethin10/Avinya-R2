"""Portable SQLite persistence. Schema mirrors the Postgres contract without spatial extensions."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS source (id TEXT PRIMARY KEY, channel TEXT, alpha REAL NOT NULL DEFAULT 1, beta REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS claim (
 id TEXT PRIMARY KEY, source_id TEXT, settlement_id TEXT, geo_confidence REAL, hazard TEXT,
 claim_text TEXT, text_orig TEXT, lang TEXT, severity_hint TEXT, info_type TEXT, is_firsthand INTEGER, channel TEXT,
 ts TEXT, cascade_root_id TEXT, cascade_size INTEGER, independent_sources INTEGER, provenance TEXT, chain_json TEXT
);
CREATE TABLE IF NOT EXISTS evidence (
 id INTEGER PRIMARY KEY AUTOINCREMENT, settlement_id TEXT NOT NULL, channel TEXT NOT NULL,
 failure_mode TEXT NOT NULL, log_lr REAL NOT NULL, correlation_group TEXT NOT NULL, ts TEXT NOT NULL, raw_ref TEXT
);
CREATE TABLE IF NOT EXISTS belief (
 settlement_id TEXT NOT NULL, failure_mode TEXT NOT NULL, log_odds REAL NOT NULL, variance REAL NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(settlement_id, failure_mode)
);
CREATE TABLE IF NOT EXISTS belief_checkpoint (sim_t TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task (id TEXT PRIMARY KEY, settlement_id TEXT, asset_id TEXT, payload_json TEXT, sim_t TEXT);
CREATE TABLE IF NOT EXISTS verification_task (id TEXT PRIMARY KEY, settlement_id TEXT, payload_json TEXT, sim_t TEXT);
CREATE TABLE IF NOT EXISTS decision_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sim_t TEXT NOT NULL, payload_json TEXT NOT NULL,
 belief_hash TEXT NOT NULL, prev_hash TEXT NOT NULL, entry_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS override_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, actor TEXT NOT NULL,
 reason TEXT NOT NULL, ts TEXT NOT NULL, outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disambiguation_queue (
 obs_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS ingest_event (obs_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, received_at TEXT NOT NULL);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            self._migrate(conn)

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Additive column migrations for databases created by an earlier schema."""
        for table, column, decl in (("claim", "channel", "TEXT"),):
            existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            yield self._conn
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def reset_runtime(self, *, preserve_audit: bool = False) -> None:
        with self._lock, self.connect() as conn:
            tables = ["claim", "evidence", "belief", "belief_checkpoint", "task", "verification_task", "disambiguation_queue", "ingest_event"]
            if not preserve_audit:
                tables.extend(["decision_log", "override_log"])
            for table in tables:
                conn.execute(f"DELETE FROM {table}")

    def save_source(self, source_id: str, channel: str, alpha: float = 1.0, beta: float = 1.0) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("INSERT INTO source(id,channel,alpha,beta) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel=excluded.channel", (source_id, channel, alpha, beta))

    def source(self, source_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM source WHERE id=?", (source_id,)).fetchone()
            return dict(row) if row else None

    def update_source_trust(self, source_id: str, confirmed: bool) -> None:
        field = "alpha" if confirmed else "beta"
        with self._lock, self.connect() as conn:
            conn.execute(f"UPDATE source SET {field}={field}+1 WHERE id=?", (source_id,))

    def save_raw_event(self, obs_id: str, payload: dict[str, Any], received_at: str) -> bool:
        with self._lock, self.connect() as conn:
            cur = conn.execute("INSERT OR IGNORE INTO ingest_event(obs_id,payload_json,received_at) VALUES(?,?,?)", (obs_id, json.dumps(payload, default=str), received_at))
            return cur.rowcount > 0

    def save_claim(self, claim: dict[str, Any]) -> None:
        columns = ["id","source_id","settlement_id","geo_confidence","hazard","claim_text","text_orig","lang","severity_hint","info_type","is_firsthand","channel","ts","cascade_root_id","cascade_size","independent_sources","provenance","chain_json"]
        values = [claim.get(c) for c in columns]
        values[10] = int(bool(values[10])); values[17] = json.dumps(values[17] or [])
        with self._lock, self.connect() as conn:
            conn.execute(f"INSERT OR REPLACE INTO claim({','.join(columns)}) VALUES({','.join('?' for _ in columns)})", values)

    def claims(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM claim ORDER BY ts,id")]

    def coverage(self) -> dict[str, Any]:
        """Per-settlement message, claim and evidence counts, plus district totals.

        The Twin needs this for three things the belief rows cannot answer: how many raw messages
        became how many distinct claims (the information-paradox panel), report density per village
        (the Reports map mode), and which villages carry no usable signal at all (the unknown state).
        A settlement with evidence but zero messages is a silent zone - the map's Silence mode is
        exactly this table, read inverted.
        """
        with self.connect() as conn:
            claims = conn.execute(
                "SELECT settlement_id, COUNT(*) AS messages, COUNT(DISTINCT cascade_root_id) AS claims,"
                " MAX(independent_sources) AS independent_sources"
                " FROM claim WHERE settlement_id IS NOT NULL GROUP BY settlement_id"
            ).fetchall()
            evidence = conn.execute(
                "SELECT settlement_id, COUNT(*) AS rows_count, COUNT(DISTINCT channel) AS channels"
                " FROM evidence GROUP BY settlement_id"
            ).fetchall()
            totals = conn.execute(
                "SELECT (SELECT COUNT(*) FROM ingest_event) AS messages_ingested,"
                " (SELECT COUNT(*) FROM claim) AS messages_located,"
                " (SELECT COUNT(DISTINCT cascade_root_id) FROM claim) AS distinct_claims,"
                " (SELECT COUNT(*) FROM disambiguation_queue WHERE state='open') AS unresolved_locations,"
                " (SELECT COUNT(*) FROM evidence) AS evidence_rows"
            ).fetchone()
        by_id: dict[str, dict[str, Any]] = {}
        for row in claims:
            by_id[row["settlement_id"]] = {"settlement_id": row["settlement_id"], "messages": row["messages"],
                                           "claims": row["claims"], "independent_sources": row["independent_sources"] or 0,
                                           "evidence_rows": 0, "channels": 0}
        for row in evidence:
            entry = by_id.setdefault(row["settlement_id"], {"settlement_id": row["settlement_id"], "messages": 0,
                                                            "claims": 0, "independent_sources": 0,
                                                            "evidence_rows": 0, "channels": 0})
            entry["evidence_rows"] = row["rows_count"]
            entry["channels"] = row["channels"]
        return {"totals": dict(totals), "settlements": sorted(by_id.values(), key=lambda row: row["settlement_id"])}

    def queue_disambiguation(self, obs_id: str, payload: dict[str, Any]) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO disambiguation_queue(obs_id,payload_json,created_at) VALUES(?,?,?)", (obs_id, json.dumps(payload, default=str), datetime.now().astimezone().isoformat()))

    def disambiguation_items(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM disambiguation_queue WHERE state='open' ORDER BY created_at").fetchall()
        return [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]

    def resolve_disambiguation(self, obs_id: str) -> bool:
        with self._lock, self.connect() as conn:
            cur = conn.execute("UPDATE disambiguation_queue SET state='resolved' WHERE obs_id=? AND state='open'", (obs_id,))
            return cur.rowcount > 0

    def add_evidence(self, rows: list[dict[str, Any]]) -> None:
        with self._lock, self.connect() as conn:
            conn.executemany("INSERT INTO evidence(settlement_id,channel,failure_mode,log_lr,correlation_group,ts,raw_ref) VALUES(:settlement_id,:channel,:failure_mode,:log_lr,:correlation_group,:ts,:raw_ref)", rows)

    def replace_evidence_for_ref(self, raw_ref: str, rows: list[dict[str, Any]]) -> None:
        """Re-state the evidence a claim contributes, when corroboration changes its weight."""
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM evidence WHERE raw_ref=?", (raw_ref,))
            if rows:
                conn.executemany("INSERT INTO evidence(settlement_id,channel,failure_mode,log_lr,correlation_group,ts,raw_ref) VALUES(:settlement_id,:channel,:failure_mode,:log_lr,:correlation_group,:ts,:raw_ref)", rows)

    def evidence(self, *, until: str | None = None, settlement_id: str | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []
        if until: clauses.append("ts<=?"); params.append(until)
        if settlement_id: clauses.append("settlement_id=?"); params.append(settlement_id)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM evidence" + where + " ORDER BY ts,id", params)]

    def upsert_beliefs(self, rows: list[dict[str, Any]]) -> None:
        with self._lock, self.connect() as conn:
            conn.executemany("INSERT INTO belief(settlement_id,failure_mode,log_odds,variance,updated_at) VALUES(:settlement_id,:failure_mode,:log_odds,:variance,:updated_at) ON CONFLICT(settlement_id,failure_mode) DO UPDATE SET log_odds=excluded.log_odds,variance=excluded.variance,updated_at=excluded.updated_at", rows)

    def replace_decisions(self, sim_t: str, plan: list[dict[str, Any]], verify: list[dict[str, Any]]) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM task"); conn.execute("DELETE FROM verification_task")
            conn.executemany("INSERT INTO task(id,settlement_id,asset_id,payload_json,sim_t) VALUES(?,?,?,?,?)", [(p["id"], p["settlement_id"], p["asset_id"], json.dumps(p), sim_t) for p in plan])
            conn.executemany("INSERT INTO verification_task(id,settlement_id,payload_json,sim_t) VALUES(?,?,?,?)", [(v["id"], v["settlement_id"], json.dumps(v), sim_t) for v in verify])

    def append_decision(self, sim_t: str, payload: dict[str, Any], belief_hash: str) -> dict[str, Any]:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        with self._lock, self.connect() as conn:
            previous = conn.execute("SELECT entry_hash FROM decision_log ORDER BY id DESC LIMIT 1").fetchone()
            prev_hash = previous["entry_hash"] if previous else "0" * 64
            entry_hash = hashlib.sha256(f"{prev_hash}|{sim_t}|{belief_hash}|{canonical}".encode()).hexdigest()
            cur = conn.execute("INSERT INTO decision_log(sim_t,payload_json,belief_hash,prev_hash,entry_hash) VALUES(?,?,?,?,?)", (sim_t, canonical, belief_hash, prev_hash, entry_hash))
            return {"id": cur.lastrowid, "sim_t": sim_t, "belief_hash": belief_hash, "prev_hash": prev_hash, "entry_hash": entry_hash}

    def decisions(self, since: int = 0) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM decision_log WHERE id>? ORDER BY id", (since,)).fetchall()
        return [{**dict(r), "payload": json.loads(r["payload_json"])} for r in rows]

    def audit_chain_valid(self) -> bool:
        rows = self.decisions()
        previous = "0" * 64
        for row in rows:
            canonical = json.dumps(row["payload"], sort_keys=True, separators=(",", ":"))
            expected = hashlib.sha256(f"{previous}|{row['sim_t']}|{row['belief_hash']}|{canonical}".encode()).hexdigest()
            if row["prev_hash"] != previous or row["entry_hash"] != expected:
                return False
            previous = row["entry_hash"]
        return True

    def save_override(self, decision_id: int, actor: str, reason: str, outcome: str, ts: str) -> int:
        with self._lock, self.connect() as conn:
            cur = conn.execute("INSERT INTO override_log(decision_id,actor,reason,ts,outcome) VALUES(?,?,?,?,?)", (decision_id, actor, reason, ts, outcome))
            return int(cur.lastrowid)

    def checkpoint(self, sim_t: str, payload: dict[str, Any]) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO belief_checkpoint(sim_t,payload_json) VALUES(?,?)", (sim_t, json.dumps(payload, separators=(",", ":"))))
