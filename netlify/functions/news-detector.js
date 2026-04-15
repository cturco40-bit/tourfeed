// news-detector.js — Monitors RSS feeds for golf news events, generates original articles via Claude Haiku, stores drafts in Supabase

const RSS_SOURCES = [
  // Tier 1 — process every run
  { name: 'ESPN Golf', type: 'api', url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=15', maxAge: 60, tier: 1 },
  { name: 'PGA Tour', type: 'rss', url: 'https://www.pgatour.com/rss/news', maxAge: 120, tier: 1 },
  { name: 'Golf Channel', type: 'rss', url: 'https://www.golfchannel.com/rss/golf-central', maxAge: 120, tier: 1 },
  { name: 'Golfweek', type: 'rss', url: 'https://www.golfweek.com/feed', maxAge: 120, tier: 1 },
  { name: 'BBC Sport Golf', type: 'rss', url: 'https://feeds.bbci.co.uk/sport/golf/rss.xml', maxAge: 120, tier: 1 },
  { name: 'Sky Sports Golf', type: 'rss', url: 'https://www.skysports.com/rss/12040', maxAge: 120, tier: 1 },
  { name: 'The Athletic Golf', type: 'rss', url: 'https://theathletic.com/rss/golf', maxAge: 120, tier: 1 },
  { name: 'DP World Tour', type: 'rss', url: 'https://www.europeantour.com/rss', maxAge: 120, tier: 1 },
  // Tier 2 — process every 3rd run
  { name: 'Golf Digest', type: 'rss', url: 'https://www.golfdigest.com/feed/rss', maxAge: 180, tier: 2 },
  { name: 'No Laying Up', type: 'rss', url: 'https://nolayingup.com/feed', maxAge: 180, tier: 2 },
  { name: 'The Guardian Golf', type: 'rss', url: 'https://www.theguardian.com/sport/golf/rss', maxAge: 180, tier: 2 },
  { name: 'Google News Golf', type: 'rss', url: 'https://news.google.com/rss/search?q=masters+golf+2026&hl=en-US&gl=US&ceid=US:en', maxAge: 120, tier: 2 },
  { name: 'Golf.com', type: 'rss', url: 'https://golf.com/feed', maxAge: 180, tier: 2 },
  { name: 'Golf Magic', type: 'rss', url: 'https://www.golfmagic.com/rss', maxAge: 180, tier: 2 },
  { name: 'The Telegraph Golf', type: 'rss', url: 'https://www.telegraph.co.uk/golf/rss', maxAge: 180, tier: 2 },
  { name: 'Golf Monthly', type: 'rss', url: 'https://www.golfmonthly.com/feed', maxAge: 180, tier: 2 },
  { name: 'Todays Golfer', type: 'rss', url: 'https://www.todays-golfer.com/feed', maxAge: 180, tier: 2 },
  { name: 'Bunkered', type: 'rss', url: 'https://www.bunkered.co.uk/feed', maxAge: 180, tier: 2 },
  { name: 'LPGA Tour', type: 'rss', url: 'https://www.lpga.com/rss', maxAge: 180, tier: 2 },
];

// ---------- Timeout helper ----------
const ND_SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ND_SB_KEY;
function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

// ---------- Supabase helper ----------
async function sb(path, method, body) {
  const hdrs = { 'apikey': ND_SB_KEY, 'Authorization': 'Bearer ' + ND_SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await ft('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/' + path, {
    method: method || 'GET',
    headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!method || method === 'GET') { try { const d = await res.json(); return Array.isArray(d) ? d : []; } catch (e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch (e) { return []; } }
  return res.ok;
}

// ---------- Generate PNG + upload to Supabase Storage ----------
async function uploadImage(tag, headline) {
  try {
    const base = 'https://tourfeed.co/.netlify/functions/generate-image';
    const url = `${base}?type=article_header&tag=${encodeURIComponent(tag)}&headline=${encodeURIComponent(headline)}&format=png`;
    const res = await ft(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    const filename = 'news-' + Date.now() + '.png';
    const upRes = await ft('https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/images/' + filename, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ND_SB_KEY,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: buf,
    });
    if (!upRes.ok) return null;
    return 'https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/public/images/' + filename;
  } catch(e) { return null; }
}

// ---------- Simple RSS parser (regex, no npm) ----------
function parseRSS(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const titleM = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const descM = block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim() : '';
    const desc = descM ? descM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim() : '';
    if (title && title.length > 15) items.push({ title, desc: desc.slice(0, 200) });
  }
  return items;
}

// ---------- Story classification ----------
function classifyStory(title) {
  var t = (title || '').toLowerCase();
  if (t.includes('withdraw') || t.includes('injury') || t.includes('disqualif') || t.includes('dq') || t.includes('rules violation') || t.includes('suspended play') || t.includes('arrested')) return 'breaking';
  if (t.includes('leads') || t.includes('wins') || t.includes('champion') || t.includes('victory') || t.includes('shoots') || t.includes('fires') || t.includes('hole in one') || t.includes('eagle') || t.includes('albatross') || t.includes('course record')) return 'score';
  if (t.includes('rumor') || t.includes('report:') || t.includes('sources say') || t.includes('could join') || t.includes('expected to') || t.includes('may leave') || t.includes('linked to')) return 'rumor';
  if (t.includes('odds') || t.includes('betting') || t.includes('picks') || t.includes('favorite')) return 'betting';
  return 'news';
}
var STORY_AGE_LIMITS = { breaking: 60, score: 120, rumor: 120, betting: 180, news: 180 };

// ---------- ESPN JSON parser ----------
function parseESPN(data) {
  return (data.articles || []).map(a => ({
    title: a.headline || '',
    desc: (a.description || '').slice(0, 200),
  })).filter(i => i.title && i.title.length > 15);
}

// ---------- Content hash ----------
function hashText(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3).sort().join(' ');
  let hash = 0;
  for (let i = 0; i < words.length; i++) hash = ((hash << 5) - hash + words.charCodeAt(i)) | 0;
  return 'h' + Math.abs(hash).toString(36);
}

// ---------- Extract key facts from headline + description ----------
function extractFacts(title, desc) {
  const combined = (title + ' ' + desc).trim();

  // Who: look for capitalized names (2-3 word sequences starting with caps)
  const nameMatches = combined.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || [];
  const who = [...new Set(nameMatches)].slice(0, 3);

  // What: the headline itself is the event
  const what = title;

  // When: look for date-like patterns
  const whenMatch = combined.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|yesterday|this week|this weekend|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*\d{0,2},?\s*\d{0,4}/gi);
  const when = whenMatch ? whenMatch[0].trim() : '';

  return { who, what, when, details: desc };
}

// ---------- Call Claude Haiku to generate original article ----------
async function fetchPlayerFacts() {
  try {
    const r = await ft('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/player_facts?select=player_name,world_ranking,total_majors,masters_wins,masters_best,career_grand_slam,recent_notes,hot_topics&limit=30', {
      headers: { 'apikey': ND_SB_KEY }
    });
    if (!r.ok) return '';
    const pf = await r.json();
    return '\n\nPLAYER FACTS — DO NOT CONTRADICT:\n' + pf.map(f => {
      let s = f.player_name + ': #' + (f.world_ranking||'?') + ', ' + f.total_majors + ' majors';
      if (f.masters_wins) s += ', ' + f.masters_wins + 'x Masters champ';
      if (f.career_grand_slam) s += ', Career Grand Slam';
      if (f.masters_best) s += ', Masters best: ' + f.masters_best;
      if (f.recent_notes) s += '. ' + f.recent_notes;
      return s;
    }).join('\n') + '\n\nCRITICAL: NEVER say a player is "chasing" a major they have already won. Check PLAYER FACTS above.';
  } catch(e) { return ''; }
}

async function generateArticle(facts, apiKey, picksContext) {
  const playerFacts = await fetchPlayerFacts();
  const factsText = `WHO: ${facts.who.join(', ') || 'Unknown'}\nWHAT: ${facts.what}\nWHEN: ${facts.when || 'Recent'}\nDETAILS: ${facts.details || 'No additional details.'}${playerFacts}`;

  const res = await ft('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `TODAY IS ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })} AT ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })} EASTERN TIME.
CRITICAL PLAYER FACTS: Scottie Scheffler IS playing. Tiger Woods is NOT playing. Phil Mickelson is NOT playing. Rory McIlroy IS the defending champion — won 2025 Masters, Career Grand Slam holder.

You are the lead staff writer at TourFeed. Write ORIGINAL analysis based only on the facts provided — never copy source language. 250-350 words. Get to the point. Use HTML <p> tags. Every sentence must earn its place.

BANNED: Augusta rewards precision, wide open tournament, anyone can win, make no mistake, at the end of the day, delve, landscape, paradigm.
HEADLINE FORMAT: Must include a specific player name AND a specific number.
Never mention AI, ESPN, Golf Digest, or any source outlet by name.
If this news story is about fashion, signatures, traditions, culture, collectibles, memorabilia, or anything unrelated to tournament performance or betting — respond with exactly the word SKIP and nothing else.
${playerFacts}`,
      messages: [
        {
          role: 'user',
          content: `Write an original TourFeed article based on these extracted facts:\n\n${factsText}\n\nTWEET RULES:\n- Write exactly 1 tweet that PROMOTES our picks and analysis on the website. Tie the news to a betting angle and drive readers to tourfeed.co for the full breakdown.\n- Example: "Tiger out of Augusta changes the entire outright market. We updated our picks and found value nobody is talking about. tourfeed.co"\n- Always end with "tourfeed.co" or "Full picks at tourfeed.co" or similar CTA.\n- NOT just restating the headline. Create a picks angle.\n- IMPORTANT: If this news article mentions a betting angle, only reference players from this list: ${picksContext}. Never suggest betting on players not in our picks.\n\nVARIETY: Use varied sentence structures. BANNED: "That's either [A] or [B]", "That's the kind of [X]", "Respect the [noun]"\nMIX: questions, fragments, comparisons, predictions, one-liners.\n\nCRITICAL SAFETY:\n- NEVER state a player was arrested, charged, or involved in legal trouble unless source EXPLICITLY states it\n- NEVER speculate about criminal activity, substance abuse, or personal scandals\n- If absent from tournament, say "not in the field" — do not speculate why unless official reason given\n- When in doubt, use softer language or skip the topic\n\nReturn ONLY valid JSON, no markdown fences:\n{"title":"clickbait headline","body":"article HTML with <p> tags","tweets":["curiosity-driving tweet that promotes the article"]}`,
        },
      ],
    }),
  }, 25000);

  if (!res.ok) {
    const errText = await res.text();
    console.error('Anthropic API error:', errText);
    return null;
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Haiku self-rejection — if story is irrelevant it responds with SKIP
  if (text.trim() === 'SKIP' || text.trim().startsWith('SKIP')) {
    console.log('Haiku rejected story as non-relevant');
    return null;
  }

  try {
    const cleaned = text.replace(/```json\s?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e1) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e2) { /* fall through */ }

    // Regex fallback
    const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
    const bodyMatch = text.match(/"body"\s*:\s*"([\s\S]+?)"\s*[,}]/);
    if (bodyMatch) {
      return {
        title: titleMatch ? titleMatch[1] : 'Breaking Golf News',
        body: bodyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        tweets: [],
      };
    }
    return null;
  }
}

