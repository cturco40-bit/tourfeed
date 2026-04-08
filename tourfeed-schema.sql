-- ============================================
-- TOURFEED DATABASE SCHEMA
-- Supabase PostgreSQL
-- ============================================

-- TOURS
CREATE TABLE tours (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 2,  -- 1=full coverage, 2=scores+recaps, 3=scores only
  espn_slug TEXT,
  logo_url TEXT,
  color TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO tours (id, name, short_name, tier, espn_slug, color) VALUES
  ('pga', 'PGA Tour', 'PGA', 1, 'pga', '#003865'),
  ('liv', 'LIV Golf', 'LIV', 1, null, '#D4001A'),
  ('dpw', 'DP World Tour', 'DPW', 2, 'eur', '#00205B'),
  ('lpga', 'LPGA Tour', 'LPGA', 2, 'lpga', '#00A651'),
  ('kft', 'Korn Ferry Tour', 'KFT', 3, 'kft', '#00543C'),
  ('champ', 'Champions Tour', 'CHAMP', 3, 'champ', '#6F263D');

-- TOURNAMENTS
CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  tour_id TEXT REFERENCES tours(id),
  name TEXT NOT NULL,
  course TEXT,
  location TEXT,
  start_date DATE,
  end_date DATE,
  purse TEXT,
  defending_champion TEXT,
  par INTEGER DEFAULT 72,
  yardage TEXT,
  status TEXT DEFAULT 'upcoming', -- upcoming, in_progress, complete
  current_round INTEGER,
  broadcast TEXT,
  is_major BOOLEAN DEFAULT false,
  espn_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- PLAYERS
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  country TEXT,
  country_flag TEXT,
  world_ranking INTEGER,
  age INTEGER,
  height_weight TEXT,
  turned_pro INTEGER,
  college TEXT,
  swing TEXT DEFAULT 'Right',
  headshot_url TEXT,
  espn_id TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_players_name ON players(name);
CREATE INDEX idx_players_ranking ON players(world_ranking);

-- LEADERBOARD (live scores per tournament)
CREATE TABLE leaderboard (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  player_id TEXT REFERENCES players(id),
  position TEXT,
  position_num INTEGER,
  total_score TEXT,        -- e.g. "-14"
  total_strokes INTEGER,
  today_score TEXT,        -- e.g. "66"
  thru TEXT,               -- e.g. "F", "12", "B9"
  round1 INTEGER,
  round2 INTEGER,
  round3 INTEGER,
  round4 INTEGER,
  status TEXT DEFAULT 'active', -- active, cut, wd, dq
  movement TEXT,           -- ↑2, ↓1, —
  tee_time TEXT,
  sg_total DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, player_id)
);

CREATE INDEX idx_leaderboard_tournament ON leaderboard(tournament_id);
CREATE INDEX idx_leaderboard_position ON leaderboard(position_num);

-- SCORECARDS (hole-by-hole)
CREATE TABLE scorecards (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  player_id TEXT REFERENCES players(id),
  round_number INTEGER NOT NULL,
  hole_scores INTEGER[] NOT NULL,  -- array of 18 scores
  par_scores INTEGER[] NOT NULL,   -- array of 18 pars
  total_strokes INTEGER,
  front_nine INTEGER,
  back_nine INTEGER,
  fairways_hit TEXT,
  greens_in_reg TEXT,
  putts INTEGER,
  sg_total DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, player_id, round_number)
);

-- PLAYER SEASON STATS
CREATE TABLE player_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  tour_id TEXT REFERENCES tours(id),
  season INTEGER NOT NULL,
  sg_total DECIMAL(5,2),
  sg_off_tee DECIMAL(5,2),
  sg_approach DECIMAL(5,2),
  sg_around_green DECIMAL(5,2),
  sg_putting DECIMAL(5,2),
  gir_pct DECIMAL(5,1),
  fairway_pct DECIMAL(5,1),
  drive_distance DECIMAL(5,1),
  scramble_pct DECIMAL(5,1),
  scoring_avg DECIMAL(5,2),
  wins INTEGER DEFAULT 0,
  top_10s INTEGER DEFAULT 0,
  cuts_made INTEGER DEFAULT 0,
  earnings TEXT,
  events_played INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_id, tour_id, season)
);

-- STANDINGS (FedEx Cup, Race to Dubai, etc.)
CREATE TABLE standings (
  id BIGSERIAL PRIMARY KEY,
  tour_id TEXT REFERENCES tours(id),
  standings_name TEXT NOT NULL,   -- "FedExCup", "Race to Dubai", etc.
  season INTEGER NOT NULL,
  player_id TEXT REFERENCES players(id),
  position INTEGER,
  points TEXT,
  wins INTEGER DEFAULT 0,
  top_10s INTEGER DEFAULT 0,
  earnings TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tour_id, season, player_id)
);

CREATE INDEX idx_standings_tour ON standings(tour_id, season);

