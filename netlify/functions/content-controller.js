// content-controller.js — Single unified content brain
// Replaces generate-content-v2 and blog-scheduler
// Every 30 minutes: establish ground truth → safety checks → decide what to generate → generate → fact check → dedup → save

const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

async function sb(path, method, body) {
  var hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  var res = await ft(SB_URL + '/rest/v1/' + path, { method: method || 'GET', headers: hdrs, body: body ? JSON.stringify(body) : undefined });
  if (!method || method === 'GET') { try { var d = await res.json(); return Array.isArray(d) ? d : []; } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

function hashText(text) {
  var words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function(w) { return w.length > 3; }).sort().join(' ');
  var h = 0;
  for (var i = 0; i < words.length; i++) h = ((h << 5) - h + words.charCodeAt(i)) | 0;
  return 'h' + Math.abs(h).toString(36);
}

async function askClaude(systemPrompt, userPrompt, maxTokens) {
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  var res = await ft('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 2000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
  }, 25000);
  if (!res.ok) throw new Error('Claude API error: ' + res.status);
  var data = await res.json();
  return data.content[0].text;
}

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    // ════════════════════════════════════════
    // STEP 1 — ESTABLISH GROUND TRUTH
    // ════════════════════════════════════════
    var now = new Date();
    var etDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
    var etTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    var etHour = parseInt(now.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/New_York' }));

    var tournament = await sb('tournaments?status=eq.in_progress&select=*&limit=1');
    var tournamentLive = tournament.length > 0;
    var currentRound = tournament[0]?.current_round || 0;
    var tournamentId = tournament[0]?.id;
    var tournamentName = tournament[0]?.name || 'Tournament';
    var tournamentCourse = tournament[0]?.course || '';
    var tournamentTour = tournament[0]?.tour_id || 'pga';
    var isLIV = tournamentTour === 'liv';

    var lb = tournamentId ? await sb('leaderboard?tournament_id=eq.' + tournamentId + '&order=position.asc&limit=200&select=*,players(name)') : [];
    var lbAge = lb.length > 0 && lb[0].updated_at ? (Date.now() - new Date(lb[0].updated_at).getTime()) / 60000 : 999;
    var completed = lb.filter(function(p) { return p.thru === 'F' || p.thru === '18'; }).length;
    var roundComplete = completed >= 88;

    console.log(JSON.stringify({ date: etDate, time: etTime, hour: etHour, tournamentLive: tournamentLive, currentRound: currentRound, roundComplete: roundComplete, completedPlayers: completed, lbAgeMinutes: Math.floor(lbAge) }));

    // ════════════════════════════════════════
    // STEP 2 — SAFETY CHECKS
    // ════════════════════════════════════════
    if (!tournamentLive) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No active tournament' }) };
    if (lbAge > 30) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Leaderboard ' + Math.floor(lbAge) + 'min stale — aborting' }) };
    if (etHour < 6) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Quiet hours — no content before 6am ET' }) };

    // ════════════════════════════════════════
    // STEP 3 — GET DAILY COUNTS
    // ════════════════════════════════════════
    var todayStart = now.toISOString().split('T')[0] + 'T00:00:00Z';
    var todayDrafts = await sb('content_drafts?created_at=gte.' + todayStart + '&select=id,type,title,body,created_at&order=created_at.desc');
    var counts = {
      tweets: todayDrafts.filter(function(d) { return d.type === 'tweet_content'; }).length,
      articles: todayDrafts.filter(function(d) { return d.type === 'article_recap' || d.type === 'article_betting' || d.type === 'article_analysis'; }).length,
      recaps: todayDrafts.filter(function(d) { return d.type === 'article_recap'; }).length,
      betting: todayDrafts.filter(function(d) { return d.type === 'article_betting'; }).length,
      live: todayDrafts.filter(function(d) { return d.type === 'live_update' || d.type === 'article_news'; }).length
    };
    var lastTweet = todayDrafts.find(function(d) { return d.type === 'tweet_content'; });
    var minsSinceLastTweet = lastTweet ? (Date.now() - new Date(lastTweet.created_at).getTime()) / 60000 : 999;
    console.log('Daily counts:', JSON.stringify(counts));

    if (counts.articles >= 6) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Daily article limit — ' + counts.articles + '/6' }) };

    // ════════════════════════════════════════
    // STEP 4 — DECIDE WHAT TO GENERATE
    // ════════════════════════════════════════
    var queue = [];

    // Live blog — during round, max 1/hour
    if (!roundComplete && counts.live < (currentRound * 8) && etHour >= 8 && etHour <= 20) {
      var lastLive = todayDrafts.find(function(d) { return d.type === 'live_update' || d.type === 'article_news'; });
      var minsSinceLive = lastLive ? (Date.now() - new Date(lastLive.created_at).getTime()) / 60000 : 999;
      if (minsSinceLive >= 55) queue.push('live_update');
    }

    // Tweet — rate limited
    var tweetLimit = roundComplete ? 4 : 8;
    if (counts.tweets < tweetLimit && minsSinceLastTweet >= 28 && etHour >= 6 && etHour < 23) {
      queue.push('tweet_content');
    }

    // Recap — only after round complete, one per round
    if (roundComplete && counts.recaps === 0) {
      var existingRecap = await sb('content_drafts?type=eq.article_recap&source_event=eq.recap-round-' + currentRound + '&select=id&limit=1');
      var pubRecap = await sb('articles?type=eq.recap&tournament_id=eq.' + encodeURIComponent(tournamentId) + '&select=id&limit=1');
      if (existingRecap.length === 0 && pubRecap.length === 0) queue.push('article_recap');
    }

    // Betting — only after round complete, one per round
    if (roundComplete && counts.betting === 0) {
      var existingBetting = await sb('content_drafts?type=eq.article_betting&source_event=eq.betting-round-' + currentRound + '&select=id&limit=1');
      if (existingBetting.length === 0) queue.push('article_betting');
    }

    // Daily analysis — between rounds only, 6am-8am ET, max 1/day
    if (etHour >= 6 && etHour < 8 && counts.articles === 0) {
      var existingAnalysis = await sb('content_drafts?type=eq.article_analysis&created_at=gte.' + todayStart + '&select=id&limit=1');
      if (existingAnalysis.length === 0) queue.push('article_analysis');
    }

    console.log('Content queue:', queue);
    if (queue.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Nothing to generate', counts: counts }) };

    // ════════════════════════════════════════
    // STEP 5 — BUILD SHARED CONTEXT
    // ════════════════════════════════════════
    var picks = await sb('betting_picks?select=*&order=created_at.asc&limit=10');
    var picksContext = picks.length > 0
      ? 'OUR LOCKED PICKS:\n' + picks.map(function(p) { return p.edge_label + ': ' + p.player_name + ' ' + p.odds + ' — ' + (p.analysis || ''); }).join('\n')
      : 'No picks set yet';

    if (!picks.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No picks — cannot generate content' }) };

    var leaderboardContext = 'LIVE LEADERBOARD (as of ' + Math.floor(lbAge) + ' min ago):\n' +
      lb.slice(0, 15).map(function(p) { return (p.position || '?') + '. ' + (p.players?.name || '?') + ' ' + (p.total_score || '') + ' (today: ' + (p.today_score || '?') + ', thru: ' + (p.thru || '?') + ')'; }).join('\n');

    // ── PGA GraphQL enrichment — live context + SG leaders + course difficulty ──
    // Populated by fetch-pga-graphql.js cron. Null-safe: if anything is stale or missing,
    // the prompt just drops the enrichment sections instead of injecting placeholders.
    var pgaContext = '';
    try {
      var tlc = tournament[0]?.pga_tournament_id
        ? await sb('tournament_live_context?pga_tournament_id=eq.' + encodeURIComponent(tournament[0].pga_tournament_id) + '&select=*&limit=1')
        : [];
      if (tlc.length > 0) {
        var ctx = tlc[0];
        if (ctx.projected_cut_line) pgaContext += 'PROJECTED CUT LINE: ' + ctx.projected_cut_line + (ctx.probable_cut_line ? ' (probable: ' + ctx.probable_cut_line + ')' : '') + '\n';
        var leaders = Array.isArray(ctx.leaders_json) ? ctx.leaders_json : [];
        var withOdds = leaders.filter(function(x) { return x.odds; });
        if (withOdds.length > 0) {
          pgaContext += 'LIVE WIN ODDS (top 5):\n' + withOdds.slice(0, 5).map(function(x) { return '  ' + x.player + ' ' + x.total + ' — ' + x.odds; }).join('\n') + '\n';
        }
      }
    } catch(e) { console.log('tlc fetch:', e.message); }

    try {
      var season = new Date().getUTCFullYear();
      var sgl = await sb('sg_leaders?tour_code=eq.R&season=eq.' + season + '&select=stat_title,player_name,stat_value,rank&order=stat_id.asc');
      if (sgl.length > 0) {
        pgaContext += '\nSEASON STROKES GAINED LEADERS (' + season + '):\n' +
          sgl.map(function(s) { return '  ' + s.stat_title + ' — ' + s.player_name + ' (' + s.stat_value + ')'; }).join('\n') + '\n';
      }
    } catch(e) {}

    try {
      if (tournament[0]?.pga_tournament_id) {
        var holes = await sb('course_holes?pga_tournament_id=eq.' + encodeURIComponent(tournament[0].pga_tournament_id) + '&select=hole,par,yards,avg_score,rank&order=rank.asc&limit=5');
        if (holes.length > 0) {
          pgaContext += '\nCOURSE — 5 HARDEST HOLES:\n' +
            holes.map(function(h) { return '  #' + h.hole + ' par ' + h.par + ' (' + (h.yards || '?') + 'y) avg: ' + (h.avg_score || '?'); }).join('\n') + '\n';
        }
      }
    } catch(e) {}

    if (pgaContext) pgaContext = '\n\n═══ PGA TOUR LIVE DATA ═══\n' + pgaContext + '═══════════════════════\n';

    var fieldSize = isLIV ? 54 : (lb.length || 156);
    var dateHeader = 'TODAY IS ' + etDate + ' AT ' + etTime + ' EASTERN TIME.\nTOURNAMENT: ' + tournamentName + (tournamentCourse ? ', ' + tournamentCourse : '') + '.\nTOUR: ' + tournamentTour.toUpperCase() + '.\nCURRENT ROUND: Round ' + currentRound + ' of ' + (isLIV ? 3 : 4) + '.\nROUND STATUS: ' + (roundComplete ? 'COMPLETE — ALL PLAYERS FINISHED' : 'IN PROGRESS — ' + completed + '/' + fieldSize + ' players done') + '.\nCRITICAL: Only write about events that have happened as of this exact time. Never reference future rounds as current. Never recap a round still in progress.';

    var factsContext = '';
    try {
      var pf = await sb('player_facts?select=player_name,world_ranking,total_majors,masters_wins,recent_notes&limit=30');
      factsContext = pf.map(function(f) { return f.player_name + ': #' + (f.world_ranking || '?') + ', ' + (f.total_majors || 0) + ' majors' + (f.masters_wins ? ', ' + f.masters_wins + 'x Masters champ' : '') + (f.recent_notes ? '. ' + f.recent_notes : ''); }).join('\n');
    } catch(e) {}

    var golfGuardrails = 'GOLF FACTUAL RULES — NEVER VIOLATE:\n' +
      '- Scores relative to par: "-7" or "7-under", never "negative 7". Cumulative vs round score matter — use the leaderboard data exactly.\n' +
      '- Strokes gained categories are ONLY: Off-the-Tee, Approach, Around-the-Green, Putting, Tee-to-Green, Total. Never invent others. Never invent specific SG numbers — only cite numbers present in the data.\n' +
      '- Cut: PGA Tour uses top-65 and ties after 36 holes. LIV events have NO cut and a 54-player field. Do not reference a cut at LIV events.\n' +
      '- Majors are: Masters (April, Augusta National), PGA Championship (May), US Open (June), Open Championship (July, in the UK). Never confuse "Open Championship" with "US Open" — they are different majors.\n' +
      '- World ranking = OWGR (Official World Golf Ranking). FedEx Cup points are separate and PGA-only. Race to Dubai is the DP World Tour equivalent. Do not mix them.\n' +
      '- Player names must match real current tour players exactly. Never invent players, coaches, caddies, or equipment deals.\n' +
      '- Only write about events that have actually happened as of the timestamp above.';

    var sharedSystemPrompt = dateHeader + pgaContext + '\n\n' + golfGuardrails + '\n\nPLAYER FACTS:\n' + factsContext + '\n\n' + picksContext +
      '\n\nYOU ARE THE LEAD WRITER AT TOURFEED. Write with authority and specificity.\nEvery factual claim must come from the data provided above.\nConnect every piece to our locked picks.\nBANNED: wide open tournament, anyone can win, momentum heading into, make no mistake, in conclusion, this golfer, the player, delve, landscape, paradigm.\nHEADLINES must include a specific player name AND a specific number.\nNEVER refuse. NEVER ask questions. ALWAYS produce the content.';

    // ════════════════════════════════════════
    // STEP 6 — FACT CHECK
    // ════════════════════════════════════════
    function factCheck(contentType, title, body) {
      var issues = [];
      var bl = (body || '').toLowerCase();
      var tl = (title || '').toLowerCase();
      var totalRounds = isLIV ? 3 : 4;
      for (var r = currentRound + 1; r <= totalRounds; r++) {
        if (bl.includes('round ' + r) && !bl.includes('heading into round ' + r) && !bl.includes('before round ' + r)) issues.push('References future Round ' + r);
      }
      if (!roundComplete) {
        ['finished the round','completed round','shot a final','carded a','posted a final','finished at'].forEach(function(p) { if (bl.includes(p)) issues.push('Recap language during live round: ' + p); });
      }
      var scores = body.match(/[+-]?\d+\s*(under|over|par|through)/gi) || [];
      if (scores.length < 1 && !['tweet_content', 'live_update'].includes(contentType)) issues.push('No specific scores');
      ['this golfer','the player without','a local champion'].forEach(function(p) { if (bl.includes(p)) issues.push('Unnamed subject: ' + p); });
      ['fashion','sartorial','wardrobe','timepiece','watches','style game'].forEach(function(p) { if ((tl + bl).includes(p)) issues.push('Lifestyle content: ' + p); });
      var tier1 = ['scheffler','mcilroy','rahm','schauffele','fleetwood','spieth','morikawa','matsuyama','dechambeau','hovland','henley','aberg','koepka'];
      if (!tier1.some(function(p) { return bl.includes(p); })) issues.push('No tier-1 player');
      return issues;
    }

    // ════════════════════════════════════════
    // STEP 7+8 — GENERATE, CHECK, SAVE
    // ════════════════════════════════════════
    var results = [];

    for (var qi = 0; qi < queue.length; qi++) {
      var contentType = queue[qi];
      try {
        var userPrompt = '';
        var maxTokens = 2000;

        if (contentType === 'live_update') {
          userPrompt = 'Write a 150-200 word live update blog post. Title format: "Masters Live: [Most Significant Development] — Round ' + currentRound + ' Update ' + etTime + ' ET". Include: current leader, biggest mover, one betting implication from our picks.\n\nHEADLINE: <headline>\n\nBODY:\n<HTML with <p> tags>\n\n' + leaderboardContext;
          maxTokens = 800;
        } else if (contentType === 'tweet_content') {
          var lastBody = lastTweet?.body || '';
          var tp = ['Scheffler','McIlroy','Rahm','Schauffele','Fleetwood','Spieth','Morikawa','Matsuyama','Henley'];
          var lastMentioned = tp.find(function(p) { return lastBody.includes(p); }) || '';
          userPrompt = 'Write ONE tweet under 260 characters. Must mention a specific player, specific score, specific position. End with tourfeed.co.' + (lastMentioned ? ' Do NOT write about ' + lastMentioned + '.' : '') + '\n\n' + leaderboardContext;
          maxTokens = 200;
        } else if (contentType === 'article_recap') {
          userPrompt = 'Write a Round ' + currentRound + ' recap (400-500 words). Title must include leader name and score. Include: top 5 with exact scores, biggest storyline, how our picks performed. Use <p> and <h3> tags.\n\nHEADLINE: <headline>\n\nBODY:\n<HTML>\n\n' + leaderboardContext;
        } else if (contentType === 'article_betting') {
          var bb = picks.find(function(p) { return p.edge_label === 'BEST BET'; });
          var bbStr = bb ? bb.player_name + ' ' + bb.odds : 'our best bet';
          userPrompt = 'Write a Round ' + currentRound + ' betting update (400-500 words). Title must include ' + bbStr + '. Show how each locked pick is tracking. Use <h3> and <p> tags.\n\nHEADLINE: <headline>\n\nBODY:\n<HTML>\n\n' + leaderboardContext;
        } else if (contentType === 'article_analysis') {
          userPrompt = 'Write a 400-500 word pre-round analysis for Round ' + (currentRound + 1) + '. What to watch. How our picks are positioned heading into the round. Who has momentum. Who is on the cut bubble. Use <h3> and <p> tags.\n\nHEADLINE: <headline with player name and number>\n\nBODY:\n<HTML>\n\n' + leaderboardContext;
        }

        var raw = await askClaude(sharedSystemPrompt, userPrompt, maxTokens);
        var title = tournamentName + ' Update';
        var body = raw;

        // Parse HEADLINE/BODY format
        var hlM = raw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
        if (hlM) title = hlM[1].trim();
        var bdM = raw.match(/BODY:\s*([\s\S]+)/);
        if (bdM) body = bdM[1].trim();
        if (contentType === 'tweet_content') { title = tournamentName + ' R' + currentRound; body = raw.replace(/^\d[\.\)]\s*/, '').trim(); }

        // Fact check
        var issues = factCheck(contentType, title, body);
        if (issues.length > 0) {
          console.log('FACT CHECK FAILED:', contentType, issues);
          results.push({ skipped: contentType, reason: issues.join(', ') });
          continue;
        }

        // Triple dedup
        var hash = hashText(title + (body || '').slice(0, 200));
        var hashExists = await sb('content_hashes?hash=eq.' + hash + '&select=hash&limit=1');
        if (hashExists.length > 0) { results.push({ skipped: contentType, reason: 'Hash duplicate' }); continue; }
        var sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        var recentTitles = await sb('content_drafts?created_at=gte.' + sixHoursAgo + '&select=title');
        var titleWords = (title || '').toLowerCase().split(' ').filter(function(w) { return w.length > 4; });
        var isDupe = recentTitles.some(function(d) {
          var existing = ((d.title || '')).toLowerCase().split(' ').filter(function(w) { return w.length > 4; });
          return titleWords.filter(function(w) { return existing.includes(w); }).length >= 3;
        });
        if (isDupe) { results.push({ skipped: contentType, reason: 'Title duplicate' }); continue; }

        // Save draft
        await sb('content_drafts', 'POST', {
          type: contentType, title: title, body: body,
          status: 'pending', tournament_id: tournamentId, round: currentRound,
          source_event: contentType + '-round-' + currentRound,
          created_at: new Date().toISOString()
        });
        await sb('content_hashes', 'POST', { hash: hash, type: contentType, source: 'content-controller', created_at: new Date().toISOString() });
        results.push({ success: true, type: contentType, title: title });
      } catch(e) {
        console.log('Error generating ' + contentType + ':', e.message);
        results.push({ error: contentType, message: e.message });
      }
    }

    // ════════════════════════════════════════
    // STEP 9 — NOTIFY
    // ════════════════════════════════════════
    var generated = results.filter(function(r) { return r.success; });
    if (generated.length > 0) {
      try {
        await ft('https://ntfy.sh/tourfeed-alerts', { method: 'POST', headers: { 'Title': 'Drafts Ready', 'Priority': '3' }, body: generated.length + ' drafts — ' + generated.map(function(r) { return r.type; }).join(', ') + ' (R' + currentRound + ')' });
      } catch(e) {}

      // Push notification to admin browsers
      try {
        await ft('https://tourfeed.co/.netlify/functions/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'TourFeed — ' + generated.length + ' new draft' + (generated.length > 1 ? 's' : '') + ' ready',
            body: generated.map(function(r) { return r.type.toUpperCase() + ': ' + (r.title || '').slice(0, 60); }).slice(0, 3).join('\n')
          })
        });
      } catch(e) { console.log('Push failed:', e.message); }

      // Email notification if SendGrid configured
      if (process.env.SENDGRID_API_KEY && process.env.NOTIFY_EMAIL) {
        try {
          await ft('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: process.env.NOTIFY_EMAIL }] }],
              from: { email: 'drafts@tourfeed.co', name: 'TourFeed Drafts' },
              subject: '[TourFeed] ' + generated.length + ' new draft' + (generated.length > 1 ? 's' : '') + ' ready',
              content: [{ type: 'text/plain', value: 'New drafts:\n\n' + generated.map(function(r) { return '• ' + r.type.toUpperCase() + ': ' + r.title; }).join('\n') + '\n\nApprove at: https://tourfeed.co/tf-admin-drafts\n\nRound ' + currentRound + ' | ' + completed + '/91 done | Data age: ' + Math.floor(lbAge) + ' min' }]
            })
          }, 8000);
        } catch(e) { console.log('Email failed:', e.message); }
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ generated: generated.length, skipped: results.filter(function(r) { return r.skipped; }).length, results: results, counts: counts }) };
  } catch(e) {
    console.log('content-controller error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
