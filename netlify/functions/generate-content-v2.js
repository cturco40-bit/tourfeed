const SB_URL_V2 = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY_V2 = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

// ── FACT CHECK GATE (Part 5) ──
function factCheck(title, body, currentRound, roundComplete) {
  var issues = [];
  var bodyLower = (body || '').toLowerCase();
  // Wrong round references
  for (var r = currentRound + 1; r <= 4; r++) {
    if (bodyLower.includes('round ' + r) && !bodyLower.includes('heading into round ' + r) && !bodyLower.includes('looking ahead to round ' + r)) {
      issues.push('References future Round ' + r + ' as if completed');
    }
  }
  // Recap language during live round
  if (!roundComplete) {
    var recapPhrases = ['finished the round', 'completed round', 'final score of', 'shot a final', 'carded a', 'posted a', 'finished at'];
    recapPhrases.forEach(function(p) { if (bodyLower.includes(p)) issues.push('Recap language during live round: "' + p + '"'); });
  }
  // Must have specific scores
  var scorePattern = /[+-]?\d+\s*(under|over|par|through)/gi;
  var scores = body.match(scorePattern) || [];
  if (scores.length < 1) issues.push('No specific scores found');
  // No unnamed subjects
  var vagueSubjects = ['this golfer', 'the player arrived', 'a local', 'the champion without'];
  vagueSubjects.forEach(function(p) { if (bodyLower.includes(p)) issues.push('Unnamed subject: "' + p + '"'); });
  // Must mention at least one tier-1 player
  var tier1 = ['scheffler','mcilroy','rahm','schauffele','fleetwood','spieth','morikawa','matsuyama','dechambeau','hovland','aberg','koepka','henley'];
  var mentionsPlayer = tier1.some(function(p) { return bodyLower.includes(p); });
  if (!mentionsPlayer) issues.push('No tier-1 player mentioned');
  if (issues.length > 0) {
    console.log('FACT CHECK FAILED for "' + (title || '').slice(0, 50) + '":', issues.join(' | '));
    return false;
  }
  return true;
}

