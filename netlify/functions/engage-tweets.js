const crypto = require('crypto');

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(params) {
  return 'OAuth ' + Object.keys(params).filter(k => k.startsWith('oauth_')).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`).join(', ');
}

async function postTweet(text, replyToId) {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) throw new Error('Missing Twitter creds');

  const url = 'https://api.twitter.com/2/tweets';
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  oauthParams.oauth_signature = oauthSign('POST', url, oauthParams, apiSecret, accessSecret);

  const body = { text: text.slice(0, 280) };
  if (replyToId) body.quote_tweet_id = replyToId;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': buildAuthHeader(oauthParams), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Twitter ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Generate a smart reply using Claude
async function generateReply(tweetText, authorName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You are the social media voice for TourFeed (@TourFeedGolf), a golf media brand. You quote tweet posts from major golf accounts with smart, knowledgeable takes. Your tone is confident but not arrogant — like a well-informed golf fan who watches every round.

Rules:
- Keep it under 200 characters — punchy and sharp
- Add genuine insight, a hot take, or context — don't just agree
- Never be negative about players — respect the game
- Never mention AI or automation
- Use 1-2 relevant hashtags naturally (e.g. #Masters, #PGATour)
- Mention tourfeed.co only if it naturally fits
- Sound like a real golf fan, not a corporate brand
- Use golf terminology naturally
- This is a QUOTE TWEET — the original tweet will be embedded below yours`,
        messages: [{
          role: 'user',
          content: `Write a quote tweet for this post from @${authorName}:\n\n"${tweetText}"\n\nReturn ONLY the quote tweet text, nothing else.`
        }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return (data.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
  } catch (e) {
    return null;
  }
}

// Accounts to engage with
const TARGET_ACCOUNTS = [
  'PGATour', 'LPGA', 'LIVGolfLeague', 'EuropeanTour',
  'GolfDigest', 'GolfChannel', 'NoLayingUp', 'PIKIETA',
  'SkySportsGolf', 'GolfWeek', 'TheMasters',
  'RickieFowler', 'JustinThomas34', 'McIlroyRory',
  'TigerWoods', 'JordanSpieth',
];

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No bearer token' }) };

  try {
    // Get our recent replies to avoid double-replying
    let ourUserId = null;
    try {
      const uRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
        headers: { 'Authorization': `Bearer ${bearer}` },
      });
      if (uRes.ok) {
        const uData = await uRes.json();
        ourUserId = uData.data?.id;
      }
    } catch(e) {}

    let recentReplies = [];
    if (ourUserId) {
      try {
        const rRes = await fetch(`https://api.twitter.com/2/users/${ourUserId}/tweets?max_results=20&tweet.fields=in_reply_to_user_id,referenced_tweets`, {
          headers: { 'Authorization': `Bearer ${bearer}` },
        });
        if (rRes.ok) {
          const rData = await rRes.json();
          recentReplies = (rData.data || [])
            .filter(t => t.referenced_tweets?.some(r => r.type === 'quoted' || r.type === 'replied_to'))
            .map(t => t.referenced_tweets.find(r => r.type === 'quoted' || r.type === 'replied_to')?.id)
            .filter(Boolean);
        }
      } catch(e) {}
    }

    // Search for recent golf tweets from target accounts
    const accountQuery = TARGET_ACCOUNTS.slice(0, 8).map(a => `from:${a}`).join(' OR ');
    const query = `(${accountQuery}) -is:retweet -is:reply lang:en`;

    const searchUrl = new URL('https://api.twitter.com/2/tweets/search/recent');
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('max_results', '15');
    searchUrl.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    searchUrl.searchParams.set('expansions', 'author_id');
    searchUrl.searchParams.set('user.fields', 'username');

    const res = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });

    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: `Twitter search ${res.status}` }) };
    }

    const data = await res.json();
    const tweets = data.data || [];
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    if (tweets.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No tweets found' }) };
    }

    // Filter: skip tweets we already replied to, prefer high-engagement tweets
    const candidates = tweets
      .filter(t => !recentReplies.includes(t.id))
      .filter(t => {
        const metrics = t.public_metrics || {};
        return (metrics.like_count || 0) >= 5; // Only reply to tweets with some engagement
      })
      .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0));

    if (candidates.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No suitable tweets to reply to' }) };
    }

    // Pick the top tweet
    const target = candidates[0];
    const author = users[target.author_id];
    const authorName = author?.username || 'unknown';

    // Generate a smart reply
    const reply = await generateReply(target.text, authorName);
    if (!reply) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Could not generate reply' }) };
    }

    // Post the reply
    const result = await postTweet(reply, target.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        replied_to: `@${authorName}: ${target.text.slice(0, 100)}`,
        reply: reply,
        tweet_id: result.data?.id,
      }),
    };

  } catch (err) {
    console.error('Engage error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
