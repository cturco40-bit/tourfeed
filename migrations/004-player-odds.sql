-- Player Odds table — real sportsbook odds from The Odds API
CREATE TABLE IF NOT EXISTS player_odds (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT,
  player_name TEXT,
  best_odds INTEGER,
  best_book TEXT,
  draftkings_odds INTEGER,
  fanduel_odds INTEGER,
  betmgm_odds INTEGER,
  implied_probability DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, player_name)
);

ALTER TABLE player_odds DISABLE ROW LEVEL SECURITY;
