CREATE TABLE IF NOT EXISTS posted_reddit (
  id BIGSERIAL PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  subreddit TEXT NOT NULL,
  post_url TEXT,
  posted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, subreddit)
);
