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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const BEARER = process.env.TWITTER_BEARER_TOKEN;
  if (!BEARER) {
    return { statusCode: 200, headers, body: JSON.stringify({ tweet: null, reason: 'No Twitter token' }) };
  }

  try {
    const { keywords } = JSON.parse(event.body);
    if (!keywords) {
      return { statusCode: 200, headers, body: JSON.stringify({ tweet: null, reason: 'No keywords' }) };
    }

    // Build search query — require video, filter out retweets
    // Prioritize golf-related accounts
    const query = `(${keywords}) has:videos -is:retweet lang:en`;

    const searchUrl = new URL('https://api.twitter.com/2/tweets/search/recent');
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('max_results', '10');
    searchUrl.searchParams.set('tweet.fields', 'created_at,public_metrics,entities,author_id');
    searchUrl.searchParams.set('expansions', 'author_id');
    searchUrl.searchParams.set('user.fields', 'username,verified');

    const res = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${BEARER}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Twitter API error:', res.status, errText);
      return { statusCode: 200, headers, body: JSON.stringify({ tweet: null, reason: `Twitter ${res.status}` }) };
    }

    const data = await res.json();
    const tweets = data.data || [];
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    if (tweets.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ tweet: null, reason: 'No matching tweets' }) };
    }

    // Score tweets — prefer verified accounts, high engagement, golf accounts
    const golfAccounts = new Set([
      'pgatour', 'lpga', 'livgolf_league', 'europeantour', 'nolayingup',
      'gaborikp', 'golfdigest', 'golfchannel', 'baaborik', 'skysportsgolf',
      'pikieta', 'tigerwoods', 'justinthomas34', 'ricaborik', 'daborik',
    ]);

    const scored = tweets.map(t => {
      const user = users[t.author_id] || {};
      const metrics = t.public_metrics || {};
      let score = 0;
      score += (metrics.like_count || 0) * 1;
      score += (metrics.retweet_count || 0) * 3;
      score += (metrics.reply_count || 0) * 0.5;
      if (user.verified) score += 500;
      if (golfAccounts.has((user.username || '').toLowerCase())) score += 1000;
      return { ...t, username: user.username, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // Get oEmbed HTML for the tweet
    const oembedUrl = new URL('https://publish.twitter.com/oembed');
    oembedUrl.searchParams.set('url', `https://twitter.com/${best.username}/status/${best.id}`);
    oembedUrl.searchParams.set('theme', 'dark');
    oembedUrl.searchParams.set('hide_thread', 'true');
    oembedUrl.searchParams.set('dnt', 'true');
    oembedUrl.searchParams.set('omit_script', 'true');

    const oembedRes = await fetch(oembedUrl.toString());
    if (!oembedRes.ok) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          tweet: { id: best.id, username: best.username, url: `https://twitter.com/${best.username}/status/${best.id}` },
        }),
      };
    }

    const oembed = await oembedRes.json();

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        tweet: {
          id: best.id,
          username: best.username,
          url: `https://twitter.com/${best.username}/status/${best.id}`,
          html: oembed.html || '',
        },
      }),
    };

  } catch (err) {
    console.error('fetch-tweet error:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ tweet: null, reason: err.message }) };
  }
};