// ---------- Fetch all feeds with tier filtering ----------
var _ndRunCount = 0;
async function fetchAllHeadlines() {
  const allItems = [];
  _ndRunCount++;

  // Tier 2 sources only processed every 3rd run
  var activeSources = RSS_SOURCES.filter(function(s) { return s.tier === 1 || _ndRunCount % 3 === 0; });
  console.log('Processing', activeSources.length, '/', RSS_SOURCES.length, 'sources (run #' + _ndRunCount + ')');

  const fetches = activeSources.map(async (source) => {
    try {
      const res = await ft(source.url, {
        headers: {
          'User-Agent': 'TourFeed/1.0 (Golf News Aggregator)',
          'Accept': source.type === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json',
        },
      });

      if (!res.ok) {
        console.error(`${source.name}: HTTP ${res.status}`);
        return;
      }

      let items = [];
      if (source.type === 'api') {
        const data = await res.json();
        items = parseESPN(data);
      } else {
        const xml = await res.text();
        items = parseRSS(xml);
      }

      // Apply per-source maxAge filter
      var maxAge = source.maxAge || 180;
      items.forEach(function(i) {
        i.source = source.name;
        i.maxAge = maxAge;
      });
      allItems.push(...items);
    } catch (err) {
      console.error(`${source.name}: ${err.message}`);
    }
  });

  await Promise.allSettled(fetches);
  return allItems;
}

