async function postTweet(text) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source: 'tweet-news' }),
  });
  if (!res.ok) throw new Error(`draft-tweet ${res.status}: ${await res.text()}`);
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

  // v2 pipeline handles all content now — disabled
  return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Disabled — v2 pipeline active' }) };

  try {
    // Fetch news directly from ESPN (most reliable source)
    const newsRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=12');
    if (!newsRes.ok) throw new Error(`ESPN news ${newsRes.status}`);
    const newsData = await newsRes.json();
    const articles = (newsData.articles || []).map(a => ({
      title: a.headline || '',
      summary: a.description || '',
      image: a.images?.[0]?.url || '',
    }));

    if (articles.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No articles' }) };
    }

    // Get recent tweets to avoid duplicates
    const recentTweets = await getRecentTweets();

    // Check last tweet time — don't tweet if we tweeted anything < 20 min ago
    if (recentTweets.length > 0) {
      const lastTime = recentTweets[0].time;
      const minsSinceLast = (Date.now() - lastTime.getTime()) / 60000;
      if (minsSinceLast < 20) {
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

    // Create article deep link
    const slug = picked.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    tweetText += `\n\n→ https://tourfeed.co/?ref=x?article=${slug}`;

    // Add relevant hashtags
    const t = picked.title.toLowerCase();
    const tags = ['#Golf'];
    if (/masters/i.test(t)) tags.unshift('#TheMasters');
    else if (/pga championship/i.test(t)) tags.unshift('#PGAChamp');
    else if (/u\.?s\.?\s*open/i.test(t)) tags.unshift('#USOpen');
    else if (/open championship|the open/i.test(t)) tags.unshift('#TheOpen');
    else if (/lpga|nelly|lexi/i.test(t)) tags.unshift('#LPGA');
    else if (/liv /i.test(t)) tags.unshift('#LIVGolf');
    else tags.unshift('#PGATour');
    if (/injur|withdraw/i.test(t)) tags.push('#GolfNews');
    const tagStr = '\n' + tags.join(' ');
    if (tweetText.length + tagStr.length <= 280) tweetText += tagStr;

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
