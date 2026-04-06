// Scrape ALL golf sources, generate tweets from the freshest content

// Well-known players for headshot matching (name → ESPN ID)
const KNOWN_PLAYERS = {
  'tiger':462,'woods':462,'tiger woods':462,
  'rory':3448,'mcilroy':3448,'rory mcilroy':3448,
  'scheffler':9780,'scottie':9780,'scottie scheffler':9780,
  'schauffele':10046,'xander':10046,'xander schauffele':10046,
  'rahm':9527,'jon rahm':9527,
  'koepka':10592,'brooks':10592,'brooks koepka':10592,
  'spieth':5765,'jordan spieth':5765,
  'morikawa':11098,'collin morikawa':11098,
  'hovland':4364873,'viktor hovland':4364873,
  'fleetwood':5539,'tommy fleetwood':5539,
  'lowry':4587,'shane lowry':4587,
  'cantlay':10404,'patrick cantlay':10404,
  'matsuyama':4375627,'hideki':4375627,
  'fowler':3702,'rickie':3702,'rickie fowler':3702,
  'clark':4686009,'wyndham clark':4686009,
  'burns':9726,'sam burns':9726,
  'finau':9478,'tony finau':9478,
  'thomas':4848,'justin thomas':4848,
  'aberg':4375972,'ludvig':4375972,'ludvig aberg':4375972,
  'macintyre':11378,'robert macintyre':11378,
  'spaun':10166,'j.j. spaun':10166,
  'theegala':10980,'sahith theegala':10980,
  'homa':8973,'max homa':8973,
  'kim':7081,'si woo kim':7081,'tom kim':4375971,
  'fitzpatrick':9037,'matt fitzpatrick':9037,
  'sungjae':9508,'sungjae im':9508,
  'cameron smith':9131,'cam smith':9131,
  'dustin johnson':3448,'dj':3027,
  'dechambeau':10046,'bryson':10046,
};

function findPlayerPhotos(text) {
  const lower = (text || '').toLowerCase();
  const found = [];
  const usedIds = new Set();
  for (const [name, id] of Object.entries(KNOWN_PLAYERS)) {
    if (lower.includes(name) && !usedIds.has(id)) {
      found.push(`https://a.espncdn.com/i/headshots/golf/players/full/${id}.png`);
      usedIds.add(id);
      if (found.length >= 2) break;
    }
  }
  return found.join(',');
}

async function uploadTweetImage(text) {
  try {
    const headline = text.slice(0, 80);
    const photo = findPlayerPhotos(text);
    const photoParam = photo ? `&photo=${encodeURIComponent(photo)}` : '';
    const url = `https://tourfeed.co/.netlify/functions/generate-image?type=hot_take&quote=${encodeURIComponent(headline)}${photoParam}`;
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
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source, image_url: imageUrl }),
  });
  return res.ok ? await res.json() : null;
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
    let recentTexts = [];
    try {
      const dRes = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet');
      if (dRes.ok) recentTexts = ((await dRes.json()).drafts || []).map(d => d.text.toLowerCase());
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

FACTS:
- Rory McIlroy: defending Masters champion (won 2025), career Grand Slam holder
- Year: 2026
- Don't state stats/records you're unsure about

RULES:
- ZERO emojis. ZERO hashtags. No exceptions.
- NEVER link to anything or mention TourFeed
- Each tweet = DIFFERENT topic. Cover the full range of what's happening.
- 1-2 sentences. Short and punchy.
- Slang fine. "Built different." "Down bad." "That's filthy."
- Be opinionated. Take stances. Be funny when it fits.
- Cover: player news, tournament updates, equipment, injuries, hot takes, picks, behind the scenes, crowds, course conditions — EVERYTHING golf
- Never generic. Always specific.

${context}`,
        messages: [{
          role: 'user',
          content: `Latest golf headlines from across the internet:\n\n${headlineList}\n\nPick the 5 most interesting/diverse topics and write an original tweet for each. Different angle per tweet.\n\nReturn ONLY a JSON array of objects with the source headline and your tweet:\n[{"source":"the headline you're reacting to","tweet":"your original tweet"},{"source":"...","tweet":"..."}]`
        }],
      }),
    });

    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'AI failed' }) };

    let tweets;
    try {
      const text = (await res.json()).content?.[0]?.text || '';
      tweets = JSON.parse(text.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) };
    }

    if (!Array.isArray(tweets)) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Not array' }) };

    const drafted = [];
    for (const item of tweets) {
      // Support both old format (string) and new format ({source, tweet})
      const tweet = typeof item === 'string' ? item : item?.tweet;
      const source = typeof item === 'string' ? 'generate-original' : (item?.source || 'generate-original');
      if (!tweet || tweet.length < 15) continue;
      if (/don't have|can't see|I cannot|data limitation|broken leaderboard|no idea who|unknown.*winner|unnamed|mystery.*champion/i.test(tweet)) continue;
      // Dedup against existing drafts
      const words = tweet.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      let isDupe = recentTexts.some(r => {
        const overlap = words.filter(w => r.includes(w)).length;
        return overlap >= words.length * 0.5;
      });
      if (isDupe) continue;

      const result = await postDraft(tweet, source);
      if (result?.success) {
        drafted.push(tweet);
        recentTexts.push(tweet.toLowerCase());
      }
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