exports.handler = async (event) => {
  var headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };

  // ── Supabase helper ──
  async function sb(path, method, body) {
    var hdrs = { 'apikey': SB_KEY_V2, 'Authorization': 'Bearer ' + SB_KEY_V2, 'Content-Type': 'application/json' };
    if (method === 'POST') hdrs['Prefer'] = 'return=representation';
    if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
    var res = await ft(SB_URL_V2 + '/rest/v1/' + path, { method: method || 'GET', headers: hdrs, body: body ? JSON.stringify(body) : undefined });
    if (!method || method === 'GET') { try { var d = await res.json(); return Array.isArray(d) ? d : []; } catch(e) { return []; } }
    if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
    return res.ok;
  }

  // ── Content hash ──
  function hashText(text) {
    var words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function(w) { return w.length > 3; }).sort().join(' ');
    var hash = 0;
    for (var i = 0; i < words.length; i++) hash = ((hash << 5) - hash + words.charCodeAt(i)) | 0;
    return 'h' + Math.abs(hash).toString(36);
  }

  // ── Claude Haiku wrapper ──
  async function askClaude(systemPrompt, userPrompt, maxTokens) {
    var res = await ft('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 2000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    }, 25000);
    if (!res.ok) throw new Error('Claude API error: ' + res.status);
    var data = await res.json();
    return data.content[0].text;
  }

  // ── Triple dedup check (Part 6) ──
  async function isDuplicate(title, body, contentType, currentRound) {
    var hash = hashText(title + (body || '').slice(0, 200));
    var hashExists = await sb('content_hashes?hash=eq.' + hash + '&select=hash&limit=1');
    if (hashExists.length > 0) { console.log('Hash duplicate — skip'); return true; }
    var sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    var recentTitles = await sb('content_drafts?created_at=gte.' + sixHoursAgo + '&select=title');
    var newWords = (title || '').toLowerCase().split(' ').filter(function(w) { return w.length > 4; });
    var titleDupe = recentTitles.some(function(d) {
      var existing = ((d.title || '')).toLowerCase().split(' ').filter(function(w) { return w.length > 4; });
      return newWords.filter(function(w) { return existing.includes(w); }).length >= 3;
    });
    if (titleDupe) { console.log('Title duplicate — skip: ' + title); return true; }
    if (contentType === 'article_recap') {
      var roundCovered = await sb('content_drafts?type=eq.article_recap&source_event=eq.round-' + currentRound + '&select=id&limit=1');
      if (roundCovered.length > 0) { console.log('Round already recapped'); return true; }
    }
    await sb('content_hashes', 'POST', { hash: hash, type: contentType, source: 'generate-content-v2', created_at: new Date().toISOString() });
    return false;
  }

  try {
    // ══ PART 1: DATE AND TIME INJECTION ══
    var now = new Date();
    var dateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
    var timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    var etHour = parseInt(now.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/New_York' }));

    // ══ Get tournament ══
    var tournaments = await sb('tournaments?select=*&status=eq.in_progress&order=start_date.desc&limit=1');
    if (!tournaments.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No active tournament in progress' }) };
    var tournament = tournaments[0];
    var tournamentId = tournament.id;
    var currentRound = tournament.current_round || 1;
    var tourName = tournament.tour_id === 'pga' ? 'PGA Tour' : tournament.tour_id || '';

    // ══ PART 2: DATA FRESHNESS GATE ══
    var lbResult = await sb('leaderboard?tournament_id=eq.' + tournamentId + '&select=updated_at&order=updated_at.desc&limit=1');
    if (!lbResult.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No leaderboard data available' }) };
    var dataAgeMinutes = (Date.now() - new Date(lbResult[0].updated_at).getTime()) / 60000;
    console.log('Leaderboard data age:', Math.floor(dataAgeMinutes), 'minutes');
    if (dataAgeMinutes > 30) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Leaderboard data ' + Math.floor(dataAgeMinutes) + ' min old — too stale' }) };

    // ══ Get leaderboard ══
    var leaderboard = await sb('leaderboard?tournament_id=eq.' + tournamentId + '&select=*,players(id,name,country)&order=position.asc&limit=200');
    if (!leaderboard.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No leaderboard data' }) };
    var validPlayers = leaderboard.filter(function(p) { return p.players?.name && p.players.name !== 'Unknown' && p.total_score && p.total_score !== '--'; });
    if (validPlayers.length < 10) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Only ' + validPlayers.length + ' valid players — need 10+' }) };

    // ══ PART 3: ROUND GATE — STRICT ══
    var completedPlayers = leaderboard.filter(function(p) { return p.thru === 'F' || p.thru === '18'; }).length;
    var roundComplete = completedPlayers >= 88 || new Date().getUTCHours() >= 22;
    console.log('Completed players:', completedPlayers, '— round', roundComplete ? 'COMPLETE' : 'IN PROGRESS');

    // ══ Fetch picks ══
    var picksContext = '';
    var currentPicks = [];
    try {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      currentPicks = await sb('betting_picks?created_at=gte.' + sevenDaysAgo + '&order=created_at.asc&limit=10');
      if (currentPicks.length > 0) {
        picksContext = '\nOUR LOCKED PICKS:\n' + currentPicks.map(function(p) {
          return (p.edge_label || '') + ': ' + (p.player_name || '') + ' ' + (p.odds || '') + ' — ' + (p.analysis || '');
        }).join('\n');
      }
    } catch(e) {}
    if (!currentPicks.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No picks — cannot generate content' }) };

    // ══ Build data block ══
    var leaderboardText = validPlayers.slice(0, 20).map(function(p, i) {
      return (p.position || (i + 1)) + '. ' + p.players.name + ' | ' + p.total_score + ' | Thru: ' + (p.thru || '?') + ' | Today: ' + (p.today_score || '?');
    }).join('\n');
    var dataBlock = 'Tournament: ' + tournament.name + '\nCourse: ' + (tournament.course || '') + '\nRound: ' + currentRound + '\n\nLeaderboard:\n' + leaderboardText;

    // ══ PART 1 continued: Date/time/round status header ══
    var dateHeader = 'TODAY IS ' + dateString + ' AT ' + timeString + ' EASTERN TIME.\nCURRENT TOURNAMENT: ' + tournament.name + ' at ' + (tournament.course || 'Augusta National') + '.\nCURRENT ROUND: Round ' + currentRound + '.\nROUND STATUS: ' + (roundComplete ? 'ROUND COMPLETE — ALL PLAYERS HAVE FINISHED' : 'ROUND IN PROGRESS — DO NOT RECAP OR REFERENCE ROUND AS FINISHED') + '.\nCRITICAL: Every factual statement must reflect this exact date and time. Never reference events from previous rounds as current. Never preview future rounds as if happening now. Never recap a round that is still in progress.';

    // ══ PART 8: PROFESSIONAL VOICE ══
    var proVoice = 'You are the lead staff writer at TourFeed — an independent professional golf media and betting analysis publication.\n\nWRITING STANDARDS:\n- Every factual claim must come from the data provided\n- Lead with the most interesting insight, not the most obvious fact\n- Tell readers what the leaderboard MEANS, not just what it shows\n- Be specific: exact scores, exact positions, exact odds\n- Present tense for live content, past tense for recaps\n- Every sentence must earn its place\n\nBANNED PHRASES: Augusta rewards precision, wide open tournament, anyone can win, momentum heading into, Amen Corner will be key, course knowledge matters, the Masters is unlike any other, make no mistake, at the end of the day, in conclusion, it is worth noting, unpacked, delve, landscape, paradigm, utilize, leverage\n\nHEADLINE FORMAT: Must include a specific player name AND a specific number.\n\nPICKS INTEGRATION: ' + picksContext + '\nEvery article must connect to our picks — how is our best bet tracking? Is our fade working?';

    var systemBase = dateHeader + '\n\n' + proVoice;

    // Player facts
    var playerContext = '';
    try {
      var facts = await sb('player_facts?select=*&limit=30');
      if (facts.length > 0) {
        var names = validPlayers.slice(0, 15).map(function(p) { return p.players?.name?.toLowerCase() || ''; });
        playerContext = '\n\nPLAYER FACTS:\n' + facts.filter(function(f) {
          return names.some(function(n) { return n.includes(f.player_name.toLowerCase().split(' ').pop()); });
        }).map(function(f) {
          return f.player_name + ': #' + (f.world_ranking || '?') + ', ' + (f.total_majors || 0) + ' majors' + (f.masters_wins ? ', ' + f.masters_wins + 'x Masters champ' : '') + (f.career_grand_slam ? ', Career Grand Slam' : '') + (f.recent_notes ? '. ' + f.recent_notes : '');
        }).join('\n');
      }
    } catch(e) {}

    var fullContext = dataBlock + playerContext;
    var results = { tournament: tournament.name, round: currentRound, generated: [], skipped: [] };

    // ══ PART 7: TWEET RATE LIMITING ══
    var todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    var todayTweets = await sb('content_drafts?type=eq.tweet_content&created_at=gte.' + todayStart + '&select=id,body,created_at&order=created_at.desc');
    var dailyLimit = roundComplete ? 4 : 8;
    var tweetLimitReached = todayTweets.length >= dailyLimit;
    var minInterval = roundComplete ? 90 : 28;
    var tooSoon = false;
    if (todayTweets.length > 0) {
      var minsSinceLast = (Date.now() - new Date(todayTweets[0].created_at).getTime()) / 60000;
      if (minsSinceLast < minInterval) tooSoon = true;
    }
    var quietHours = etHour >= 23 || etHour < 6;

    // Last tweet player for anti-repetition
    var lastPlayer = '';
    if (todayTweets.length > 0) {
      var ltp = ['Scheffler','McIlroy','Rahm','Schauffele','Fleetwood','Spieth','Morikawa','Matsuyama','DeChambeau','Hovland','Henley'];
      lastPlayer = ltp.find(function(p) { return (todayTweets[0].body || '').includes(p); }) || '';
    }

    // ══════════════════════════════════════
    // PART 4: CONTENT SCHEDULE
    // ══════════════════════════════════════

    // ── DURING LIVE ROUND: tweets only ──
    if (!roundComplete) {
      // Live tweet
      if (tweetLimitReached) {
        results.skipped.push('tweet: daily limit ' + todayTweets.length + '/' + dailyLimit);
      } else if (tooSoon) {
        results.skipped.push('tweet: too soon since last');
      } else if (quietHours) {
        results.skipped.push('tweet: quiet hours');
      } else {
        try {
          var tweetSystem = systemBase + '\n\nWrite ONE live update tweet about the current round. Must reference a specific player, specific score, specific position from the leaderboard. Format: "[Player] moves to [score] through [X] holes, now [position]. [One insight]. tourfeed.co"' + (lastPlayer ? '\nDo NOT write about ' + lastPlayer + ' — write about a different player.' : '');
          var tweetRaw = await askClaude(tweetSystem, 'Write 1 live update tweet from this leaderboard:\n\n' + fullContext, 200);
          var tweet = tweetRaw.replace(/^\d[\.\)]\s*/, '').trim();
          if (tweet && tweet.length > 20 && !await isDuplicate(tweet, '', 'tweet_content', currentRound)) {
            if (factCheck('tweet', tweet, currentRound, roundComplete)) {
              await sb('content_drafts', 'POST', { type: 'tweet_content', title: tournament.name + ' R' + currentRound, body: tweet, tournament_id: tournamentId, status: 'pending', created_at: new Date().toISOString() });
              results.generated.push('live_tweet');
            } else { results.skipped.push('tweet: failed fact check'); }
          } else { results.skipped.push('tweet: duplicate or too short'); }
        } catch(e) { results.skipped.push('tweet: ' + e.message); }
      }

      // Live blog post (every 60 min — check if one exists in last hour)
      var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      var recentBlog = await sb('content_drafts?type=eq.article_news&created_at=gte.' + oneHourAgo + '&select=id&limit=1');
      if (recentBlog.length > 0) {
        results.skipped.push('live_blog: one exists within last hour');
      } else {
        try {
          var blogSystem = systemBase + '\n\n150-200 words MAXIMUM. This is a live blog update, not a full article. Title format: "Masters Live: [Most Significant Development] — Round ' + currentRound + ' Update ' + timeString + ' ET". Include: current leader and score, biggest mover, one betting implication from our picks.';
          var blogRaw = await askClaude(blogSystem, 'Write a live blog update:\n\nHEADLINE: <headline>\n\nBODY:\n<HTML with <p> tags>\n\n' + fullContext, 800);
          var blogTitle = 'Masters Live Update — R' + currentRound;
          var blogBody = blogRaw;
          var hlM = blogRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
          if (hlM) blogTitle = hlM[1].trim();
          var bdM = blogRaw.match(/BODY:\s*([\s\S]+)/);
          if (bdM) blogBody = bdM[1].trim();
          if (blogTitle && blogBody && !await isDuplicate(blogTitle, blogBody, 'article_news', currentRound)) {
            if (factCheck(blogTitle, blogBody, currentRound, roundComplete)) {
              await sb('content_drafts', 'POST', { type: 'article_news', title: blogTitle, body: blogBody, tournament_id: tournamentId, source_event: 'live-blog', status: 'pending', created_at: new Date().toISOString() });
              results.generated.push('live_blog');
            } else { results.skipped.push('live_blog: failed fact check'); }
          } else { results.skipped.push('live_blog: duplicate'); }
        } catch(e) { results.skipped.push('live_blog: ' + e.message); }
      }
    }

    // ── AFTER ROUND COMPLETE: recap + betting + tweets ──
    if (roundComplete) {
      // 1. RECAP ARTICLE
      var existingRecap = await sb('content_drafts?type=eq.article_recap&source_event=eq.round-' + currentRound + '&select=id&limit=1');
      var publishedRecap = await sb('articles?type=eq.recap&tournament_id=eq.' + encodeURIComponent(tournamentId) + '&select=id&limit=1');
      if (existingRecap.length > 0 || publishedRecap.length > 0) {
        results.skipped.push('article_recap: R' + currentRound + ' already recapped');
      } else {
        try {
          var recapSystem = systemBase + '\n\n400-500 words. Round recap article. Must include: top 5 with exact scores, biggest storyline, betting implication from our picks. Past tense — round is finished. Use <p> tags for HTML.';
          var recapRaw = await askClaude(recapSystem, 'Write a round ' + currentRound + ' recap article.\n\nHEADLINE: <headline with player name and score>\n\nBODY:\n<HTML article>\n\n' + fullContext, 2000);
          var recapTitle = 'Round ' + currentRound + ' Recap';
          var recapBody = recapRaw;
          var rhlM = recapRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
          if (rhlM) recapTitle = rhlM[1].trim();
          var rbdM = recapRaw.match(/BODY:\s*([\s\S]+)/);
          if (rbdM) recapBody = rbdM[1].trim();
          if (!await isDuplicate(recapTitle, recapBody, 'article_recap', currentRound)) {
            if (factCheck(recapTitle, recapBody, currentRound, roundComplete)) {
              await sb('content_drafts', 'POST', { type: 'article_recap', title: recapTitle, body: recapBody, tournament_id: tournamentId, source_event: 'round-' + currentRound, status: 'pending', created_at: new Date().toISOString() });
              results.generated.push('article_recap');
            } else { results.skipped.push('article_recap: failed fact check'); }
          } else { results.skipped.push('article_recap: duplicate'); }
        } catch(e) { results.skipped.push('article_recap: ' + e.message); }
      }

      // 2. BETTING ARTICLE
      var existingBetting = await sb('content_drafts?type=eq.article_betting&source_event=eq.betting-round-' + currentRound + '&select=id&limit=1');
      if (existingBetting.length > 0) {
        results.skipped.push('article_betting: R' + currentRound + ' already covered');
      } else {
        try {
          var bestBetStr = 'our top value pick';
          var bb = currentPicks.find(function(p) { return p.edge_label === 'BEST BET'; });
          if (bb) bestBetStr = bb.player_name + ' ' + bb.odds;
          var bettingSystem = systemBase + '\n\n400-500 words. Betting analysis after round ' + currentRound + '. Lead with BEST BET: ' + bestBetStr + '. Show how each locked pick is tracking. Use <h3> for sections, <p> for paragraphs.';
          var bettingRaw = await askClaude(bettingSystem, 'Write a betting update after round ' + currentRound + '.\n\nHEADLINE: <headline with best bet player and odds>\n\nBODY:\n<HTML article>\n\n' + fullContext, 2000);
          var bettingTitle = 'Betting Update — Round ' + currentRound;
          var bettingBody = bettingRaw;
          var bhlM = bettingRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
          if (bhlM) bettingTitle = bhlM[1].trim();
          var bbdM = bettingRaw.match(/BODY:\s*([\s\S]+)/);
          if (bbdM) bettingBody = bbdM[1].trim();
          if (!await isDuplicate(bettingTitle, bettingBody, 'article_betting', currentRound)) {
            if (factCheck(bettingTitle, bettingBody, currentRound, roundComplete)) {
              await sb('content_drafts', 'POST', { type: 'article_betting', title: bettingTitle, body: bettingBody, tournament_id: tournamentId, source_event: 'betting-round-' + currentRound, status: 'pending', created_at: new Date().toISOString() });
              results.generated.push('article_betting');
            } else { results.skipped.push('article_betting: failed fact check'); }
          } else { results.skipped.push('article_betting: duplicate'); }
        } catch(e) { results.skipped.push('article_betting: ' + e.message); }
      }

      // 3. TWO promotional tweets (if not at limit)
      if (!tweetLimitReached && !quietHours) {
        try {
          var promoSystem = systemBase + '\n\nWrite 2 tweets promoting our recap and betting articles. Tweet 1 promotes recap with specific detail. Tweet 2 promotes betting update with specific pick mention. Both end with tourfeed.co. ZERO emojis. ZERO hashtags.';
          var promoRaw = await askClaude(promoSystem, 'Write 2 promotional tweets.\n\n' + fullContext, 400);
          var promoTweets = promoRaw.split('\n').filter(function(l) { return l.trim().length > 20; }).map(function(l) { return l.replace(/^\d[\.\)]\s*/, '').trim(); }).slice(0, 2);
          for (var ti = 0; ti < promoTweets.length; ti++) {
            if (!await isDuplicate(promoTweets[ti], '', 'tweet_content', currentRound)) {
              await sb('content_drafts', 'POST', { type: 'tweet_content', title: tournament.name + ' R' + currentRound, body: promoTweets[ti], tournament_id: tournamentId, status: 'pending', created_at: new Date().toISOString() });
              results.generated.push('promo_tweet_' + (ti + 1));
            }
          }
        } catch(e) { results.skipped.push('promo_tweets: ' + e.message); }
      }
    }

    // ── Notify ──
    if (results.generated.length > 0) {
      try {
        await ft('https://ntfy.sh/tourfeed-alerts', { method: 'POST', headers: { 'Title': 'Drafts Ready', 'Priority': '3' }, body: results.generated.length + ' drafts — ' + results.generated.join(', ') + ' (' + tournament.name + ' R' + currentRound + ')' });
      } catch(e) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify(results) };
  } catch(e) {
    console.log('generate-content-v2 error:', e.message);
    try { await ft('https://ntfy.sh/tourfeed-alerts', { method: 'POST', headers: { 'Title': 'TourFeed Error', 'Priority': '5' }, body: 'generate-content failed: ' + e.message }); } catch(ne) {}
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