// ---------- Deduplicate headlines ----------
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    for (const s of seen) {
      if (s === key) return false;
      const words1 = key.split(' ');
      const words2 = s.split(' ');
      const overlap = words1.filter(w => words2.includes(w)).length;
      if (overlap >= Math.min(words1.length, words2.length) * 0.7) return false;
    }
    seen.add(key);
    return true;
  });
}

// ---------- Main handler ----------
async function logRun(status, records, message, durationMs) {
  try {
    await sb('sync_log', 'POST', {
      sync_type: 'news-detector',
      status: status,
      records_processed: records || 0,
      error_message: (message || '').slice(0, 500),
      duration_ms: durationMs || 0,
    });
  } catch(e) { /* swallow */ }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  const started = Date.now();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Daily limit — max 8 news articles per day
  try {
    var ndTodayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    var ndTodayNews = await sb('content_drafts?type=eq.article_news&created_at=gte.' + ndTodayStart + '&select=id');
    if (ndTodayNews.length >= 8) {
      await logRun('skipped', 0, 'Daily news cap reached (' + ndTodayNews.length + '/8)', Date.now() - started);
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Daily news article limit — ' + ndTodayNews.length + '/8' }) };
    }
  } catch(e) {}

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    await logRun('error', 0, 'ANTHROPIC_API_KEY not configured', Date.now() - started);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  try {
    // 0. Fetch picks for tweet constraints
    var picksContext = '';
    try {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      var ndPicks = await sb('betting_picks?created_at=gte.' + sevenDaysAgo + '&order=created_at.asc&limit=10');
      if (ndPicks.length > 0) {
        picksContext = ndPicks.map(function(p) { return (p.edge_label || '') + ': ' + (p.player_name || '') + ' ' + (p.odds || ''); }).join(', ');
      }
    } catch(e) {}

    // 1. Fetch all headlines from RSS sources
    const allItems = await fetchAllHeadlines();
    const unique = deduplicateItems(allItems);
    console.log(`Fetched ${allItems.length} items, ${unique.length} unique`);

    // 2. Get existing content hashes
    const existingHashes = await sb('content_hashes?select=hash', 'GET');
    const hashSet = new Set(existingHashes.map(h => h.hash));

    // 3. Get existing topic keys from last 48 hours
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const existingTopics = await sb('content_topics?created_at=gte.' + twoDaysAgo + '&select=topic_key');
    const topicSet = new Set(existingTopics.map(t => t.topic_key));

    // 4. Check recent drafts for source headline overlap
    const recentDrafts = await sb('content_drafts?created_at=gte.' + twoDaysAgo + '&select=source_event,body');
    const recentSourceWords = recentDrafts.map(d => ((d.source_event || '') + ' ' + (d.body || '')).toLowerCase());

    // 5. Extract topic key from headline
    function extractTopicKey(title) {
      const t = (title || '').toLowerCase();
      const players = ['scheffler','mcilroy','rory','tiger','woods','schauffele','rahm','koepka','morikawa','hovland','fleetwood','spieth','fowler','reed','spaun','aberg','theegala','homa','lowry','thomas','phil','mickelson','dechambeau','bryson','matsuyama','woodland','cantlay'];
      const events = ['withdraw','injury','win','champion','arrest','dui','suspended','masters','open','pga','trade','return','caddie','baby','newborn','retire','record'];
      let player = '', event = '';
      for (const p of players) { if (t.includes(p)) { player = p; break; } }
      for (const e of events) { if (t.includes(e)) { event = e; break; } }
      return player + '-' + (event || 'news');
    }

    // 6. Check if headline keywords overlap with recent drafts
    function isAlreadyCovered(title) {
      const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4);
      return recentSourceWords.some(r => {
        const overlap = words.filter(w => r.includes(w)).length;
        return overlap >= words.length * 0.5;
      });
    }

    // 7. Filter to truly new items — triple check
    const newItems = unique.filter(item => {
      const h = hashText(item.title);
      if (hashSet.has(h)) return false;
      const topicKey = extractTopicKey(item.title);
      if (topicSet.has(topicKey)) return false;
      if (isAlreadyCovered(item.title)) return false;
      return true;
    });

    // WHITELIST APPROACH — only allow items matching approved patterns
    // Static floor list of events we know have ended for the season
    let staticPast = 'puerto rico|texas open|valero|houston open|valspar|arnold palmer|players championship|genesis|phoenix|pebble beach|farmers|torrey pines|american express';
    // DYNAMIC: pull any tournament that completed in the last 14 days so news-detector
    // automatically stops generating "live" coverage of the event the week after it ends.
    try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const recentCompleted = await sb('tournaments?status=eq.completed&end_date=gte.' + cutoff + '&select=name,course');
      for (const t of recentCompleted) {
        if (t.name)   staticPast += '|' + t.name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '\\s*');
        if (t.course) staticPast += '|' + t.course.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '\\s*');
      }
    } catch(e) { console.log('PAST_TOURNAMENTS dynamic fetch failed:', e.message); }
    const PAST_TOURNAMENTS = new RegExp(staticPast, 'i');
    const APPROVED_PATTERNS = [
      // Player performance
      'shoots', 'fires', 'cards', 'birdies', 'eagles', 'leads', 'moves to',
      // Tournament events
      'wins', 'victory', 'champion', 'withdraws', 'withdrawal', 'injured',
      'disqualified', 'rules violation', 'suspended play', 'weather delay',
      // Betting relevant
      'odds', 'favorite', 'betting', 'picks',
      // Breaking news
      'arrested', 'cited', 'charged', 'signs with', 'joins', 'leaves',
      'fired', 'hired', 'announces', 'confirms', 'denies',
      // Tier-1 player names
      'scheffler', 'mcilroy', 'rahm', 'schauffele', 'fleetwood', 'spieth',
      'morikawa', 'matsuyama', 'dechambeau', 'hovland', 'aberg', 'koepka',
      'reed', 'henley', 'fitzpatrick', 'lowry', 'young', 'burns', 'smith',
      'johnson', 'rose', 'scott', 'day', 'thomas', 'cantlay'
    ];

    const currentItems = newItems.filter(function(item) {
      var t = (item.title + ' ' + (item.desc || '')).toLowerCase();
      // Past tournament filter — dynamic list above catches events that ended in the last 14 days
      if (PAST_TOURNAMENTS.test(t)) {
        console.log('Skipping past tournament:', item.title.slice(0, 50));
        return false;
      }
      // Whitelist — must match at least one approved pattern
      var isApproved = APPROVED_PATTERNS.some(function(p) { return t.includes(p.toLowerCase()); });
      if (!isApproved) {
        console.log('Not approved — no relevant pattern match:', item.title.slice(0, 50));
        return false;
      }
      return true;
    });

    console.log(`${currentItems.length} current items (after filters, from ${newItems.length} new)`);

    // MAX 2 articles per run
    const toProcess = currentItems.slice(0, 2);
    const results = [];
    let totalTweetsThisRun = 0;

    for (const item of toProcess) {
      // Apply per-source maxAge and story classification
      var storyType = classifyStory(item.title);
      var sourceMaxAge = item.maxAge || 180;
      var effectiveMaxAge = Math.min(sourceMaxAge, STORY_AGE_LIMITS[storyType] || 180);
      if (item.pubDate) {
        var articleAgeMinutes = (Date.now() - new Date(item.pubDate).getTime()) / 60000;
        if (articleAgeMinutes > effectiveMaxAge) {
          console.log('Item filtered by age — ' + Math.floor(articleAgeMinutes) + 'min > ' + effectiveMaxAge + 'min limit (' + item.source + ')');
          continue;
        }
      }

      const contentHash = hashText(item.title);
      const topicKey = extractTopicKey(item.title);

      try {
        const facts = extractFacts(item.title, item.desc);

        const article = await generateArticle(facts, ANTHROPIC_API_KEY, picksContext);
        if (!article) { continue; }

        // Post-generation quality: must mention at least 2 tier-1 players
        var articleText = (article.title || '') + ' ' + (article.body || '');
        var tier1Mentions = ['scheffler','mcilroy','rory','rahm','schauffele','fleetwood','spieth','morikawa','matsuyama','dechambeau','hovland','aberg','koepka','johnson'].filter(function(name) {
          return articleText.toLowerCase().includes(name);
        });
        if (tier1Mentions.length < 2) {
          console.log('Rejecting article — only ' + tier1Mentions.length + ' tier-1 players mentioned:', article.title?.slice(0, 50));
          continue;
        }

        const articleTitle = article.title || 'Breaking Golf News';
        const articleSlug = articleTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
        const articleUrl = 'https://tourfeed.co/article/' + articleSlug;
        const articleImage = null; // Images added manually via admin editor
        // Generate image headline — bold hook, not truncated title
        var imgHL = articleTitle;
        try {
          var hlRes = await ft('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: 'Write ONE image headline (max 8 words) for this article. Bold hook for Instagram. NOT the title shortened. Think billboard.\n\nTitle: ' + articleTitle + '\n\nImage headline:' }] }),
          }, 25000);
          if (hlRes.ok) { var hd = await hlRes.json(); var cl = (hd.content?.[0]?.text || '').replace(/[""]/g, '').trim(); if (cl.length > 3 && cl.length < 60) imgHL = cl; }
        } catch(e) {}
        // Rumor disclaimer
        var rumorDisclaimer = storyType === 'rumor' ? '<p style="background:#fff3cd;padding:8px 12px;border-left:4px solid #D4A853;margin-bottom:16px;font-size:0.85rem">UNCONFIRMED REPORT: This is based on unverified reports. TourFeed will update as official information becomes available.</p>' : '';
        var finalTitle = storyType === 'rumor' ? '[REPORT] ' + articleTitle : articleTitle;
        var finalBody = rumorDisclaimer + (article.body || '');

        await sb('content_drafts', 'POST', {
          type: 'article_news',
          title: finalTitle,
          body: finalBody,
          image_url: articleImage,
          image_headline: imgHL,
          article_url: articleUrl,
          source_event: item.title,
          source_name: item.source || '',
          source_url: item.link || '',
          status: 'pending',
          created_at: new Date().toISOString(),
        });

        // Breaking news — also generate immediate tweet
        if (storyType === 'breaking' && totalTweetsThisRun < 3) {
          await sb('content_drafts', 'POST', {
            type: 'tweet_content',
            title: 'BREAKING: ' + articleTitle.slice(0, 60),
            body: 'BREAKING: ' + articleTitle + '. Full analysis at tourfeed.co',
            source_name: item.source || '',
            status: 'pending',
            created_at: new Date().toISOString(),
          });
          totalTweetsThisRun++;
        }

        // Companion tweet — promotes the article, creates curiosity
        const tweets = article.tweets || [];
        let tweetCount = 0;
        for (const tweet of tweets) {
          if (totalTweetsThisRun >= 3) break;
          if (tweetCount >= 1) break; // MAX 1 tweet per article
          if (!tweet || tweet.length < 15) continue;
          // SAFETY: skip tweets with unverified legal claims
          if (/arrested|charged|indicted|convicted|guilty|dui|mugshot/i.test(tweet)) continue;
          await sb('content_drafts', 'POST', {
            type: 'tweet_content',
            body: tweet.length > 280 ? tweet.slice(0, tweet.lastIndexOf(' ', 280)) : tweet,
            source_event: topicKey,
            status: 'pending',
            created_at: new Date().toISOString(),
          });
          tweetCount++;
          totalTweetsThisRun++;
        }

        // Instagram draft — promote our picks, not article summary
        var igCaption = articleTitle + '\n\nWe broke down what this means for the betting market.\n\nFull picks at tourfeed.co';
        // Generate image headline — max 8 words, bold hook
        var ndIgWords = articleTitle.split(/\s+/);
        var ndIgHL = ndIgWords.length <= 8 ? articleTitle : ndIgWords.slice(0, 7).join(' ') + '...';
        if (ndIgHL === articleTitle && ndIgHL.length > 50) ndIgHL = ndIgWords.slice(0, 6).join(' ') + '...';
        await sb('content_drafts', 'POST', {
          type: 'instagram',
          title: finalTitle,
          body: igCaption,
          image_headline: ndIgHL,
          source_name: item.source || '',
          meta: JSON.stringify({ timing: 'Prepare now, post within 2 hours' }),
          status: 'pending',
          created_at: new Date().toISOString(),
        });

        // Record hash + topic so future runs skip
        await sb('content_hashes', 'POST', { hash: contentHash, source: item.source, created_at: new Date().toISOString() });
        await sb('content_topics', 'POST', { topic_key: topicKey, player_name: topicKey.split('-')[0], event_type: topicKey.split('-')[1], created_at: new Date().toISOString() }).catch(function(){});

        results.push({ source: item.source, original: item.title, generated: articleTitle, tweets: tweetCount });

        // Push notification
        try {
          await ft('https://tourfeed.co/.netlify/functions/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'TourFeed — New ' + storyType.toUpperCase() + ' draft', body: (articleTitle || item.title).slice(0, 80) })
          });
        } catch(e) {}
      } catch (itemErr) {
        console.error(`Error: "${item.title}":`, itemErr.message);
      }
    }

    await logRun('success', results.length, results.length + ' drafted, ' + newItems.length + ' new items', Date.now() - started);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        processed: results.length,
        skipped: unique.length - newItems.length,
        newFound: newItems.length,
        totalFetched: allItems.length,
        results,
      }),
    };
  } catch (err) {
    console.error('news-detector error:', err);
    await logRun('error', 0, err.message, Date.now() - started);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: err.message }),
    };
  }
};
