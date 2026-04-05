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

async function postTweet(text, imageUrl) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), image: imageUrl || null }),
  });
  if (!res.ok) throw new Error(`post-tweet ${res.status}: ${await res.text()}`);
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

// Tweet about the next upcoming event when no tournament is active
async function tweetNextEvent(headers, force) {
  try {
    const lastTweet = await getLastTweet();
    const minsSinceLast = lastTweet ? (Date.now() - lastTweet.time.getTime()) / 60000 : 999;

    // Only tweet next event once every 4 hours
    if (!force && minsSinceLast < 240) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Too soon for next event tweet', minutesSinceLast: Math.round(minsSinceLast) }) };
    }
    // Don't repeat if last tweet already mentioned upcoming
    if (!force && lastTweet?.text?.includes('Up Next')) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Already tweeted next event' }) };
    }

    // Fetch schedule to find next event
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
    const comp = next.competitions?.[0];
    const name = next.shortName || next.name || 'Tournament';
    const course = comp?.venue?.fullName || '';
    const startDate = new Date(next.date);
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isMajor = /masters|pga championship|u\.?s\.?\s*open|open championship/i.test(name);

    let tweetText = isMajor
      ? `🏌️ Up Next: ${name}\n\n📍 ${course}\n📅 ${dateStr}\n\nGet ready. Live scores + coverage at https://tourfeed.co\n\n#Golf #PGATour`
      : `⛳ Up Next: ${name}\n\n📍 ${course}\n📅 ${dateStr}\n\nLive scores → https://tourfeed.co/?ref=x\n\n#PGATour #Golf`;

    const nextImg = await getGolfImage(name);
    const result = await postTweet(tweetText, nextImg);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reason: 'next_event', tweet_id: result.data?.id, text: tweetText }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Next event tweet failed', error: err.message }) };
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  // Allow force=true to bypass checks
  const force = event.queryStringParameters?.force === 'true' ||
    (event.body && JSON.parse(event.body).force === true);

  try {
    // Check multiple tours for active events
    const tours = [
      { id: 'pga', sport: 'golf/pga', label: '' },
      { id: 'lpga', sport: 'golf/lpga', label: 'LPGA: ' },
      { id: 'dpw', sport: 'golf/eur', label: 'DP World: ' },
      { id: 'kft', sport: 'golf/kft', label: 'Korn Ferry: ' },
      { id: 'champ', sport: 'golf/champ', label: 'Champions: ' },
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

    // Never tweet if last tweet was less than 15 minutes ago (prevents spam)
    if (!force && minutesSinceLastTweet < 15) {
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

    // Build tweet
    let tweetText = '';

    if (isFinal) {
      if (tied.length > 1) {
        tweetText = `🏆 PLAYOFF at the ${tourneyName}!\n\n${tied.map(p => `${p.name} (${p.score})`).join('\n')}\n\nStay locked in → https://tourfeed.co/?ref=x`;
      } else {
        tweetText = `🏆 ${leader.fullName} wins the ${tourneyName} at ${leader.score}!\n\n${top5.slice(1, 4).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nFull leaderboard → https://tourfeed.co/?ref=x`;
      }
    } else if (isRoundComplete) {
      if (tied.length > 1) {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n${tied.length}-way tie at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\nLive scores → https://tourfeed.co/?ref=x`;
      } else {
        tweetText = `📊 R${round} Complete — ${tourneyName}\n\n🥇 ${leader.name} leads at ${leader.score}\n${top5.slice(1, 3).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\nLive scores → https://tourfeed.co/?ref=x`;
      }
    } else if (reason === 'leader_change') {
      if (tied.length > 1) {
        tweetText = `🔄 NEW LEADERS — ${tourneyName} R${round}\n\nTied at ${leader.score}:\n${tied.map(p => p.name).join(', ')}\n\n→ https://tourfeed.co/?ref=x`;
      } else {
        tweetText = `🔄 LEAD CHANGE — ${tourneyName} R${round}\n\n🥇 ${leader.fullName} takes the lead at ${leader.score}\n\n${top5.slice(1, 3).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}\n\n→ https://tourfeed.co/?ref=x`;
      }
    } else if (reason === 'big_mover' && bigMover) {
      tweetText = `🔥 ${bigMover.fullName} is ${bigMover.today} today at the ${tourneyName}\n\nNow at ${bigMover.score} overall\n\n${tied.length > 1 ? `Leaders (${leader.score}): ${tied.map(p=>p.name).join(', ')}` : `Leader: ${leader.name} (${leader.score})`}\n\n→ https://tourfeed.co/?ref=x`;
    } else {
      // Hourly update with pick
      // Find a value pick — player 2-5 spots back with a good today score
      const parseScore = (s) => s === 'E' ? 0 : (parseInt(s) || 0);
      const leaderNum = parseScore(leader.score);
      const contenders = players.slice(1, 15).map(p => ({
        name: p.athlete?.shortName || '?',
        score: typeof p.score === 'string' ? p.score : '?',
        today: p.linescores?.[round - 1]?.displayValue || '',
        back: Math.abs(parseScore(typeof p.score === 'string' ? p.score : '0') - leaderNum),
      })).filter(p => p.back >= 1 && p.back <= 5);

      const hotPick = contenders
        .filter(p => p.today && p.today !== '-' && parseScore(p.today) < 0)
        .sort((a, b) => parseScore(a.today) - parseScore(b.today))[0];

      let pickLine = '';
      if (hotPick) {
        pickLine = `\n\n🎯 TourFeed Pick: ${hotPick.name} (${hotPick.score}, ${hotPick.today} today)`;
      }

      if (tied.length > 1) {
        tweetText = `⛳ ${tourneyName} — R${round} Update\n\nTied at ${leader.score}:\n${tied.map(p => p.name).join(', ')}${pickLine}\n\n→ https://tourfeed.co/?ref=x`;
      } else {
        tweetText = `⛳ ${tourneyName} — R${round} Update\n\n🥇 ${leader.name} (${leader.score})\n${top5.slice(1, 3).map((p,i) => `${i+2}. ${p.name} (${p.score})`).join('\n')}${pickLine}\n\n→ https://tourfeed.co/?ref=x`;
      }
    }

    // Add hashtags based on tournament/tour
    const hashtags = ['#PGATour', '#Golf'];
    const tn = tourneyName.toLowerCase();
    if (/masters/i.test(tn)) hashtags.unshift('#TheMasters');
    else if (/u\.?s\.?\s*open/i.test(tn)) hashtags.unshift('#USOpen');
    else if (/pga championship/i.test(tn)) hashtags.unshift('#PGAChamp');
    else if (/open championship|the open/i.test(tn)) hashtags.unshift('#TheOpen');
    else if (/valero/i.test(tn)) hashtags.unshift('#ValeroTXOpen');
    else if (/rbc heritage/i.test(tn)) hashtags.unshift('#RBCHeritage');
    if (/lpga/i.test(tourneyName)) { hashtags[1] = '#LPGA'; hashtags[0] = '#LPGATour'; }
    if (/dp world/i.test(tourneyName)) { hashtags[1] = '#DPWorldTour'; }
    if (/korn ferry/i.test(tourneyName)) { hashtags[1] = '#KornFerryTour'; }
    if (/champions/i.test(tourneyName)) { hashtags[1] = '#ChampionsTour'; }

    // Append hashtags if they fit within 280
    const tagStr = '\n\n' + hashtags.join(' ');
    if (tweetText.length + tagStr.length <= 280) tweetText += tagStr;

    // Use TourFeed branded banner as tweet image
    const result = await postTweet(tweetText, 'https://tourfeed.co/og-image.png');

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

