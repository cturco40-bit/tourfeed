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
async function generateArticle(facts, apiKey) {
  const factsText = `WHO: ${facts.who.join(', ') || 'Unknown'}\nWHAT: ${facts.what}\nWHEN: ${facts.when || 'Recent'}\nDETAILS: ${facts.details || 'No additional details.'}`;

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
      system: `You are a senior golf journalist at TourFeed, a premium golf media outlet. You write ORIGINAL articles based only on extracted key facts — never copy source language.

Rules:
- Rory McIlroy is defending Masters champion (won 2025). It is 2026. Don't invent stats.
- Write a provocative, clickbait-style headline that makes readers HAVE to click. Examples of GOOD headlines: "Tiger Just Made a Decision That Changes Everything", "This Stat About Scottie Scheffler Will Blow Your Mind", "Nobody Is Talking About What Just Happened at Augusta"
- Examples of BAD headlines (too boring): "Tiger Woods Withdraws from Tournament", "Scheffler Wins Again"
- MINIMUM 500 words, aim for 600+. This is a FULL article, not a summary.
- 5-7 paragraphs with real analysis. First paragraph hooks, middle paragraphs add context and opinion, final paragraph looks ahead.
- Use HTML <p> tags for paragraphs
- Open with a hook that grabs attention
- Develop the story — add YOUR take, what this means for the player, the tour, the fans
- Close with what to watch next and why this matters going forward
- Voice: smart golf fan in the group chat. Confident, opinionated, never boring.
- Never mention AI, ESPN, Golf Digest, or any source outlet
- Never use "according to reports" — write with authority
- ONLY state facts provided. Do NOT invent stats, records, or tournament results
- Do NOT speculate about career milestones unless the facts explicitly mention them`,
      messages: [
        {
          role: 'user',
          content: `Write an original TourFeed article based on these extracted facts:\n\n${factsText}\n\nReturn ONLY valid JSON, no markdown fences:\n{"title":"clickbait headline","body":"article HTML with <p> tags","tweets":["tweet reaction 1","tweet reaction 2"]}`,
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

    // 2. Get existing content hashes from Supabase
    const existingHashes = await sb('content_hashes?select=hash', 'GET');
    const hashSet = new Set(existingHashes.map(h => h.hash));

    // 3. Filter to only new items
    const newItems = unique.filter(item => {
      const h = hashText(item.title);
      return !hashSet.has(h);
    });

    console.log(`${newItems.length} new items to process`);

    // Limit to 2 per run to stay within Netlify 10s timeout
    const toProcess = newItems.slice(0, 2);
    const results = [];

    // 4. For each new item: extract facts, generate article, store draft
    for (const item of toProcess) {
      const contentHash = hashText(item.title);

      try {
        // Extract key facts
        const facts = extractFacts(item.title, item.desc);
        console.log(`Processing: "${item.title}" from ${item.source}`);

        // Generate original article via Claude Haiku
        const article = await generateArticle(facts, ANTHROPIC_API_KEY);
        if (!article) {
          console.error(`Failed to generate article for: "${item.title}"`);
          continue;
        }

        // Store article draft in content_drafts
        const articleTitle = article.title || 'Breaking Golf News';
        const articleImage = await uploadImage('BREAKING', articleTitle);
        const articleDraft = await sb('content_drafts', 'POST', {
          type: 'article_news',
          title: articleTitle,
          body: article.body || '',
          image_url: articleImage,
          source_headline: item.title,
          source_name: item.source,
          status: 'pending',
          created_at: new Date().toISOString(),
        });

        // Store tweet drafts
        const tweets = article.tweets || [];
        for (const tweet of tweets.slice(0, 2)) {
          if (tweet && tweet.length > 10) {
            await sb('content_drafts', 'POST', {
              type: 'tweet_content',
              title: article.title || 'Golf News Tweet',
              body: tweet,
              source_headline: item.title,
              source_name: item.source,
              status: 'pending',
              created_at: new Date().toISOString(),
            });
          }
        }

        // Store content hash so we don't reprocess
        await sb('content_hashes', 'POST', {
          hash: contentHash,
          source: item.source,
          title: item.title.slice(0, 200),
          created_at: new Date().toISOString(),
        });

        results.push({
          source: item.source,
          original: item.title,
          generated: article.title,
          tweets: tweets.length,
        });
      } catch (itemErr) {
        console.error(`Error processing "${item.title}":`, itemErr.message);
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
