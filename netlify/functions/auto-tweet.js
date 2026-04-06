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
  // Send to draft queue for approval instead of posting directly
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source: 'auto-tweet' }),
  });
  if (!res.ok) throw new Error(`draft-tweet ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Generate a branded TourFeed graphic URL
function getLeaderboardGraphic(tourneyName, players) {
  const playersParam = players.slice(0, 8).map(p =>
    `${p.name}|${p.score}|${p.today || ''}|${p.id || ''}`
  ).join(',');
  return `https://tourfeed.co/.netlify/functions/generate-graphic?type=leaderboard&title=${encodeURIComponent('LIVE LEADERBOARD')}&subtitle=${encodeURIComponent(tourneyName)}&players=${encodeURIComponent(playersParam)}`;
}

function getPicksGraphic(tourneyName, picks) {
  const picksParam = picks.map(p =>
    `${p.type}|${p.name}|${p.odds}|${p.reason || ''}`
  ).join(',');
  return `https://tourfeed.co/.netlify/functions/generate-graphic?type=picks&title=${encodeURIComponent('TOURFEED PICKS')}&subtitle=${encodeURIComponent(tourneyName)}&picks=${encodeURIComponent(picksParam)}`;
}

function getHeadlineGraphic(headline, tag) {
  return `https://tourfeed.co/.netlify/functions/generate-graphic?type=headline&headline=${encodeURIComponent(headline)}&tag=${encodeURIComponent(tag || 'BREAKING')}`;
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

    const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=20&tweet.fields=created_at,text`, {
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
      allTexts: (tweetsData.data || []).map(t => t.text.toLowerCase()),
    };
  } catch (e) {
    console.warn('Could not fetch last tweet:', e.message);
    return null;
  }
}

// Check if tweet content is too similar to any recent tweet
function isTooSimilar(newText, recentTexts) {
  if (!recentTexts || recentTexts.length === 0) return false;
  const newWords = newText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  for (const recent of recentTexts) {
    const recentWords = recent.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    const overlap = newWords.filter(w => recentWords.includes(w)).length;
    if (overlap >= newWords.length * 0.6) return true; // 60%+ word overlap = duplicate
  }
  return false;
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

// Preview tweets when no tournament is active — rotates content types
async function tweetNextEvent(headers, force) {
  try {
    const lastTweet = await getLastTweet();
    const minsSinceLast = lastTweet ? (Date.now() - lastTweet.time.getTime()) / 60000 : 999;

    // Only tweet every 2 hours between events
    if (!force && minsSinceLast < 120) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Too soon for preview tweet', minutesSinceLast: Math.round(minsSinceLast) }) };
    }

    // Fetch schedule
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026');
    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Could not fetch schedule' }) };
    const data = await res.json();

    const now = Date.now();
    const upcoming = (data.events || [])
      .filter(e => new Date(e.date).getTime() > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (upcoming.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No upcoming events' }) };
    }

    const next = upcoming[0];
    const name = next.shortName || next.name || 'Tournament';
    const course = next.competitions?.[0]?.venue?.fullName || '';
    const startDate = new Date(next.date);
    const daysUntil = Math.ceil((startDate.getTime() - now) / 86400000);
    const isMajor = /masters|pga championship|u\.?s\.?\s*open|open championship/i.test(name);

    // Rotate between different content types based on hour
    const hour = new Date().getHours();
    const contentType = hour % 4; // 0=countdown, 1=picks, 2=question, 3=course info

    let tweetText = '';

    if (contentType === 0) {
      // Countdown
      const dayWord = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `${daysUntil} days away`;
      tweetText = isMajor
        ? `${name} is ${dayWord}.\n\n${course}\n\nThe biggest week in golf.\n\nLive scores & coverage → https://tourfeed.co/?ref=x\n\n#TheMasters #PGATour`
        : `${name} — ${dayWord}\n\n${course}\n\n→ https://tourfeed.co/?ref=x\n\n#PGATour #Golf`;
    } else if (contentType === 1) {
      // Picks
      if (isMajor && /masters/i.test(name)) {
        tweetText = `My ${name} card.\n\nOutright: Scheffler.\nTop 5 sleeper: Morikawa.\nLongshot: MacIntyre.\n\nLock it in.`;
      } else {
        tweetText = `${name} this week. Who you got? Give me your outright and your sleeper.`;
      }
    } else if (contentType === 2) {
      // Engagement question
      tweetText = isMajor
        ? `${name} starts ${daysUntil === 1 ? 'tomorrow' : 'Thursday'}. Who's wearing green Sunday? Give me a name.`
        : `${name} this week at ${course}. Who's taking it?`;
    } else {
      // Bold take
      tweetText = isMajor
        ? `${daysUntil} days until the ${name}. ${course}. The best week in sports and it's not even close.`
        : `${name} at ${course} this week. Sneaky good field. Don't sleep on it.`;
    }

    // Final dedup check
    if (lastTweet?.allTexts && isTooSimilar(tweetText, lastTweet.allTexts)) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Preview too similar to recent tweets' }) };
    }

    const result = await postTweet(tweetText);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reason: 'preview_' + contentType, tweet_id: result.data?.id, text: tweetText }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Preview tweet failed', error: err.message }) };
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  // v2 pipeline handles all content now — disabled
  return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Disabled — v2 pipeline active' }) };

  const force = event.queryStringParameters?.force === 'true' ||
    (event.body && JSON.parse(event.body).force === true);

  try {
    // Check multiple tours for active events
    const tours = [
      { id: 'pga', sport: 'golf/pga', label: '' },
      { id: 'liv', sport: 'golf/liv', label: 'LIV Golf: ' },
      { id: 'lpga', sport: 'golf/lpga', label: 'LPGA: ' },
      { id: 'dpw', sport: 'golf/eur', label: 'DP World: ' },
    ];

    let evt = null, comp = null, tourLabel = '';
    for (const tour of tours) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${tour.sport}/scoreboard`);
        if (!r.ok) continue;
        const d = await r.json();
        const e = d.events?.[0];
        if (!e) continue;
        const c = e.competitions?.[0];
        const st = c?.status?.type?.state || '';
        // Prefer in-progress events, then post-round, skip pre
        if (st === 'in' || st === 'post' || (c?.status?.type?.name || '').toUpperCase() === 'STATUS_FINAL') {
          evt = e;
          comp = c;
          tourLabel = tour.label;
          break; // Use the first active tour found (PGA gets priority)
        }
      } catch(e) { continue; }
    }

    if (!evt || !comp) {
      // No active event — try to tweet about the next upcoming event
      return await tweetNextEvent(headers, force);
    }

    const status = comp.status || {};
    const round = status.period || 1;
    const tourneyName = tourLabel + (evt.shortName || evt.name || 'Tournament');
    const players = comp.competitors || [];
    const stState = status.type?.state || '';
    const stName = (status.type?.name || '').toUpperCase();

    if (players.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No players' }) };

    // Not during active play — tweet next event preview
    if (!force && stState !== 'in' && stState !== 'post' && stName !== 'STATUS_FINAL') {
      return await tweetNextEvent(headers, force);
    }

    const top5 = players.slice(0, 5).map(p => ({
      name: p.athlete?.shortName || p.athlete?.displayName || '?',
      fullName: p.athlete?.displayName || '?',
      score: typeof p.score === 'string' ? p.score : '?',
      order: p.order || 99,
      today: p.linescores?.[round - 1]?.displayValue || '',
      id: p.id || p.athlete?.id || '',
    }));

    // Build top 8 for graphic (with IDs for headshots)
    const top8 = players.slice(0, 8).map(p => ({
      name: p.athlete?.shortName || p.athlete?.displayName || '?',
      score: typeof p.score === 'string' ? p.score : '?',
      today: p.linescores?.[round - 1]?.displayValue || '',
      id: p.id || p.athlete?.id || '',
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

    // Never tweet if last tweet was less than 10 minutes ago
    if (!force && minutesSinceLastTweet < 10) {
      return { statusCode: 200, headers, body: JSON.stringify({
        skipped: 'Too soon since last tweet',
        minutesSinceLastTweet: Math.round(minutesSinceLastTweet),
      })};
    }

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

    // Build tweet — group chat voice, no emojis, no hashtags
    let tweetText = '';

    if (isFinal) {
      if (tied.length > 1) {
        tweetText = `Playoff at the ${tourneyName}. ${tied.map(p => p.name).join(' vs ')}. This is about to be unreal.`;
      } else {
        tweetText = `${leader.fullName} wins the ${tourneyName} at ${leader.score}.\n\n${top5.slice(1, 3).map((p,i) => `${p.name} (${p.score})`).join(', ')} couldn't catch him. Built different.`;
      }
    } else if (isRoundComplete) {
      if (tied.length > 1) {
        tweetText = `R${round} in the books at the ${tourneyName}.\n\n${tied.length}-way tie at ${leader.score}: ${tied.map(p => p.name).join(', ')}.\n\nTomorrow's going to be chaos.`;
      } else {
        tweetText = `${leader.name} leads the ${tourneyName} at ${leader.score} after R${round}.\n\n${top5[1]?.name} lurking at ${top5[1]?.score}. This isn't over.`;
      }
    } else if (reason === 'leader_change') {
      if (tied.length > 1) {
        tweetText = `New leaders at the ${tourneyName}. Tied at ${leader.score}: ${tied.map(p => p.name).join(', ')}.\n\nThis thing is wide open.`;
      } else {
        tweetText = `${leader.fullName} just grabbed the lead at the ${tourneyName}. ${leader.score} and rolling.\n\nEverybody else is chasing now.`;
      }
    } else if (reason === 'big_mover' && bigMover) {
      tweetText = `${bigMover.fullName} is ${bigMover.today} through the turn at the ${tourneyName}. Now at ${bigMover.score}.\n\nWatch out for this guy.`;
    } else {
      // Hourly update
      if (tied.length > 1) {
        tweetText = `${tourneyName} R${round} update.\n\nTied at ${leader.score}: ${tied.map(p => p.name).join(', ')}\n\n${top5.filter(p => p.score !== leader.score).slice(0,2).map(p => `${p.name} (${p.score})`).join(', ')} right there.`;
      } else {
        tweetText = `${tourneyName} R${round} update.\n\n${leader.name} (${leader.score})\n${top5.slice(1, 4).map(p => `${p.name} (${p.score})`).join('\n')}\n\nThis leaderboard is stacked.`;
      }
    }

    // Check for duplicate content before posting
    if (lastTweet?.allTexts && isTooSimilar(tweetText, lastTweet.allTexts)) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Too similar to recent tweet' }) };
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

