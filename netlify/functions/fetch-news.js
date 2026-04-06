const SOURCES = [
  {
    name: 'ESPN',
    type: 'api',
    url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=12',
    parse: (data) => {
      return (data.articles || []).map(a => ({
        title: a.headline || '',
        summary: a.description || '',
        link: a.links?.web?.href || '',
        image: a.images?.[0]?.url || '',
        published: a.published || '',
        source: 'ESPN',
      }));
    },
  },
  {
    name: 'Golf Digest',
    type: 'rss',
    url: 'https://www.golfdigest.com/feed/rss',
    tag: 'Golf Digest',
  },
  {
    name: 'PGA Tour',
    type: 'rss',
    url: 'https://www.pgatour.com/rss/news',
    tag: 'PGA Tour',
  },
  {
    name: 'Golf Channel',
    type: 'rss',
    url: 'https://www.golfchannel.com/rss/golf-central',
    tag: 'Golf Channel',
  },
  {
    name: 'DP World Tour',
    type: 'rss',
    url: 'https://www.europeantour.com/dpworld-tour/news/rss/',
    tag: 'DP World',
  },
  {
    name: 'LPGA',
    type: 'rss',
    url: 'https://www.lpga.com/news/rss',
    tag: 'LPGA',
  },
  {
    name: 'Google Golf News',
    type: 'rss',
    url: 'https://news.google.com/rss/search?q=golf+PGA+tour&hl=en-US&gl=US&ceid=US:en',
    tag: 'Golf News',
  },
];

// Simple RSS XML parser — no dependencies needed
function parseRSS(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      // Handle CDATA: <title><![CDATA[...]]></title>
      const r = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i');
      const m = block.match(r);
      return m ? m[1].trim() : '';
    };

    const title = getTag('title').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    const summary = getTag('description').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").slice(0, 300);
    const link = getTag('link');
    const pubDate = getTag('pubDate');

    // Try to find image from media:content, media:thumbnail, or enclosure
    let image = '';
    const mediaMatch = block.match(/(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["']/i);
    if (mediaMatch) image = mediaMatch[1];
    // Also try og:image style or img in description
    if (!image) {
      const imgMatch = block.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) image = imgMatch[1];
    }

    if (title && title.length > 10) {
      items.push({
        title,
        summary: summary.slice(0, 250),
        link,
        image,
        published: pubDate,
        source: sourceName,
      });
    }
  }

  return items;
}

// Deduplicate by fuzzy title matching
function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    // Normalize title for comparison
    const key = a.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    
    // Check if any existing key is very similar
    for (const s of seen) {
      if (s === key) return false;
      // Simple overlap check — if 80% of words match, skip
      const words1 = key.split(' ');
      const words2 = s.split(' ');
      const overlap = words1.filter(w => words2.includes(w)).length;
      if (overlap >= Math.min(words1.length, words2.length) * 0.7) return false;
    }
    
    seen.add(key);
    return true;
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const allArticles = [];
  const errors = [];

  // Fetch all sources in parallel
  const fetches = SOURCES.map(async (source) => {
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
        errors.push(`${source.name}: ${res.status}`);
        return;
      }

      if (source.type === 'api' && source.parse) {
        const data = await res.json();
        const articles = source.parse(data);
        allArticles.push(...articles);
      } else if (source.type === 'rss') {
        const xml = await res.text();
        const articles = parseRSS(xml, source.tag || source.name);
        allArticles.push(...articles);
      }
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
    }
  });

  await Promise.allSettled(fetches);

  // Sort by published date (newest first)
  allArticles.sort((a, b) => {
    const da = a.published ? new Date(a.published).getTime() : 0;
    const db = b.published ? new Date(b.published).getTime() : 0;
    return db - da;
  });

  // Deduplicate
  const unique = deduplicateArticles(allArticles);

  // Limit to 25 articles
  const final = unique.slice(0, 25);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      articles: final,
      sources: SOURCES.map(s => s.name),
      errors: errors.length > 0 ? errors : undefined,
      count: final.length,
    }),
  };
};
