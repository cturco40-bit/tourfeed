// Scrape ALL golf sources, generate tweets from the freshest content
const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SB_KEY;

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

// Well-known players for headshot matching (name → ESPN ID)
async function uploadTweetImage(text) {
  try {
    // Only pass first 4-5 words for the image — image generator shows tag + short headline
    const headline = text.split(/\s+/).slice(0, 5).join(' ');
    const url = `https://tourfeed.co/.netlify/functions/generate-image?type=hot_take&headline=${encodeURIComponent(headline)}`;
    const res = await ft(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    const fname = 'tweet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.png';
    const upRes = await ft('https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/images/' + fname, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SB_KEY,
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
  const imageUrl = null; // Images added manually via admin editor
  // Post directly to Supabase — skip draft-tweet function's extra dedup layers
  try {
    const res = await ft(SB_URL + '/rest/v1/content_drafts', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        type: 'tweet_content',
        body: text.length > 280 ? text.slice(0, text.lastIndexOf(' ', 280)) : text,
        image_headline: text.split(/[.!?]/)[0].split(/\s+/).slice(0, 7).join(' '),
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
    // CHECK 1: If 5+ pending tweet drafts exist, skip this run entirely
    let pendingCount = 0;
    try {
      const pendingRes = await ft(SB_URL + '/rest/v1/content_drafts?type=like.tweet*&status=eq.pending&select=id', {
        headers: { 'apikey': SB_KEY }
      });
      if (pendingRes.ok) pendingCount = (await pendingRes.json()).length;
    } catch(e) {}
    if (pendingCount >= 5) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Already ' + pendingCount + ' pending tweet drafts — skipping run' }) };
    }

    // CHECK 2: Only generate tweets that promote PUBLISHED articles
    let publishedArticles = [];
    try {
      const artRes = await ft(SB_URL + '/rest/v1/articles?select=id,title,slug,tag&order=published_at.desc&limit=10', {
        headers: { 'apikey': SB_KEY }
      });
      if (artRes.ok) publishedArticles = await artRes.json();
    } catch(e) {}
    if (!publishedArticles.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No published articles to promote' }) };
    }

    const allHeadlines = [];

    // 1. ESPN Golf
    try {
      const r = await ft('https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=10');
      if (r.ok) (await r.json()).articles?.forEach(a => { if (a.headline) allHeadlines.push({ text: a.headline, src: 'ESPN' }); });
    } catch(e) {}

    // 2. Golf Digest RSS
    try {
      const r = await ft('https://www.golfdigest.com/feed/rss', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'Golf Digest' }));
    } catch(e) {}

    // 3. PGA Tour RSS
    try {
      const r = await ft('https://www.pgatour.com/rss/news', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'PGA Tour' }));
    } catch(e) {}

    // 4. Golf Channel RSS
    try {
      const r = await ft('https://www.golfchannel.com/rss/golf-central', { headers: { 'User-Agent': 'TourFeed/1.0' } });
      if (r.ok) parseRSS(await r.text()).forEach(t => allHeadlines.push({ text: t, src: 'Golf Channel' }));
    } catch(e) {}

    // 5. Google News — golf
    try {
      const r = await ft('https://news.google.com/rss/search?q=golf+masters+pga&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': 'TourFeed/1.0' } });
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
          const r = await ft(url.toString(), { headers: { 'Authorization': `Bearer ${bearer}` } });
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

    // Filter past tournaments — only Masters or breaking news
    const PAST = /puerto rico|texas open|valero|houston open|valspar|arnold palmer|players championship|genesis|phoenix|pebble beach|farmers|torrey pines|american express/i;
    const currentHL = allHeadlines.filter(h => !PAST.test(h.text) || /masters|augusta/i.test(h.text));

    // Dedup headlines
    const seen = new Set();
    const unique = currentHL.filter(h => {
      const key = h.text.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Get existing drafts to avoid dupes
    // Only check recent TWEET drafts for dedup — skip articles (they contain too many common words)
    let recentTexts = [];
    try {
      const dRes = await ft(SB_URL + '/rest/v1/content_drafts?type=like.tweet*&status=eq.pending&order=created_at.desc&limit=15&select=body', {
        headers: { 'apikey': SB_ANON }
      });
      if (dRes.ok) {
        recentTexts = (await dRes.json()).map(d => (d.body || '').toLowerCase());
      }
    } catch(e) {}

    // Player facts for accurate context
    let playerFactsContext = '';
    try {
      const pfRes = await ft('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/player_facts?select=player_name,world_ranking,total_majors,masters_wins,career_grand_slam,recent_notes,hot_topics&limit=30', {
        headers: { 'apikey': SB_KEY }
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
      const r = await ft('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
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

    // Feed headlines + published articles to AI — tweets must promote real articles
    const headlineList = unique.slice(0, 20).map((h, i) => `${i+1}. [${h.src}] ${h.text}`).join('\n');
    const articleList = publishedArticles.map(a => `- "${a.title}" → tourfeed.co/article/${a.slug}`).join('\n');

    // Fetch current picks — tweets must only reference these players
    var picksContext = '';
    try {
      var tweetPicks = await ft(SB_URL + '/rest/v1/betting_picks?order=created_at.desc&limit=20', {
        headers: { 'apikey': SB_KEY }
      });
      if (tweetPicks.ok) {
        var tpData = await tweetPicks.json();
        if (tpData.length > 0) {
          picksContext = '\n\nOUR CURRENT PICKS (ONLY reference these players as betting recommendations):\n' + tpData.map(function(p) {
            return (p.edge_label || '') + ': ' + (p.player_name || p.pick || '') + ' ' + (p.odds || '');
          }).join('\n') + '\n\nCRITICAL: You may ONLY reference players from OUR CURRENT PICKS as betting recommendations.';
        }
      }
    } catch(e) {}

    const res = await ft('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: `CRITICAL PLAYER FACTS — NEVER CONTRADICT THESE: Scottie Scheffler IS playing the 2026 Masters. He did NOT withdraw. Tiger Woods is NOT playing. Phil Mickelson is NOT playing. Rory McIlroy IS the defending champion — won 2025 Masters, Career Grand Slam holder.

YOU ARE A STAFF WRITER ON DEADLINE. YOUR ONLY JOB IS TO PRODUCE THE CONTENT REQUESTED. You do not ask questions. You do not flag conflicts. You do not mention contradictions. You write the content.

ZERO emojis. ZERO hashtags. You are TourFeed's social account promoting our PUBLISHED articles.
Each tweet MUST promote one of the published articles listed below — link to its specific URL.
1-2 sentences. Always end with the article's tourfeed.co URL.
NEVER generate standalone reactions or hot takes without linking to a published article.
${playerFactsContext}
${context}${picksContext}`,
        messages: [{
          role: 'user',
          content: `Our published articles:\n${articleList}\n\nLatest golf headlines for context:\n${headlineList}\n\nWrite exactly 2 tweets. Each tweet MUST promote one of our published articles above and include its URL. Tie current news to the article's topic to make it timely. Each tweet MUST use a different sentence structure.\n\nReturn ONLY a JSON array of objects:\n[{"source":"article title you're promoting","tweet":"your tweet ending with the article URL","article_url":"tourfeed.co/article/slug"}]`
        }],
      }),
    }, 25000);

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
    const MAX_TWEETS = 2;
    const articleSlugs = publishedArticles.map(a => a.slug);
    for (const item of tweets) {
      if (drafted.length >= MAX_TWEETS) break;
      // Support both old format (string) and new format ({source, tweet})
      const tweet = typeof item === 'string' ? item : item?.tweet;
      const source = typeof item === 'string' ? 'generate-original' : (item?.source || 'generate-original');
      const articleUrl = typeof item === 'object' ? item?.article_url : null;
      if (!tweet || tweet.length < 15) continue;
      // Must contain a tourfeed.co link to a real published article
      if (!tweet.includes('tourfeed.co/article/')) continue;
      // Verify the article URL references a real published article
      const urlMatch = tweet.match(/tourfeed\.co\/article\/([a-z0-9-]+)/);
      if (urlMatch && !articleSlugs.some(s => urlMatch[1].includes(s) || s.includes(urlMatch[1]))) continue;
      if (/don't have|can't see|I cannot|data limitation|broken leaderboard|no idea who|unknown.*winner|unnamed|mystery.*champion/i.test(tweet)) continue;
      // Dedup against existing drafts
      const words = tweet.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
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
        await ft('https://ntfy.sh/tourfeed-alerts', {
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
