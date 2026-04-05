const crypto = require('crypto');

// OAuth 1.0a signature generation
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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    // Fetch current leaderboard
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = await res.json();

    const evt = data.events?.[0];
    if (!evt) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No active event' }) };

    const comp = evt.competitions?.[0];
    const status = comp?.status || {};
    const round = status.period || 1;
    const tourneyName = evt.shortName || evt.name || 'Tournament';
    const players = comp?.competitors || [];

    if (players.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No players' }) };

    // Get top 5
    const top5 = players.slice(0, 5).map(p => ({
      name: p.athlete?.shortName || p.athlete?.displayName || '?',
      score: typeof p.score === 'string' ? p.score : '?',
      order: p.order || 99,
    }));

    const leader = top5[0];
    const tied = top5.filter(p => p.score === leader.score);

    // Build tweet based on tournament state
    let tweetText = '';
    const stState = status.type?.state || '';
    const stName = (status.type?.name || '').toUpperCase();

    if (stName === 'STATUS_FINAL') {
      // Tournament over — winner tweet
      if (tied.length > 1) {
        tweetText = `🏆 PLAYOFF at the ${tourneyName}!\n\n${tied.map(p => `${p.name} (${p.score})`).join('\n')}\n\nStay locked in → tourfeed.co`;
      } else {
        tweetText = `🏆 ${leader.name} wins the ${tourneyName} at ${leader.score}!\n\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nFull leaderboard → tourfeed.co`;
      }
    } else if (stState === 'post' || stName.includes('PLAY_COMPLETE') || stName.includes('END_PERIOD')) {
      // Round complete
      if (tied.length > 1) {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n${tied.length}-way tie at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\n${top5.filter(p => p.score !== leader.score).slice(0,2).map(p => `${p.name} (${p.score})`).join(' | ')}\n\nLive scores → tourfeed.co`;
      } else {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n🥇 ${leader.name} leads at ${leader.score}\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nLive scores → tourfeed.co`;
      }
    } else if (stState === 'in') {
      // In progress — leaderboard update
      if (tied.length > 1) {
        tweetText = `⛳ ${tourneyName} — R${round} Live\n\nTied at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\n${top5.filter(p => p.score !== leader.score).slice(0,2).map(p => `${p.name} (${p.score})`).join(' | ')}\n\n→ tourfeed.co`;
      } else {
        tweetText = `⛳ ${tourneyName} — R${round} Live\n\n🥇 ${leader.name} (${leader.score})\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\n→ tourfeed.co`;
      }
    } else {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Tournament not in tweetable state', state: stState }) };
    }

    // Post it
    const result = await postTweet(tweetText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tweet_id: result.data?.id,
        text: tweetText,
      }),
    };

  } catch (err) {
    console.error('Auto-tweet error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
