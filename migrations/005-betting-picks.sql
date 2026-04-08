-- Create betting_picks table if it doesn't exist, or add missing columns
CREATE TABLE IF NOT EXISTS betting_picks (
  id BIGSERIAL PRIMARY KEY
);

ALTER TABLE betting_picks
ADD COLUMN IF NOT EXISTS tournament_id text,
ADD COLUMN IF NOT EXISTS player_name text,
ADD COLUMN IF NOT EXISTS bet_type text,
ADD COLUMN IF NOT EXISTS pick text,
ADD COLUMN IF NOT EXISTS odds text,
ADD COLUMN IF NOT EXISTS is_value boolean,
ADD COLUMN IF NOT EXISTS edge_label text,
ADD COLUMN IF NOT EXISTS analysis text,
ADD COLUMN IF NOT EXISTS confidence integer,
ADD COLUMN IF NOT EXISTS units numeric,
ADD COLUMN IF NOT EXISTS result text,
ADD COLUMN IF NOT EXISTS sportsbook text,
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_betting_picks_tournament ON betting_picks(tournament_id);
CREATE INDEX IF NOT EXISTS idx_betting_picks_type ON betting_picks(bet_type);
