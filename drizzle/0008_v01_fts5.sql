-- Migration 0008: v0.1 — FTS5 virtual tables for findings and FP bank
-- These are RAW SQL and are NOT managed by Drizzle schema introspection.
-- Uses sidecar map tables because FTS5 rowid must be INTEGER but our PKs are TEXT UUIDs.

-- ─── findings_fts sidecar map ──────────────────────────────────
-- Maps INTEGER rowid (FTS5) → TEXT finding.id (UUID)
CREATE TABLE IF NOT EXISTS findings_fts_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL UNIQUE
);

-- ─── findings_fts virtual table ────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(
  title,
  description,
  location_path,
  content='',
  tokenize='porter unicode61'
);

-- ─── findings_fts triggers ─────────────────────────────────────
-- ai: after insert — add to map + FTS
CREATE TRIGGER IF NOT EXISTS findings_fts_ai
AFTER INSERT ON findings BEGIN
  INSERT INTO findings_fts_map (finding_id) VALUES (NEW.id);
  INSERT INTO findings_fts (rowid, title, description, location_path)
    VALUES (last_insert_rowid(), NEW.title, NEW.description, NEW.location_path);
END;

-- au: after update — remove old FTS entry + re-insert
CREATE TRIGGER IF NOT EXISTS findings_fts_au
AFTER UPDATE ON findings BEGIN
  INSERT INTO findings_fts (findings_fts, rowid, title, description, location_path)
    SELECT 'delete', fm.rowid, OLD.title, OLD.description, OLD.location_path
    FROM findings_fts_map fm WHERE fm.finding_id = OLD.id;
  INSERT INTO findings_fts (rowid, title, description, location_path)
    SELECT fm.rowid, NEW.title, NEW.description, NEW.location_path
    FROM findings_fts_map fm WHERE fm.finding_id = NEW.id;
END;

-- ad: after delete — remove from FTS + map
CREATE TRIGGER IF NOT EXISTS findings_fts_ad
AFTER DELETE ON findings BEGIN
  INSERT INTO findings_fts (findings_fts, rowid, title, description, location_path)
    SELECT 'delete', fm.rowid, OLD.title, OLD.description, OLD.location_path
    FROM findings_fts_map fm WHERE fm.finding_id = OLD.id;
  DELETE FROM findings_fts_map WHERE finding_id = OLD.id;
END;

-- ─── fp_bank_fts sidecar map ───────────────────────────────────
-- Maps INTEGER rowid (FTS5) → TEXT finding_dismissals.id (UUID)
CREATE TABLE IF NOT EXISTS fp_bank_fts_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  dismissal_id TEXT NOT NULL UNIQUE
);

-- ─── fp_bank_fts virtual table ─────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS fp_bank_fts USING fts5(
  reason,
  title,
  content='',
  tokenize='porter unicode61'
);

-- ─── fp_bank_fts triggers ──────────────────────────────────────
-- ai: after insert on finding_dismissals — join to get finding title
CREATE TRIGGER IF NOT EXISTS fp_bank_fts_ai
AFTER INSERT ON finding_dismissals BEGIN
  INSERT INTO fp_bank_fts_map (dismissal_id) VALUES (NEW.id);
  INSERT INTO fp_bank_fts (rowid, reason, title)
    SELECT last_insert_rowid(), NEW.reason, COALESCE(f.title, '')
    FROM findings f WHERE f.id = NEW.finding_id;
END;

-- au: after update on finding_dismissals — re-sync reason
CREATE TRIGGER IF NOT EXISTS fp_bank_fts_au
AFTER UPDATE ON finding_dismissals BEGIN
  INSERT INTO fp_bank_fts (fp_bank_fts, rowid, reason, title)
    SELECT 'delete', fm.rowid, OLD.reason, COALESCE(f.title, '')
    FROM fp_bank_fts_map fm, findings f
    WHERE fm.dismissal_id = OLD.id AND f.id = OLD.finding_id;
  INSERT INTO fp_bank_fts (rowid, reason, title)
    SELECT fm.rowid, NEW.reason, COALESCE(f.title, '')
    FROM fp_bank_fts_map fm, findings f
    WHERE fm.dismissal_id = NEW.id AND f.id = NEW.finding_id;
END;

-- ad: after delete on finding_dismissals — remove from FTS + map
CREATE TRIGGER IF NOT EXISTS fp_bank_fts_ad
AFTER DELETE ON finding_dismissals BEGIN
  INSERT INTO fp_bank_fts (fp_bank_fts, rowid, reason, title)
    SELECT 'delete', fm.rowid, OLD.reason, COALESCE(f.title, '')
    FROM fp_bank_fts_map fm, findings f
    WHERE fm.dismissal_id = OLD.id AND f.id = OLD.finding_id;
  DELETE FROM fp_bank_fts_map WHERE dismissal_id = OLD.id;
END;

-- ─── Backfill existing findings into FTS ───────────────────────
INSERT INTO findings_fts_map (finding_id)
  SELECT id FROM findings;

INSERT INTO findings_fts (rowid, title, description, location_path)
  SELECT fm.rowid, f.title, f.description, f.location_path
  FROM findings_fts_map fm
  JOIN findings f ON f.id = fm.finding_id;

-- ─── Backfill existing dismissals into FP bank FTS ─────────────
INSERT INTO fp_bank_fts_map (dismissal_id)
  SELECT id FROM finding_dismissals;

INSERT INTO fp_bank_fts (rowid, reason, title)
  SELECT fm.rowid, d.reason, COALESCE(f.title, '')
  FROM fp_bank_fts_map fm
  JOIN finding_dismissals d ON d.id = fm.dismissal_id
  JOIN findings f ON f.id = d.finding_id;
