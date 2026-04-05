const crypto = require('crypto');

// OAuth 1.0a
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

// Check our last tweet to avoid duplicates and detect what's changed
async function getLastTweet() {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return null;

  try {
    // Get @TourFeedGolf user ID first, then last tweet
    const userRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!userRes.ok) return null;
    const userData = await userRes.json();
    const userId = userData.data?.id;
    if (!userId) return null;

    const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at,text`, {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!tweetsRes.ok) return null;
    const tweetsData = await tweetsRes.json();
    const last = tweetsData.data?.[0];
    if (!last) return null;

    return {
      text: last.text,
      time: new Date(last.created_at),
      id: last.id,
    };
  } catch (e) {
    console.warn('Could not fetch last tweet:', e.message);
    return null;
  }
}

// Extract leader name from a previous tweet
function extractLeaderFromTweet(text) {
  if (!text) return null;
  // Match patterns like "🥇 R. MacIntyre" or "Tied at -14:\nR. Hisatsune, L. Åberg"
  const leaderMatch = text.match(/🥇\s+([^\n(]+)/);
  if (leaderMatch) return leaderMatch[1].trim();
  const tiedMatch = text.match(/Tied at [^:]+:\n(.+)/);
  if (tiedMatch) return tiedMatch[1].trim();
  const winsMatch = text.match(/🏆\s+([^\s]+\s+[^\s]+)\s+wins/);
  if (winsMatch) return winsMatch[1].trim();
  return null;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  // Allow force=true to bypass checks
  const force = event.queryStringParameters?.force === 'true' ||
    (event.body && JSON.parse(event.body).force === true);

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
    const stState = status.type?.state || '';
    const stName = (status.type?.name || '').toUpperCase();

    if (players.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No players' }) };

    // Only tweet during active tournament states
    if (!force && stState !== 'in' && stState !== 'post' && stName !== 'STATUS_FINAL') {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Not during active play', state: stState }) };
    }

    const top5 = players.slice(0, 5).map(p => ({
      name: p.athlete?.shortName || p.athlete?.displayName || '?',
      fullName: p.athlete?.displayName || '?',
      score: typeof p.score === 'string' ? p.score : '?',
      order: p.order || 99,
      today: p.linescores?.[round - 1]?.displayValue || '',
    }));

    const leader = top5[0];
    const tied = top5.filter(p => p.score === leader.score);

    // Check last tweet to decide if we should post
    const lastTweet = await getLastTweet();
    const minutesSinceLastTweet = lastTweet ? (Date.now() - lastTweet.time.getTime()) / 60000 : 999;
    const lastLeader = lastTweet ? extractLeaderFromTweet(lastTweet.text) : null;

    // Current leader string for comparison
    const currentLeaderStr = tied.length > 1
      ? tied.map(p => p.name).join(', ')
      : leader.name;

    // Decide whether to tweet
    const isFinal = stName === 'STATUS_FINAL';
    const isRoundComplete = stState === 'post' || stName.includes('PLAY_COMPLETE') || stName.includes('END_PERIOD');
    const leaderChanged = lastLeader && !currentLeaderStr.includes(lastLeader) && !lastLeader.includes(leader.name);
    const hourlyUpdate = minutesSinceLastTweet >= 55;

    // Check for big moves — anyone in top 5 with -4 or better today
    const bigMover = top5.find(p => {
      const todayNum = p.today === 'E' ? 0 : parseInt(p.today);
      return !isNaN(todayNum) && todayNum <= -4;
    });

    let reason = '';
    if (force) reason = 'forced';
    else if (isFinal) reason = 'tournament_final';
    else if (isRoundComplete && !lastTweet?.text?.includes('Complete')) reason = 'round_complete';
    else if (leaderChanged) reason = 'leader_change';
    else if (bigMover && minutesSinceLastTweet >= 20) reason = 'big_mover';
    else if (hourlyUpdate) reason = 'hourly_update';
    else {
      return { statusCode: 200, headers, body: JSON.stringify({
        skipped: 'No trigger',
        minutesSinceLastTweet: Math.round(minutesSinceLastTweet),
        currentLeader: currentLeaderStr,
        lastLeader,
      })};
    }

    // Build tweet
    let tweetText = '';

    if (isFinal) {
      if (tied.length > 1) {
        tweetText = `🏆 PLAYOFF at the ${tourneyName}!\n\n${tied.map(p => `${p.name} (${p.score})`).join('\n')}\n\nStay locked in → tourfeed.co`;
      } else {
        tweetText = `🏆 ${leader.fullName} wins the ${tourneyName} at ${leader.score}!\n\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nFull leaderboard → tourfeed.co`;
      }
    } else if (isRoundComplete) {
      if (tied.length > 1) {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n${tied.length}-way tie at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\nLive scores → tourfeed.co`;
      } else {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n🥇 ${leader.name} leads at ${leader.score}\n${top5.slice(1, 3).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nLive scores → tourfeed.co`;
      }
    } else if (reason === 'leader_change') {
      if (tied.length > 1) {
        tweetText = `🔄 NEW LEADERS — ${tourneyName} R${round}\n\nTied at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\n→ tourfeed.co`;
      } else {
        tweetText = `🔄 LEAD CHANGE — ${tourneyName} R${round}\n\n🥇 ${leader.fullName} takes the lead at ${leader.score}\n\n${top5.slice(1, 3).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\n→ tourfeed.co`;
      }
    } else if (reason === 'big_mover' && bigMover) {
      tweetText = `🔥 ${bigMover.fullName} is ${bigMover.today} today at the ${tourneyName}\n\nNow at ${bigMover.score} overall\n\n${tied.length > 1 ? `Leaders (${leader.score}): ${tied.map(p=>p.name).join(', ')}` : `Leader: ${leader.name} (${leader.score})`}\n\n→ tourfeed.co`;
    } else {
      // Hourly update
      if (tied.length > 1) {
        tweetText = `⛳ ${tourneyName} — R${round} Update\n\nTied at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\n${top5.filter(p => p.score !== leader.score).slice(0,2).map(p => `${p.name} (${p.score})`).join(' | ')}\n\n→ tourfeed.co`;
      } else {
        tweetText = `⛳ ${tourneyName} — R${round} Update\n\n🥇 ${leader.name} (${leader.score})\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\n→ tourfeed.co`;
      }
    }

    const result = await postTweet(tweetText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        reason,
        tweet_id: result.data?.id,
        text: tweetText,
      }),
    };

  } catch (err) {
    console.error('Auto-tweet error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// Netlify Scheduled Function — runs every 10 minutes
exports.config = {
  schedule: '*/10 * * * *',
};
