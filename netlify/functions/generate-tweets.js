// Scrape ALL golf sources, generate tweets from the freshest content
const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTY0NDAsImV4cCI6MjA5MDk3MjQ0MH0.FAXp2t0zaHlm1W7aaut72btMilrYPy33XO3p8MfyYlo';

// Well-known players for headshot matching (name → ESPN ID)
async function uploadTweetImage(text) {
  try {
    const headline = text.slice(0, 120);
    const url = `https://tourfeed.co/.netlify/functions/generate-image?type=hot_take&quote=${encodeURIComponent(headline)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    const fname = 'tweet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.png';
    const upRes = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/images/' + fname, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs',
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: buf,
    });
    if (!upRes.ok) return null;
    return 'https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/public/images/' + fname;
  } catch(e) { return null; }
}

async function postDraft(text, source) {
  const imageUrl = await uploadTweetImage(text);
  // Post directly to Supabase — skip draft-tweet function's extra dedup layers
  try {
    const res = await fetch(SB_URL + '/rest/v1/content_drafts', {
      method: 'POST',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        type: 'tweet_reaction',
        body: text.slice(0, 280),
        source_event: source,
        image_url: imageUrl,
        status: 'pending',
        created_at: new Date().toISOString(),
      }),
    });
    if (res.ok) return { success: true };
    return null;
  } catch(e) { return null; }
}

// Scrape RSS feed
function parseRSS(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const titleM = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() : '';
    if (title && title.length > 15) items.push(title);
  }
  return items;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    const allHeadlines = [];

    // 1. ESPN Golf
    try {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=10');
      if (r.ok) (await r.json()).articles?.forEach(a => { if (a.headline) allHeadlines.push({ text: a.headline, src: 'ESPN' }); });
    } catch(e) {}

    // 2. Golf Digest RSS
    try {
      const r = await fetch('https://www.golfdigest.com/feed/rss', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'Golf Digest' }));
    } catch(e) {}

    // 3. PGA Tour RSS
    try {
      const r = await fetch('https://www.pgatour.com/rss/news', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'PGA Tour' }));
    } catch(e) {}

    // 4. Golf Channel RSS
    try {
      const r = await fetch('https://www.golfchannel.com/rss/golf-central', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'Golf Channel' }));
    } catch(e) {}

    // 5. Google News — golf
    try {
      const r = await fetch('https://news.google.com/rss/search?q=golf+masters+pga&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'Google News' }));
    } catch(e) {}

    // 6. Twitter — what people are actually talking about RIGHT NOW
    if (bearer) {
      const searches = ['masters golf', 'pga tour', 'augusta national', 'golf news'];
      for (const q of searches) {
        try {
          const url = new URL('https://api.twitter.com/2/tweets/search/recent');
          url.searchParams.set('query', q + ' -is:retweet lang:en');
          url.searchParams.set('max_results', '10');
          url.searchParams.set('start_time', new Date(Date.now() - 60 * 60 * 1000).toISOString()); // last hour only
          url.searchParams.set('tweet.fields', 'public_metrics');
          const r = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${bearer}` } });
          if (r.ok) {
            (await r.json()).data?.filter(t => (t.public_metrics?.like_count || 0) >= 3).forEach(t => {
              const clean = (t.text || '').replace(/https?:\/\/\S+/g, '').trim();
              if (clean.length > 20) allHeadlines.push({ text: clean, src: 'Twitter' });
            });
          }
        } catch(e) {}
      }
    }

    if (allHeadlines.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No headlines from any source' }) };
    }

    // Dedup headlines
    const seen = new Set();
    const unique = allHeadlines.filter(h => {
      const key = h.text.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Get existing drafts to avoid dupes
    // Only check recent TWEET drafts for dedup — skip articles (they contain too many common words)
    let recentTexts = [];
    try {
      const dRes = await fetch(SB_URL + '/rest/v1/content_drafts?type=like.tweet*&status=eq.pending&order=created_at.desc&limit=15&select=body', {
        headers: { 'apikey': SB_ANON }
      });
      if (dRes.ok) {
        recentTexts = (await dRes.json()).map(d => (d.body || '').toLowerCase());
      }
    } catch(e) {}

    // Player facts for accurate context
    let playerFactsContext = '';
    try {
      const pfRes = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/player_facts?select=player_name,world_ranking,total_majors,masters_wins,career_grand_slam,recent_notes,hot_topics&limit=30', {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs' }
      });
      if (pfRes.ok) {
        const pf = await pfRes.json();
        playerFactsContext = '\n\nPLAYER FACTS — DO NOT CONTRADICT:\n' + pf.map(f => {
          let s = f.player_name + ': #' + (f.world_ranking||'?') + ', ' + f.total_majors + ' majors';
          if (f.masters_wins) s += ', ' + f.masters_wins + 'x Masters champ';
          if (f.career_grand_slam) s += ', Career Grand Slam';
          if (f.recent_notes) s += '. ' + f.recent_notes;
          if (f.hot_topics) s += ' ' + f.hot_topics;
          return s;
        }).join('\n');
      }
    } catch(e) {}

    // Tournament context
    let context = '';
    try {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
      if (r.ok) {
        const d = await r.json();
        const evt = d.events?.[0];
        if (evt) {
          const comp = evt.competitions?.[0];
          const top3 = (comp?.competitors || []).slice(0, 3);
          context = `Current: ${evt.shortName || evt.name}. Status: ${comp?.status?.type?.description}. ` +
            (top3.length > 0 ? 'Top 3: ' + top3.map(p => `${p.athlete?.displayName} (${p.score})`).join(', ') : '');
        }
      }
    } catch(e) {}

    // Feed ALL headlines to AI — let it pick the most interesting ones
    const headlineList = unique.slice(0, 20).map((h, i) => `${i+1}. [${h.src}] ${h.text}`).join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: `You generate original tweets from fresh golf news. Pick the most INTERESTING, DIVERSE headlines and react to them. Each tweet should be about a completely DIFFERENT topic.

VOICE: Golf fan in the group chat. Foreplay meets a sharp handicapper.

FACTS: Year is 2026. Do NOT state stats/records unless confirmed in PLAYER FACTS below.
${playerFactsContext}

CRITICAL: Rory McIlroy WON the 2025 Masters. He is DEFENDING champion. Career Grand Slam holder. NEVER say he is "chasing" his first Masters.

RULES:
- ZERO emojis. ZERO hashtags. No exceptions.
- NEVER link to anything or mention TourFeed
- Each tweet = DIFFERENT topic. Cover the full range of what's happening.
- 1-2 sentences. Short and punchy.
- Be opinionated. Take stances. Be funny when it fits.

VARIETY IS MANDATORY. Each tweet must use a COMPLETELY DIFFERENT sentence structure.
BANNED patterns: "That's either [A] or [B]", "That's the kind of [X] that [Y]", "Respect the [noun]"
MIX these: Questions ("How is nobody talking about...?"), Declarations ("Schauffele at +350 is a steal."), Fragments ("Scheffler. Bogey-free. Again."), Comparisons ("Last time someone opened like this, they won by 5."), Challenges ("Name a player more locked in. You can't."), One-liners ("Phil at +8. Pain."), Predictions ("Hovland wins this. Calling it now.")

CRITICAL SAFETY:
- NEVER state a player was arrested, charged, or involved in legal trouble unless the source headline EXPLICITLY states it
- NEVER speculate about criminal activity, substance abuse, or personal scandals
- If a player is absent, say "not in the field" — do not speculate why unless official reason is in the headline
- When in doubt about any claim, use softer language or skip entirely

${context}`,
        messages: [{
          role: 'user',
          content: `Latest golf headlines:\n\n${headlineList}\n\nPick the 5 most interesting/diverse topics and write one original tweet per topic. Each tweet MUST use a different sentence structure.\n\nReturn ONLY a JSON array of objects:\n[{"source":"headline you're reacting to","tweet":"your original tweet"}]`
        }],
      }),
    });

    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'AI failed' }) };

    let tweets;
    let rawText = '';
    try {
      rawText = (await res.json()).content?.[0]?.text || '';
      tweets = JSON.parse(rawText.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed', raw: rawText.slice(0, 300) }) };
    }

    if (!Array.isArray(tweets)) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Not array', raw: rawText.slice(0, 300) }) };

    // If AI returned empty array, report it
    if (tweets.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ success: true, drafted: 0, reason: 'AI returned empty array', sourcesScraped: [...new Set(allHeadlines.map(h=>h.src))], totalHeadlines: allHeadlines.length }) };

    const drafted = [];
    for (const item of tweets) {
      // Support both old format (string) and new format ({source, tweet})
      const tweet = typeof item === 'string' ? item : item?.tweet;
      const source = typeof item === 'string' ? 'generate-original' : (item?.source || 'generate-original');
      if (!tweet || tweet.length < 15) continue;
      if (/don't have|can't see|I cannot|data limitation|broken leaderboard|no idea who|unknown.*winner|unnamed|mystery.*champion/i.test(tweet)) continue;
      // Dedup against existing drafts
      const words = tweet.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      // Only flag as dupe if 70%+ words match (was 50% — too aggressive)
      let isDupe = recentTexts.some(r => {
        const overlap = words.filter(w => r.includes(w)).length;
        return overlap >= words.length * 0.7;
      });
      if (isDupe) continue;

      const result = await postDraft(tweet, source);
      if (result?.success) {
        drafted.push(tweet);
        recentTexts.push(tweet.toLowerCase());
      }
    }

    // Notification
    if (drafted.length > 0) {
      try {
        await fetch('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'New Tweets Ready', 'Priority': '3' },
          body: drafted.length + ' tweet' + (drafted.length > 1 ? 's' : '') + ' ready for review',
        });
      } catch(e) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify({
      success: true,
      drafted: drafted.length,
      sourcesScraped: [...new Set(unique.map(h => h.src))],
      totalHeadlines: unique.length,
      tweets: drafted,
    })};

  } catch (err) {
    console.error('Generate tweets error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
