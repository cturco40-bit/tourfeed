// news-detector.js — Monitors RSS feeds for golf news events, generates original articles via Claude Haiku, stores drafts in Supabase

const RSS_SOURCES = [
  {
    name: 'ESPN',
    type: 'api',
    url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=15',
  },
  {
    name: 'Golf Digest',
    type: 'rss',
    url: 'https://www.golfdigest.com/feed/rss',
  },
  {
    name: 'PGA Tour',
    type: 'rss',
    url: 'https://www.pgatour.com/rss/news',
  },
  {
    name: 'Golf Channel',
    type: 'rss',
    url: 'https://www.golfchannel.com/rss/golf-central',
  },
  {
    name: 'Google News',
    type: 'rss',
    url: 'https://news.google.com/rss/search?q=golf+PGA+tour&hl=en-US&gl=US&ceid=US:en',
  },
];

// ---------- Supabase helper ----------
async function sb(path, method, body) {
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';
  const hdrs = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/' + path, {
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
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    const filename = 'news-' + Date.now() + '.png';
    const upRes = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/images/' + filename, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs',
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
    const r = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/player_facts?select=player_name,world_ranking,total_majors,masters_wins,masters_best,career_grand_slam,recent_notes,hot_topics&limit=30', {
      headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs' }
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

async function generateArticle(facts, apiKey) {
  const playerFacts = await fetchPlayerFacts();
  const factsText = `WHO: ${facts.who.join(', ') || 'Unknown'}\nWHAT: ${facts.what}\nWHEN: ${facts.when || 'Recent'}\nDETAILS: ${facts.details || 'No additional details.'}${playerFacts}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      system: require('./voice') + `

You write ORIGINAL news articles based only on extracted key facts — never copy source language.
Year is 2026. Rory McIlroy is defending Masters champion (won 2025). Career Grand Slam holder.
150-250 words. Get to the point. Use HTML <p> tags.
ONLY state facts provided. Do NOT invent stats, records, or tournament results.
Never mention AI, ESPN, Golf Digest, or any source outlet.
${playerFacts}`,
      messages: [
        {
          role: 'user',
          content: `Write an original TourFeed article based on these extracted facts:\n\n${factsText}\n\nTWEET RULES:\n- Write exactly 1 tweet that PROMOTES the article and creates CURIOSITY. Tease the most interesting finding WITHOUT giving the answer away.\n- The tweet should make people want to click the link to read the full article.\n- Example: "We broke down what Tiger not being at Augusta actually means for the betting market. The ripple effects are wild."\n- NOT just restating the headline. Create intrigue.\n\nVARIETY: Use varied sentence structures. BANNED: "That's either [A] or [B]", "That's the kind of [X]", "Respect the [noun]"\nMIX: questions, fragments, comparisons, predictions, one-liners.\n\nCRITICAL SAFETY:\n- NEVER state a player was arrested, charged, or involved in legal trouble unless source EXPLICITLY states it\n- NEVER speculate about criminal activity, substance abuse, or personal scandals\n- If absent from tournament, say "not in the field" — do not speculate why unless official reason given\n- When in doubt, use softer language or skip the topic\n\nReturn ONLY valid JSON, no markdown fences:\n{"title":"clickbait headline","body":"article HTML with <p> tags","tweets":["curiosity-driving tweet that promotes the article"]}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Anthropic API error:', errText);
    return null;
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

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

// ---------- Fetch all feeds ----------
async function fetchAllHeadlines() {
  const allItems = [];

  const fetches = RSS_SOURCES.map(async (source) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(source.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TourFeed/1.0 (Golf News Aggregator)',
          'Accept': source.type === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json',
        },
      });
      clearTimeout(timeout);

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

      items.forEach(i => { i.source = source.name; });
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
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  try {
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

    console.log(`${newItems.length} genuinely new items (after hash + topic + draft dedup)`);

    // MAX 2 articles per run (each generates up to 2 tweets = max 6 drafts total)
    const toProcess = newItems.slice(0, 2);
    const results = [];
    let totalTweetsThisRun = 0;

    for (const item of toProcess) {
      const contentHash = hashText(item.title);
      const topicKey = extractTopicKey(item.title);

      try {
        const facts = extractFacts(item.title, item.desc);

        const article = await generateArticle(facts, ANTHROPIC_API_KEY);
        if (!article) { continue; }

        const articleTitle = article.title || 'Breaking Golf News';
        const articleSlug = articleTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
        const articleUrl = 'https://tourfeed.co/article/' + articleSlug;
        const articleImage = null; // Images added manually via admin editor
        await sb('content_drafts', 'POST', {
          type: 'article_news',
          title: articleTitle,
          body: article.body || '',
          image_url: articleImage,
          article_url: articleUrl,
          source_event: item.title,
          status: 'pending',
          created_at: new Date().toISOString(),
        });

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
            body: tweet.slice(0, 250) + ' ' + articleUrl,
            article_url: articleUrl,
            source_event: topicKey,
            status: 'pending',
            created_at: new Date().toISOString(),
          });
          tweetCount++;
          totalTweetsThisRun++;
        }

        // Instagram draft
        var igPlain = (article.body || '').replace(/<[^>]+>/g, '').slice(0, 200);
        var igCaption = igPlain.split('.').slice(0, 2).join('.') + '.\n\nFull story: tourfeed.co\n\n#golf #masters #masters2026 #augusta #pgatour #golfnews #tourfeed #greenjacket #breakingnews';
        await sb('content_drafts', 'POST', {
          type: 'instagram',
          title: articleTitle,
          body: igCaption,
          meta: JSON.stringify({ timing: 'Post ASAP' }),
          status: 'pending',
          created_at: new Date().toISOString(),
        });

        // Record hash + topic so future runs skip
        await sb('content_hashes', 'POST', { hash: contentHash, source: item.source, created_at: new Date().toISOString() });
        await sb('content_topics', 'POST', { topic_key: topicKey, player_name: topicKey.split('-')[0], event_type: topicKey.split('-')[1], created_at: new Date().toISOString() }).catch(function(){});

        results.push({ source: item.source, original: item.title, generated: articleTitle, tweets: tweetCount });
      } catch (itemErr) {
        console.error(`Error: "${item.title}":`, itemErr.message);
      }
    }

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
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: err.message }),
    };
  }
};
