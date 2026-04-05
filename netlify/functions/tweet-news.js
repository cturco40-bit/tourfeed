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

async function postTweet(text) {
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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': buildAuthHeader(oauthParams), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280) }),
  });
  if (!res.ok) throw new Error(`Twitter ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function getRecentTweets() {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return [];

  try {
    const userRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!userRes.ok) return [];
    const userData = await userRes.json();
    const userId = userData.data?.id;
    if (!userId) return [];

    const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=20&tweet.fields=created_at`, {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!tweetsRes.ok) return [];
    const tweetsData = await tweetsRes.json();
    return (tweetsData.data || []).map(t => ({
      text: t.text.toLowerCase(),
      time: new Date(t.created_at),
    }));
  } catch (e) {
    return [];
  }
}

// Normalize headline for comparison
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Check if a headline was already tweeted (fuzzy match)
function alreadyTweeted(headline, recentTweets) {
  const normalized = normalizeTitle(headline);
  const words = normalized.split(' ').filter(w => w.length > 3);
  if (words.length === 0) return true;

  for (const tweet of recentTweets) {
    const matchCount = words.filter(w => tweet.text.includes(w)).length;
    if (matchCount >= words.length * 0.5) return true;
  }
  return false;
}

// Categorize for emoji
function getEmoji(title) {
  const t = title.toLowerCase();
  if (/injur|withdraw|wd|surgery/i.test(t)) return '🚨';
  if (/win|champion|victory|captures/i.test(t)) return '🏆';
  if (/masters|u\.?s\.?\s*open|pga championship|open championship/i.test(t)) return '🏌️';
  if (/trade|sign|deal|contract|transfer|join|leave/i.test(t)) return '📋';
  if (/rank|fedex|standings/i.test(t)) return '📊';
  if (/record|historic|first|streak/i.test(t)) return '📈';
  if (/preview|picks|odds|bet/i.test(t)) return '🎯';
  return '⛳';
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    // Fetch news
    const newsRes = await fetch('https://tourfeed.co/.netlify/functions/fetch-news');
    if (!newsRes.ok) throw new Error(`News fetch ${newsRes.status}`);
    const newsData = await newsRes.json();
    const articles = newsData.articles || [];

    if (articles.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No articles' }) };
    }

    // Get recent tweets to avoid duplicates
    const recentTweets = await getRecentTweets();

    // Check last tweet time — don't tweet news if we tweeted anything < 15 min ago
    if (recentTweets.length > 0) {
      const lastTime = recentTweets[0].time;
      const minsSinceLast = (Date.now() - lastTime.getTime()) / 60000;
      if (minsSinceLast < 15) {
        return { statusCode: 200, headers, body: JSON.stringify({
          skipped: 'Too soon since last tweet',
          minutesSinceLast: Math.round(minsSinceLast),
        })};
      }
    }

    // Find first article that hasn't been tweeted yet
    let picked = null;
    for (const article of articles.slice(0, 10)) {
      if (!alreadyTweeted(article.title, recentTweets)) {
        picked = article;
        break;
      }
    }

    if (!picked) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'All top stories already tweeted' }) };
    }

    // Build tweet
    const emoji = getEmoji(picked.title);
    let tweetText = `${emoji} ${picked.title}`;

    // Add summary snippet if space allows
    if (picked.summary && tweetText.length < 200) {
      const snippet = picked.summary.split('.')[0].trim();
      if (snippet && tweetText.length + snippet.length + 4 < 255) {
        tweetText += `\n\n${snippet}.`;
      }
    }

    tweetText += `\n\n→ https://tourfeed.co`;

    const result = await postTweet(tweetText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tweet_id: result.data?.id,
        headline: picked.title,
        text: tweetText,
      }),
    };

  } catch (err) {
    console.error('Tweet-news error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
