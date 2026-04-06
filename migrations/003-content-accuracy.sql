-- TOURFEED Content Accuracy Engine
-- Run this in Supabase SQL Editor

-- 1. Player Facts — source of truth for every player mention
CREATE TABLE IF NOT EXISTS player_facts (
  id BIGSERIAL PRIMARY KEY,
  player_name TEXT NOT NULL UNIQUE,
  world_ranking INTEGER,
  current_tour TEXT,
  status TEXT DEFAULT 'active',
  current_injury TEXT,
  masters_wins INTEGER DEFAULT 0,
  masters_best TEXT,
  us_open_wins INTEGER DEFAULT 0,
  open_wins INTEGER DEFAULT 0,
  pga_champ_wins INTEGER DEFAULT 0,
  total_majors INTEGER DEFAULT 0,
  career_grand_slam BOOLEAN DEFAULT false,
  pga_wins INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  season_wins INTEGER DEFAULT 0,
  season_top10s INTEGER DEFAULT 0,
  fedex_rank INTEGER,
  age INTEGER,
  nationality TEXT,
  recent_notes TEXT,
  hot_topics TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE player_facts DISABLE ROW LEVEL SECURITY;

-- 2. Tournament Facts — course records, defending champs, history
CREATE TABLE IF NOT EXISTS tournament_facts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  course TEXT,
  par INTEGER,
  location TEXT,
  tour TEXT,
  defending_champion TEXT,
  defending_score TEXT,
  course_record TEXT,
  notable_history TEXT,
  purse TEXT,
  key_stats TEXT,
  course_fit TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tournament_facts DISABLE ROW LEVEL SECURITY;

-- 3. Content Topics — topic-level dedup
CREATE TABLE IF NOT EXISTS content_topics (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT UNIQUE NOT NULL,
  player_name TEXT,
  event_type TEXT,
  first_covered_at TIMESTAMPTZ DEFAULT now(),
  times_covered INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE content_topics DISABLE ROW LEVEL SECURITY;

-- 4. Seed Masters tournament facts
INSERT INTO tournament_facts (id, name, course, par, location, tour, defending_champion, defending_score, course_record, notable_history, purse, key_stats, course_fit)
VALUES ('masters-2026', 'The Masters', 'Augusta National Golf Club', 72, 'Augusta, Georgia', 'pga',
  'Rory McIlroy', '-11 (277)',
  '63 by Nick Price (1986) and Greg Norman (1996)',
  'Amen Corner (holes 11-13) has decided countless Masters. Augusta rewards patience, course management, and elite iron play. The par 5s are reachable for long hitters. Azalea, Golden Bell, and the 15th are the pivotal stretch.',
  '$20M',
  'SG: Approach, Scrambling, and Par 5 scoring are strongest predictors. Driving distance matters on par 5s.',
  'Favors elite iron players who can shape shots both ways. Augusta greens are the fastest on tour — putting and green reading are critical. Long hitters have advantage on par 5s. Course knowledge from experience matters hugely.'
) ON CONFLICT (id) DO UPDATE SET defending_champion = EXCLUDED.defending_champion, updated_at = now();

-- 5. Seed top player facts (CRITICAL — accurate as of April 2026)
-- These facts are injected into every AI prompt

INSERT INTO player_facts (player_name, world_ranking, current_tour, status, masters_wins, masters_best, us_open_wins, open_wins, pga_champ_wins, total_majors, career_grand_slam, pga_wins, total_wins, age, nationality, recent_notes, hot_topics) VALUES
('Scottie Scheffler', 1, 'pga', 'active', 2, '1st (2022, 2024)', 0, 0, 0, 2, false, 14, 14, 29, 'USA', 'Won 2022 and 2024 Masters. Wife Meredith expecting second child. Arrived at 2026 Masters with 9-day-old son Remy.', 'Withdrew from Houston Open before Masters week. Sleep-deprived new dad narrative heading into Augusta.'),
('Rory McIlroy', 3, 'pga', 'active', 1, '1st (2025)', 1, 1, 2, 5, true, 25, 40, 37, 'Northern Ireland', 'Won 2025 Masters to complete career Grand Slam. Defending Masters champion in 2026. 5-time major champion.', 'Defending at Augusta. Career Grand Slam holder. Going for back-to-back.'),
('Xander Schauffele', 2, 'pga', 'active', 0, 'T2 (2019)', 1, 1, 0, 2, false, 10, 10, 32, 'USA', 'Won 2024 Open Championship and 2024 PGA Championship in same season. Breakthrough major year in 2024.', 'Two majors in 2024. Looking for first Masters.'),
('Jon Rahm', 5, 'liv', 'active', 1, '1st (2023)', 1, 0, 0, 2, false, 7, 12, 31, 'Spain', 'Won 2023 Masters. Joined LIV Golf in late 2023. 2-time major champion.', 'Playing Masters as LIV player. Won Masters in 2023.'),
('Brooks Koepka', 15, 'liv', 'active', 0, 'T2 (2019)', 2, 0, 2, 4, false, 3, 10, 36, 'USA', 'Joined LIV Golf. 4-time major champion. Won PGA Championship 2023.', 'LIV player at Masters.'),
('Collin Morikawa', 8, 'pga', 'active', 0, 'T5 (2024)', 0, 1, 1, 2, false, 6, 6, 29, 'USA', 'Won 2021 Open Championship and 2020 PGA Championship. Elite iron player.', 'Playing 2026 Masters with ongoing back injury.'),
('Jordan Spieth', 18, 'pga', 'active', 1, '1st (2015)', 1, 1, 0, 3, false, 13, 13, 32, 'USA', 'Won 2015 Masters at 21. 3-time major champion. Completed career Grand Slam in 2017 at Open Championship.', 'Career Grand Slam holder. Looking to recapture form.'),
('Viktor Hovland', 12, 'pga', 'active', 0, 'T5 (2023)', 0, 0, 0, 0, false, 6, 9, 28, 'Norway', 'Won FedEx Cup 2023. Looking for first major.', null),
('Tommy Fleetwood', 14, 'pga', 'active', 0, 'T8 (2023)', 0, 0, 0, 0, false, 2, 8, 35, 'England', 'Multiple Ryder Cup appearances. Elite ball-striker.', null),
('Patrick Cantlay', 9, 'pga', 'active', 0, 'T9 (2019)', 0, 0, 0, 0, false, 8, 8, 34, 'USA', 'Won 2021 FedEx Cup. Known for slow play. Consistent at majors.', null),
('Hideki Matsuyama', 16, 'pga', 'active', 1, '1st (2021)', 0, 0, 0, 1, false, 10, 10, 34, 'Japan', 'Won 2021 Masters. First Japanese male major champion.', null),
('Tony Finau', 20, 'pga', 'active', 0, 'T5 (2019)', 0, 0, 0, 0, false, 5, 5, 36, 'USA', 'Multiple PGA Tour wins. Powerful ball-striker.', null),
('Justin Thomas', 17, 'pga', 'active', 0, 'T4 (2020)', 0, 0, 1, 1, false, 15, 15, 33, 'USA', 'Won 2022 PGA Championship in playoff. 15 PGA Tour wins.', null),
('Ludvig Aberg', 6, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 3, 3, 26, 'Sweden', 'Fastest rise in golf history. Won RSM Classic 2023, multiple wins since. Elite power game.', 'Young star. One of the favorites at 2026 Masters.'),
('Tiger Woods', 800, 'pga', 'inactive', 5, '1st (1997,2001,2002,2005,2019)', 3, 3, 4, 15, true, 82, 82, 50, 'USA', '15-time major champion. Most wins in PGA Tour history (82). Limited schedule due to injuries. DUI arrest in 2026 casting shadow over career.', 'DUI arrest 2026. Not playing 2026 Masters. Career in serious question.'),
('Phil Mickelson', 60, 'liv', 'active', 3, '1st (2004,2006,2010)', 0, 1, 1, 6, false, 45, 57, 55, 'USA', '6-time major champion. 3-time Masters champion. Joined LIV Golf 2022.', 'Withdrew from 2026 Masters citing personal health matter. First Masters without Tiger or Phil since 1994.'),
('Bryson DeChambeau', 10, 'liv', 'active', 0, 'T5 (2024)', 1, 0, 0, 1, false, 6, 10, 32, 'USA', 'Won 2020 US Open. LIV Golf star. Known for distance and analytics.', 'LIV player. Social media star.'),
('Rickie Fowler', 50, 'pga', 'active', 0, 'T5 (2018)', 0, 0, 0, 0, false, 6, 6, 37, 'USA', 'Fan favorite. Won Rocket Mortgage Classic 2023 after long drought.', 'Injury concerns heading into 2026.'),
('Shane Lowry', 22, 'pga', 'active', 0, 'T6 (2023)', 0, 1, 0, 1, false, 5, 10, 39, 'Ireland', 'Won 2019 Open Championship at Royal Portrush. Major champion.', null),
('Matt Fitzpatrick', 25, 'pga', 'active', 0, 'T13 (2023)', 1, 0, 0, 1, false, 3, 10, 31, 'England', 'Won 2022 US Open at Brookline. Precision player.', null),
('Sam Burns', 24, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 5, 5, 29, 'USA', 'Multiple PGA Tour winner. Rising star.', null),
('Wyndham Clark', 13, 'pga', 'active', 0, null, 1, 0, 0, 1, false, 3, 3, 32, 'USA', 'Won 2023 US Open. Breakthrough year in 2023.', null),
('Sahith Theegala', 11, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 2, 2, 28, 'USA', 'Fan favorite. Won first PGA Tour event in 2024. Known for exciting play style.', null),
('Max Homa', 19, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 5, 5, 35, 'USA', 'Five-time PGA Tour winner. Known for Twitter personality.', null),
('Robert MacIntyre', 30, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 2, 5, 29, 'Scotland', 'Won first PGA Tour event in 2024. Scottish links background.', null),
('Cameron Smith', 25, 'liv', 'active', 1, '1st (2022)', 0, 1, 0, 2, false, 5, 12, 32, 'Australia', 'Won 2022 Open Championship and 2022 Players Championship. Joined LIV.', 'Playing Masters as LIV player.'),
('Sungjae Im', 21, 'pga', 'active', 0, 'T2 (2020)', 0, 0, 0, 0, false, 4, 4, 28, 'South Korea', 'Iron man of golf. Plays nearly every week. Nearly won 2020 Masters.', null),
('Tom Kim', 7, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 4, 4, 23, 'South Korea', 'Youngest player in top 10. Multiple PGA Tour wins. K-pop energy on tour.', null),
('Patrick Reed', 70, 'pga', 'active', 1, '1st (2018)', 0, 0, 0, 1, false, 9, 9, 35, 'USA', 'Won 2018 Masters. Controversial figure. Returned to PGA Tour from LIV.', 'Returned from LIV. Controversial past. Playing 2026 Masters.'),
('Dustin Johnson', 100, 'liv', 'active', 1, '1st (2020)', 1, 0, 0, 2, false, 24, 29, 41, 'USA', 'Won 2020 Masters at -20. 2-time major champion. LIV Golf captain.', 'LIV player. Former world #1.'),
('J.J. Spaun', 80, 'pga', 'active', 0, null, 0, 0, 0, 0, false, 2, 2, 34, 'USA', 'Won 2022 Valero Texas Open. Won 2026 Valero Texas Open at -17. Back-to-back Texas Open wins.', 'Just won 2026 Texas Open heading into Masters week.')
ON CONFLICT (player_name) DO UPDATE SET
  world_ranking = EXCLUDED.world_ranking,
  current_tour = EXCLUDED.current_tour,
  status = EXCLUDED.status,
  masters_wins = EXCLUDED.masters_wins,
  masters_best = EXCLUDED.masters_best,
  us_open_wins = EXCLUDED.us_open_wins,
  open_wins = EXCLUDED.open_wins,
  pga_champ_wins = EXCLUDED.pga_champ_wins,
  total_majors = EXCLUDED.total_majors,
  career_grand_slam = EXCLUDED.career_grand_slam,
  pga_wins = EXCLUDED.pga_wins,
  total_wins = EXCLUDED.total_wins,
  age = EXCLUDED.age,
  nationality = EXCLUDED.nationality,
  recent_notes = EXCLUDED.recent_notes,
  hot_topics = EXCLUDED.hot_topics,
  updated_at = now();
