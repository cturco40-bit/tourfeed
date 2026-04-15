-- PGA Tour GraphQL enrichment tables
-- Populated by netlify/functions/fetch-pga-graphql.js
-- Source: orchestrator.pgatour.com/graphql (keyless free endpoint used by pgatour.com itself)

-- Link our tournament rows to the PGA Tour GraphQL tournament ID (e.g. "R2026014")
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS pga_tournament_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tournaments_pga ON tournaments(pga_tournament_id);

-- Live odds + projected cut per active tournament
-- Written on every cron run during an active event, latest row wins
CREATE TABLE IF NOT EXISTS tournament_live_context (
  pga_tournament_id   TEXT PRIMARY KEY,
  tournament_name     TEXT,
  tournament_status   TEXT,       -- IN_PROGRESS | COMPLETED | UPCOMING
  current_round       INTEGER,
  round_header        TEXT,       -- e.g. "R3", "CUT", "FINAL"
  projected_cut_line  TEXT,       -- e.g. "-1"
  probable_cut_line   TEXT,
  cut_last_updated    BIGINT,     -- AWS timestamp from feed
  leaders_json        JSONB,      -- top 10 rows with player, total, score, thru, oddsToWin
  raw_player_count    INTEGER,
  fetched_at          TIMESTAMPTZ DEFAULT now()
);

-- Per-player live scoring snapshot (augments existing `leaderboard` with PGA-exclusive fields)
-- Keyed on (pga_tournament_id, pga_player_id) so we can re-sync idempotently
CREATE TABLE IF NOT EXISTS pga_leaderboard (
  id                  BIGSERIAL PRIMARY KEY,
  pga_tournament_id   TEXT NOT NULL,
  pga_player_id       TEXT NOT NULL,
  player_name         TEXT,
  country             TEXT,
  country_flag        TEXT,
  position            TEXT,
  total               TEXT,        -- "-14"
  total_strokes       TEXT,
  today_score         TEXT,
  thru                TEXT,
  player_state        TEXT,        -- ACTIVE | CUT | WITHDRAWN | COMPLETE
  odds_to_win         TEXT,        -- live win odds, free from PGA GraphQL
  movement_direction  TEXT,
  movement_amount     TEXT,
  current_round       INTEGER,
  fetched_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pga_tournament_id, pga_player_id)
);
CREATE INDEX IF NOT EXISTS idx_pga_lb_tournament ON pga_leaderboard(pga_tournament_id);

-- Season-long strokes gained leaders by category
-- Refreshed once per day; each run truncates+replaces for the (tour_code, year) combo
CREATE TABLE IF NOT EXISTS sg_leaders (
  id                BIGSERIAL PRIMARY KEY,
  tour_code         TEXT NOT NULL,        -- 'R' = PGA Tour
  season            INTEGER NOT NULL,
  stat_id           TEXT NOT NULL,        -- e.g. "02675" for SG: Total
  stat_title        TEXT NOT NULL,        -- "SG: Total", "SG: Off-the-Tee", etc.
  rank              TEXT,                 -- "1st", "T2nd"
  player_name       TEXT NOT NULL,
  player_id         TEXT,
  country           TEXT,
  country_flag      TEXT,
  stat_value        TEXT NOT NULL,        -- "+2.002"
  stat_value_num    NUMERIC,              -- parsed numeric for sorting
  fetched_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tour_code, season, stat_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_sg_leaders_stat ON sg_leaders(tour_code, season, stat_id);

-- Hole-by-hole difficulty for the active tournament's course
-- Overwritten every cron run
CREATE TABLE IF NOT EXISTS course_holes (
  id                  BIGSERIAL PRIMARY KEY,
  pga_tournament_id   TEXT NOT NULL,
  course_id           TEXT,
  hole                INTEGER NOT NULL,
  par                 INTEGER,
  yards               INTEGER,
  avg_score           NUMERIC,
  rank                INTEGER,             -- 1 = hardest
  eagles              INTEGER,
  birdies             INTEGER,
  pars                INTEGER,
  bogeys              INTEGER,
  doubles_plus        INTEGER,
  fetched_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pga_tournament_id, course_id, hole)
);
CREATE INDEX IF NOT EXISTS idx_course_holes_tournament ON course_holes(pga_tournament_id);

-- RLS — public read, service write (matches the rest of the schema)
ALTER TABLE tournament_live_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE pga_leaderboard         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sg_leaders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_holes            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tlc"  ON tournament_live_context;
DROP POLICY IF EXISTS "Public read plb"  ON pga_leaderboard;
DROP POLICY IF EXISTS "Public read sgl"  ON sg_leaders;
DROP POLICY IF EXISTS "Public read ch"   ON course_holes;
DROP POLICY IF EXISTS "Service write tlc" ON tournament_live_context;
DROP POLICY IF EXISTS "Service write plb" ON pga_leaderboard;
DROP POLICY IF EXISTS "Service write sgl" ON sg_leaders;
DROP POLICY IF EXISTS "Service write ch"  ON course_holes;

CREATE POLICY "Public read tlc"  ON tournament_live_context FOR SELECT USING (true);
CREATE POLICY "Public read plb"  ON pga_leaderboard         FOR SELECT USING (true);
CREATE POLICY "Public read sgl"  ON sg_leaders              FOR SELECT USING (true);
CREATE POLICY "Public read ch"   ON course_holes            FOR SELECT USING (true);
CREATE POLICY "Service write tlc" ON tournament_live_context FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write plb" ON pga_leaderboard         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write sgl" ON sg_leaders              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write ch"  ON course_holes            FOR ALL USING (true) WITH CHECK (true);
