// Scrape ALL golf sources, generate tweets from the freshest content

async function postDraft(text, source) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source }),
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
          content: `Latest golf headlines from across the internet:\n\n${headlineList}\n\nPick the 5 most interesting/diverse topics and write an original tweet for each. Different angle per tweet.\n\nReturn ONLY a JSON array:\n["tweet 1","tweet 2","tweet 3","tweet 4","tweet 5"]`
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
    for (const tweet of tweets) {
      if (!tweet || tweet.length < 15 || /don't have|can't see|I cannot/i.test(tweet)) continue;
      // Dedup against existing drafts
      const words = tweet.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      let isDupe = recentTexts.some(r => {
        const overlap = words.filter(w => r.includes(w)).length;
        return overlap >= words.length * 0.5;
      });
      if (isDupe) continue;

      const result = await postDraft(tweet, 'generate-original');
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