-- ARTICLES (recaps, news, blog posts)
CREATE TABLE articles (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  tour_id TEXT REFERENCES tours(id),
  type TEXT NOT NULL,  -- recap, news, preview, analysis, dfs, rankings, course_notes
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT,
  tag TEXT,             -- RECAP, PREVIEW, ANALYSIS, DFS, RANKINGS, COURSE, QUOTES
  read_time TEXT,
  slug TEXT UNIQUE,
  source_url TEXT,
  source_name TEXT,
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_articles_type ON articles(type);
CREATE INDEX idx_articles_tour ON articles(tour_id);
CREATE INDEX idx_articles_published ON articles(published, published_at DESC);

-- BETTING INSIGHTS
CREATE TABLE betting_insights (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  player_id TEXT REFERENCES players(id),
  player_name TEXT,
  bet_type TEXT NOT NULL,   -- outright, top5, top10, top20, matchup, prop, first_round_leader, longshot, parlay
  pick TEXT NOT NULL,
  odds TEXT NOT NULL,
  implied_probability TEXT,
  model_probability TEXT,
  is_value BOOLEAN DEFAULT false,
  edge_label TEXT,          -- BEST BET, VALUE, LONGSHOT, MATCHUP, PROP, PARLAY
  analysis TEXT NOT NULL,
  confidence INTEGER,       -- 1-10
  units DECIMAL(3,1),
  result TEXT,              -- pending, won, lost, push
  sportsbook TEXT DEFAULT 'DraftKings',
  batch_id TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX idx_betting_tournament ON betting_insights(tournament_id);
CREATE INDEX idx_betting_result ON betting_insights(result);
CREATE INDEX idx_betting_batch ON betting_insights(tournament_id, batch_id);

-- BETTING SEASON RECORD
CREATE TABLE betting_record (
  id BIGSERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  total_picks INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  pushes INTEGER DEFAULT 0,
  units_wagered DECIMAL(8,1) DEFAULT 0,
  units_won DECIMAL(8,1) DEFAULT 0,
  roi_pct DECIMAL(5,1) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season)
);

INSERT INTO betting_record (season, total_picks, wins, losses, units_wagered, units_won, roi_pct) 
VALUES (2026, 53, 31, 22, 131.5, 150.2, 14.2);

-- SOCIAL POSTS
CREATE TABLE social_posts (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  article_id BIGINT REFERENCES articles(id),
  platform TEXT NOT NULL,   -- twitter, instagram, threads, tiktok
  content TEXT NOT NULL,
  image_url TEXT,
  post_url TEXT,
  posted BOOLEAN DEFAULT false,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SCHEDULE
CREATE TABLE schedule (
  id BIGSERIAL PRIMARY KEY,
  tour_id TEXT REFERENCES tours(id),
  tournament_name TEXT NOT NULL,
  course TEXT,
  location TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  purse TEXT,
  defending_champion TEXT,
  broadcast TEXT,
  is_major BOOLEAN DEFAULT false,
  season INTEGER NOT NULL,
  week_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_schedule_tour ON schedule(tour_id, start_date);

-- EMAIL SUBSCRIBERS
CREATE TABLE subscribers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  source TEXT DEFAULT 'landing_page',
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  active BOOLEAN DEFAULT true
);

-- SYNC LOG
CREATE TABLE sync_log (
  id BIGSERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,  -- scores, standings, articles, social, betting
  tour_id TEXT,
  tournament_id TEXT,
  status TEXT DEFAULT 'success',
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- VIEWS
-- ============================================

-- Current tournament leaderboard with player info
CREATE OR REPLACE VIEW v_leaderboard AS
SELECT 
  l.*,
  p.name as player_name,
  p.country_flag,
  p.world_ranking,
  t.name as tournament_name,
  t.course,
  t.status as tournament_status,
  t.current_round,
  t.broadcast,
  t.par,
  tr.short_name as tour_short_name
FROM leaderboard l
JOIN players p ON l.player_id = p.id
JOIN tournaments t ON l.tournament_id = t.id
JOIN tours tr ON t.tour_id = tr.id
ORDER BY l.position_num ASC;

-- Latest articles
CREATE OR REPLACE VIEW v_latest_articles AS
SELECT 
  a.*,
  t.name as tournament_name,
  tr.short_name as tour_short_name
FROM articles a
LEFT JOIN tournaments t ON a.tournament_id = t.id
LEFT JOIN tours tr ON a.tour_id = tr.id
WHERE a.published = true
ORDER BY a.published_at DESC;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE betting_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Public read access for all content
CREATE POLICY "Public read" ON tours FOR SELECT USING (true);
CREATE POLICY "Public read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public read" ON players FOR SELECT USING (true);
CREATE POLICY "Public read" ON leaderboard FOR SELECT USING (true);
CREATE POLICY "Public read" ON scorecards FOR SELECT USING (true);
CREATE POLICY "Public read" ON articles FOR SELECT USING (published = true);
CREATE POLICY "Public read" ON betting_insights FOR SELECT USING (true);
CREATE POLICY "Public read" ON standings FOR SELECT USING (true);
CREATE POLICY "Public read" ON schedule FOR SELECT USING (true);

-- Subscribers: anyone can insert (signup), only service role can read
CREATE POLICY "Anyone can subscribe" ON subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY "Service read" ON subscribers FOR SELECT USING (auth.role() = 'service_role');

-- Service role full access for edge functions
CREATE POLICY "Service write tours" ON tours FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write tournaments" ON tournaments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write players" ON players FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write leaderboard" ON leaderboard FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write scorecards" ON scorecards FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write articles" ON articles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write betting" ON betting_insights FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write standings" ON standings FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write schedule" ON schedule FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- AUTO-UPDATE TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_modified()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_tournaments_updated BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION update_modified();
CREATE TRIGGER tr_players_updated BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION update_modified();
CREATE TRIGGER tr_leaderboard_updated BEFORE UPDATE ON leaderboard FOR EACH ROW EXECUTE FUNCTION update_modified();
CREATE TRIGGER tr_standings_updated BEFORE UPDATE ON standings FOR EACH ROW EXECUTE FUNCTION update_modified();
CREATE TRIGGER tr_stats_updated BEFORE UPDATE ON player_stats FOR EACH ROW EXECUTE FUNCTION update_modified();

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE leaderboard;
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
ALTER PUBLICATION supabase_realtime ADD TABLE articles;
