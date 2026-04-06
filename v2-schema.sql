-- TourFeed v2 Schema — Content Drafts & Hashes
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- Content drafts queue
CREATE TABLE IF NOT EXISTS content_drafts (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL, -- tweet_reaction, tweet_content, tweet_betting, tweet_breaking, article_recap, article_news, article_preview, article_analysis, article_betting, reddit, instagram, newsletter, hot_take, stat_card
  tour_id TEXT,
  tournament_id TEXT,
  round INTEGER,
  title TEXT,
  body TEXT NOT NULL,
  image_url TEXT,
  article_url TEXT,
  article_slug TEXT,
  meta JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'published')),
  content_hash TEXT UNIQUE,
  source_event TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_drafts_status ON content_drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_type ON content_drafts(type);
CREATE INDEX IF NOT EXISTS idx_drafts_created ON content_drafts(created_at DESC);

-- Content hashes to prevent duplicate content
CREATE TABLE IF NOT EXISTS content_hashes (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT
);

-- Enable RLS
ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_hashes ENABLE ROW LEVEL SECURITY;

-- Public read for drafts (admin page needs to read)
CREATE POLICY "Public read drafts" ON content_drafts FOR SELECT USING (true);
-- Service role can do everything
CREATE POLICY "Service write drafts" ON content_drafts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write hashes" ON content_hashes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read hashes" ON content_hashes FOR SELECT USING (true);

-- Update articles table to support slugs and images
ALTER TABLE articles ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS header_image TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS read_time INTEGER DEFAULT 3;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'NEWS';
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);

-- Storage bucket for generated images
-- NOTE: Create this manually in Supabase Dashboard → Storage → New Bucket
-- Name: "images", Public: Yes
