const SB_URL_V2 = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY_V2 = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

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

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  // --- Supabase helper ---
  async function sb(path, method, body) {
    const hdrs = { 'apikey': SB_KEY_V2, 'Authorization': 'Bearer ' + SB_KEY_V2, 'Content-Type': 'application/json' };
    if (method === 'POST') hdrs['Prefer'] = 'return=representation';
    if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
    const res = await ft(SB_URL_V2 + '/rest/v1/' + path, {
      method: method || 'GET',
      headers: hdrs,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!method || method === 'GET') { try { const d = await res.json(); return Array.isArray(d) ? d : []; } catch (e) { return []; } }
    if (method === 'POST' && res.ok) { try { return await res.json(); } catch (e) { return []; } }
    return res.ok;
  }

  // --- Content hash for dedup ---
  function hashText(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3).sort().join(' ');
    let hash = 0;
    for (let i = 0; i < words.length; i++) hash = ((hash << 5) - hash + words.charCodeAt(i)) | 0;
    return 'h' + Math.abs(hash).toString(36);
  }

  // --- Check if content hash already exists ---
  async function isDuplicate(hash) {
    const rows = await sb('content_hashes?hash=eq.' + hash + '&select=hash');
    return rows.length > 0;
  }

  // --- Record a content hash ---
  async function recordHash(hash, contentType) {
    await sb('content_hashes', 'POST', { hash, content_type: contentType, created_at: new Date().toISOString() });
  }

  // --- Generate PNG image, upload to Supabase Storage, return public URL ---
  const SB_STORAGE_URL = 'https://yumahmnoltvbiadjefxw.supabase.co/storage/v1';
  const SB_PUBLIC_URL = 'https://yumahmnoltvbiadjefxw.supabase.co/storage/v1/object/public/images';

  async function generateAndUploadImage(type, title, body) {
    try {
      // For tweets: only pass first 5 words for the image (shows tag + short headline)
      const headline = type.startsWith('tweet') ? (body || title || '').split(/\s+/).slice(0, 5).join(' ') : (title || '');
      const tag = type.startsWith('tweet') ? 'HOT TAKE' :
                  type === 'article_recap' ? 'RECAP' :
                  type === 'article_betting' ? 'BETTING' :
                  type === 'article_news' ? 'BREAKING' :
                  type === 'article_preview' ? 'PREVIEW' :
                  type === 'article_analysis' ? 'ANALYSIS' : 'NEWS';

      const base = 'https://tourfeed.co/.netlify/functions/generate-image';
      let imgFnUrl;
      if (type.startsWith('tweet')) {
        imgFnUrl = `${base}?type=hot_take&quote=${encodeURIComponent(headline)}`;
      } else {
        imgFnUrl = `${base}?type=article_header&tag=${encodeURIComponent(tag)}&headline=${encodeURIComponent(headline)}`;
      }

      // Download PNG from generate-image function
      const imgRes = await ft(imgFnUrl);
      if (!imgRes.ok) throw new Error('Image generation failed: ' + imgRes.status);
      const pngBuffer = Buffer.from(await imgRes.arrayBuffer());
      if (pngBuffer.length < 1000) throw new Error('Image too small, likely blank');

      // Upload to Supabase Storage
      const filename = type.replace(/[^a-z0-9]/g, '-') + '-' + Date.now() + '.png';
      const uploadRes = await ft(`${SB_STORAGE_URL}/object/images/${filename}`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SB_KEY_V2,
          'Content-Type': 'image/png',
          'x-upsert': 'true',
        },
        body: pngBuffer,
      });

      if (!uploadRes.ok) throw new Error('Storage upload failed: ' + await uploadRes.text());

      return `${SB_PUBLIC_URL}/${filename}`;
    } catch (e) {
      console.error('Image generation/upload failed:', e.message);
      return null; // Draft will be created without image
    }
  }

  // Reject content that indicates AI confusion or bad data
  const BAD_PHRASES = /data limitation|can't tell|no idea who|broken leaderboard|unknown.*winner|unnamed.*competitor|mystery.*champion|don't have access|can't see|I cannot|limited data|leaderboard.*broken|completely cooked|not doing anything/i;

  // --- Topic-level dedup ---
  function extractTopicKey(type, title, body) {
    // Extract main player + event type for topic clustering
    const text = ((title || '') + ' ' + (body || '')).toLowerCase();
    const players = ['scheffler','mcilroy','rory','tiger','woods','schauffele','rahm','koepka','morikawa','hovland','fleetwood','spieth','cantlay','fowler','reed','spaun','aberg','theegala','homa','lowry','thomas','finau','matsuyama','dechambeau','woodland','mickelson'];
    const events = ['withdraw','injury','win','champion','recap','preview','arrest','suspended','trade','transfer','fired','hired','baby','married','record'];
    let player = '';
    for (const p of players) { if (text.includes(p)) { player = p; break; } }
    let event = type.replace('article_','').replace('tweet_','');
    for (const e of events) { if (text.includes(e)) { event = e; break; } }
    const month = new Date().toISOString().slice(0, 7);
    return player + '-' + event + '-' + month;
  }

  async function checkTopic(topicKey) {
    try {
      const existing = await sb('content_topics?topic_key=eq.' + encodeURIComponent(topicKey));
      if (existing.length > 0) {
        const topic = existing[0];
        if (topic.status === 'rejected') return { blocked: true, reason: 'Topic rejected' };
        if (topic.times_covered >= 5) return { blocked: true, reason: 'Topic exhausted' };
        // Allow but increment
        await sb('content_topics?topic_key=eq.' + encodeURIComponent(topicKey), 'PATCH', { times_covered: topic.times_covered + 1 });
        return { blocked: false };
      }
      // New topic
      await sb('content_topics', 'POST', { topic_key: topicKey, event_type: topicKey.split('-')[1] || '', player_name: topicKey.split('-')[0] || '' });
      return { blocked: false };
    } catch(e) { return { blocked: false }; }
  }

  async function saveDraft(type, title, body, tournamentId, round) {
    // Quality check
    if (BAD_PHRASES.test(title) || BAD_PHRASES.test(body)) {
      return { skipped: true, reason: 'Failed quality check' };
    }
    // Hash dedup
    const hash = hashText(title + ' ' + body);
    if (await isDuplicate(hash)) {
      return { skipped: true, hash };
    }
    // Topic dedup
    const topicKey = extractTopicKey(type, title, body);
    const topicCheck = await checkTopic(topicKey);
    if (topicCheck.blocked) {
      return { skipped: true, reason: topicCheck.reason };
    }
    // Generate image headline via Haiku (bold hook, NOT truncated title)
    var imgHL = title; // fallback
    try {
      var hlRes = await askClaude(
        'Write a single image headline. Max 8 words. Bold hook that works on an Instagram image. NOT the article title shortened. Think billboard. No quotes around it. Just the headline.',
        'Article title: ' + title + '\nFirst sentence: ' + body.replace(/<[^>]+>/g, '').split('.')[0] + '\n\nWrite one image headline (max 8 words):',
        50
      );
      var cleaned = hlRes.replace(/[""]/g, '').trim();
      if (cleaned.length > 3 && cleaned.length < 60) imgHL = cleaned;
    } catch(e) {}

    const imageUrl = null; // Images added manually via admin editor
    const draft = await sb('content_drafts', 'POST', {
      type, title, body,
      image_url: imageUrl,
      image_headline: imgHL,
      tournament_id: tournamentId,
      round,
      status: 'pending',
      content_hash: hash,
      created_at: new Date().toISOString(),
    });
    await recordHash(hash, type);

    // Generate Instagram draft — promote our picks only
    if (type.startsWith('article')) {
      var igTiming = type === 'article_recap' ? 'Prepare now, post within 1 hour' :
                     type === 'article_betting' ? 'Prepare today, post tomorrow morning' :
                     type === 'article_news' ? 'Prepare now, post within 2 hours' :
                     'Prepare today, post tomorrow evening';
      try {
        var igRaw = await askClaude(
          'You write Instagram captions for TourFeed, a golf betting picks site. ZERO emojis. ZERO hashtags. 2-3 sentences max. The caption should ONLY promote our picks and analysis — tease a specific pick or value play from the article to make people visit the site. End with "Full picks at tourfeed.co" on its own line.',
          'Article title: ' + title + '\nArticle type: ' + type + '\n\nWrite an Instagram caption that promotes our picks from this article. Do NOT summarize the article. Tease one specific pick or betting angle that makes people want to check the site.',
          150
        );
        var igCaption = igRaw.trim();
        if (!igCaption || igCaption.length < 20) igCaption = title + '\n\nFull picks at tourfeed.co';
      } catch(e) {
        var igCaption = title + '\n\nFull picks at tourfeed.co';
      }
      // Generate image headline — max 8 words, bold hook
      var igWords = title.split(/\s+/);
      var igHL = igWords.length <= 8 ? title : igWords.slice(0, 7).join(' ') + '...';
      if (igHL === title && igHL.length > 50) igHL = igWords.slice(0, 6).join(' ') + '...';
      await sb('content_drafts', 'POST', {
        type: 'instagram',
        title: title,
        body: igCaption,
        image_headline: igHL,
        meta: JSON.stringify({ timing: igTiming }),
        tournament_id: tournamentId,
        status: 'pending',
        created_at: new Date().toISOString(),
      });
    }

    return { skipped: false, hash, draft };
  }

  // --- Call Claude Haiku ---
  async function askClaude(systemPrompt, userPrompt, maxTokens) {
    const res = await ft('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens || 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, 25000);
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Claude API error: ' + res.status + ' ' + err);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  try {
    // 1. Get active tournament only — must be in_progress
    let tournaments = await sb('tournaments?select=*&status=eq.in_progress&order=start_date.desc&limit=1');
    if (!tournaments.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No active tournament in progress' }) };
    }
    const tournament = tournaments[0];
    const tournamentId = tournament.id;

    // 2. Get top 15 leaderboard entries for this tournament
    // Join leaderboard with players to get names
    const leaderboard = await sb(
      'leaderboard?tournament_id=eq.' + tournamentId + '&select=*,players(id,name,country)&order=position.asc&limit=200'
    );
    if (!leaderboard.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No leaderboard data found for tournament: ' + tournament.name }) };
    }

    // Check if we have actual player names — skip if data is garbage
    const hasNames = leaderboard.some(p => p.players?.name && p.players.name !== 'Unknown');
    if (!hasNames) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Leaderboard has no player names — skipping content generation' }) };
    }

    const currentRound = tournament.current_round || 1;

    // Format and VALIDATE leaderboard data
    const validPlayers = leaderboard.filter(p => {
      const name = p.players?.name;
      const score = p.total_score;
      return name && name !== 'Unknown' && name.length > 2 && score && score !== '--';
    });

    if (validPlayers.length < 5) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Not enough valid player data (' + validPlayers.length + ' players with names/scores). Skipping.' }) };
    }

    // Wait for leaderboard to develop — need 60+ players with scores
    var fullField = await sb('leaderboard?tournament_id=eq.' + tournamentId + '&total_score=not.is.null&total_score=not.eq.--&select=player_id&limit=200');
    if (fullField.length < 60) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Not enough scores yet — only ' + fullField.length + ' players with scores, need 60+' }) };
    }

    const leaderboardText = validPlayers.map((p, i) => {
      const pos = p.position || (i + 1);
      const name = p.players.name;
      const country = p.players?.country || '';
      const total = p.total_score;
      const r1 = p.round1 ? p.round1 + ' strokes' : '';
      const r2 = p.round2 ? p.round2 + ' strokes' : '';
      const r3 = p.round3 ? p.round3 + ' strokes' : '';
      const r4 = p.round4 ? p.round4 + ' strokes' : '';
      const rounds = [r1, r2, r3, r4].filter(Boolean).join(', ');
      return `${pos}. ${name} (${country}) | Total: ${total}${rounds ? ' | Rounds: ' + rounds : ''}`;
    }).join('\n');

    const tourName = tournament.tour_id === 'pga' ? 'PGA Tour' : tournament.tour_id === 'lpga' ? 'LPGA Tour' : tournament.tour_id === 'liv' ? 'LIV Golf' : tournament.tour_id === 'dpw' ? 'DP World Tour' : '';
    const dataBlock = `Tour: ${tourName}\nTournament: ${tournament.name}\nCourse: ${tournament.course || 'TBD'}\nRound: ${currentRound}\nStatus: ${tournament.status}\n\nLeaderboard (Top ${validPlayers.length}):\n${leaderboardText}`;

    // ── CONTEXT ENGINE — fetch player facts for accurate prompts ──
  async function getPlayerContext(playerNames) {
    try {
      const facts = await sb('player_facts?select=*');
      if (!facts.length) return '';
      // Match relevant players
      const relevant = facts.filter(f => {
        const name = f.player_name.toLowerCase();
        return playerNames.some(p => name.includes(p.toLowerCase()) || p.toLowerCase().includes(name.split(' ').pop().toLowerCase()));
      });
      if (!relevant.length) return '';
      return '\n\nPLAYER CONTEXT — USE THIS, DO NOT CONTRADICT:\n' + relevant.map(f => {
        let ctx = f.player_name + ': World #' + (f.world_ranking || '?') + ', ' + (f.current_tour || 'PGA').toUpperCase() + ' Tour';
        if (f.status !== 'active') ctx += ' (' + f.status + ')';
        if (f.current_injury) ctx += ' — ' + f.current_injury;
        ctx += '. ' + f.total_majors + ' major' + (f.total_majors !== 1 ? 's' : '') + ' (';
        const majors = [];
        if (f.masters_wins) majors.push('Masters ' + f.masters_wins + 'x');
        if (f.us_open_wins) majors.push('US Open ' + f.us_open_wins + 'x');
        if (f.open_wins) majors.push('Open ' + f.open_wins + 'x');
        if (f.pga_champ_wins) majors.push('PGA ' + f.pga_champ_wins + 'x');
        ctx += majors.join(', ') || 'none';
        ctx += ').';
        if (f.career_grand_slam) ctx += ' Career Grand Slam holder.';
        if (f.masters_best) ctx += ' Masters best: ' + f.masters_best + '.';
        ctx += ' ' + (f.pga_wins || 0) + ' PGA Tour wins.';
        if (f.recent_notes) ctx += ' Recent: ' + f.recent_notes;
        if (f.hot_topics) ctx += ' Current: ' + f.hot_topics;
        return ctx;
      }).join('\n');
    } catch(e) { return ''; }
  }

  async function getTournamentContext(tournamentName) {
    try {
      const facts = await sb('tournament_facts?select=*');
      const match = facts.find(f => tournamentName.toLowerCase().includes(f.name.toLowerCase().replace('the ', '')) || f.name.toLowerCase().includes(tournamentName.toLowerCase().replace('the ', '')));
      if (!match) return '';
      return '\n\nTOURNAMENT CONTEXT — USE THIS:\n' +
        match.name + ' at ' + match.course + ' (Par ' + match.par + '). ' +
        'Defending champion: ' + match.defending_champion + ' (' + match.defending_score + '). ' +
        'Course record: ' + match.course_record + '. ' +
        (match.notable_history || '') + ' ' +
        (match.course_fit || '') + ' ' +
        (match.key_stats || '');
    } catch(e) { return ''; }
  }

  const TOURFEED_VOICE = 'CRITICAL PLAYER FACTS — NEVER CONTRADICT THESE: Scottie Scheffler IS playing the 2026 Masters. He did NOT withdraw. Confirmed competing despite having a newborn. Tiger Woods is NOT playing — recovering from March car accident. Phil Mickelson is NOT playing — withdrew for family health reasons. Rory McIlroy IS the defending champion — won 2025 Masters, Career Grand Slam holder.\n\nYOU ARE A STAFF WRITER ON DEADLINE. YOUR ONLY JOB IS TO PRODUCE THE CONTENT REQUESTED. You do not ask questions. You do not flag conflicts. You do not explain what you can or cannot do. You do not mention contradictions. You write the content. If data is from a past tournament, use it as context for the upcoming Masters. Always produce 4 clean tweets or a full article — nothing else. You are TourFeed\'s editorial voice — sharp golf writer, seasoned handicapper, sports journalist quality prose. Lead with story not data. No clichés. No AI mentions ever. Year is 2026.';

  const FACT_CHECK_RULES = TOURFEED_VOICE + `

Rory McIlroy WON the 2025 Masters. He is DEFENDING champion. Career Grand Slam holder. NEVER say he is chasing his first Masters.
If PLAYER CONTEXT is not provided for a player, use ONLY leaderboard data. No biographical claims.
`;

  // Image generator picks contextual golf photos automatically

    // ── Step 1: Fetch picks FIRST — must be defined before contextBlock ──
    var picksContext = '';
    var currentPicks = [];
    try {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      currentPicks = await sb('betting_picks?created_at=gte.' + sevenDaysAgo + '&order=created_at.asc&limit=10');
      console.log('picks count:', currentPicks.length);
      if (currentPicks.length > 0) {
        picksContext = '\n\nOUR CURRENT PICKS (ONLY reference these players as betting recommendations):\n' + currentPicks.map(function(p) {
          return (p.edge_label || '') + ': ' + (p.player_name || p.pick || '') + ' ' + (p.odds || '') + ' — ' + (p.analysis || '');
        }).join('\n') + '\n\nCRITICAL: You may ONLY reference players that appear in OUR CURRENT PICKS list. Do not mention any other players as betting recommendations. Every pick you write about must match exactly what is in our picks database.';
      }
    } catch(e) { console.log('betting_picks fetch error:', e.message); }

    if (!currentPicks.length) {
      console.log('No betting_picks found — aborting content generation');
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No picks in betting_picks — cannot generate content without picks' }) };
    }

    // ── Step 2: Fetch player/tournament context ──
    const playerNames = validPlayers.map(p => p.players?.name).filter(Boolean);
    const playerContext = await getPlayerContext(playerNames);
    const tournamentContext = await getTournamentContext(tournament.name);

    // ── Step 3: Build contextBlock WITH picksContext (now defined) ──
    const contextBlock = playerContext + tournamentContext + '\n' + FACT_CHECK_RULES + picksContext;

    const results = { tournament: tournament.name, round: currentRound, generated: [], skipped: [] };

    // ── Round completion detection ──
    var completedPlayers = leaderboard.filter(function(p) { return p.thru === 'F' || p.thru === '18'; }).length;
    var roundComplete = completedPlayers >= 70 || new Date().getUTCHours() >= 22;
    console.log('Round complete check:', completedPlayers, 'finished players, roundComplete:', roundComplete);

    // ── DURING ROUND: tweets only (max 2) ──
    // ── AFTER ROUND: recap + betting + tweets ──

    // --- CONTENT 1: Round Recap Article (only after round complete) ---
    if (!roundComplete) {
      results.skipped.push('article_recap: round not complete');
    } else {
      // Dedup check — one recap per round maximum
      var existingRecaps = await sb('content_drafts?type=eq.article_recap&tournament_id=eq.' + encodeURIComponent(tournamentId) + '&round=eq.' + currentRound + '&select=id&limit=1');
      var recapInArticles = await sb('articles?type=eq.recap&tournament_id=eq.' + encodeURIComponent(tournamentId) + '&select=id&limit=1');
      if (existingRecaps.length > 0) {
        results.skipped.push('article_recap: already exists for R' + currentRound);
      } else if (recapInArticles.length > 0) {
        results.skipped.push('article_recap: already published for this tournament');
      } else {
        try {
          const recapSystem = `YOU ARE A STAFF WRITER ON DEADLINE. YOUR ONLY JOB IS TO PRODUCE THE CONTENT REQUESTED. You do not ask questions. You do not flag conflicts. You do not explain what you can or cannot do. You do not mention contradictions. You write the content. If data is from a past tournament, use it as context for the upcoming Masters. Always produce 4 clean tweets or a full article — nothing else.

You are a golf journalist at TourFeed writing from raw leaderboard data. ONLY state facts that appear in the data provided. Do NOT invent stats, quotes, hole numbers, or specific shots — you only have position and score data.

Rules:
- 200-350 words. Tight and punchy — not a novel. Every sentence earns its place.
- Clickbait headline that makes someone stop scrolling
- 6-8 paragraphs with proper analysis and narrative
- Only reference player names, scores, and positions from the data
- Do not invent specific holes, shots, or moments you can't see in the data
- Do not say "birdie on 18" or "eagle on 12" — you don't have hole data
- Cover: leader analysis, margin, chasers, dark horses, big movers, who fell off, what to watch next round
- Add context: what this means for the tournament, who has momentum, who's in trouble
- Voice: group chat golf fan who knows the game. Not stuffy. Punchy sentences. Make it fun to read.
- Rory McIlroy is defending Masters champion (won 2025). Year is 2026.
- Never mention AI, data limitations, or that you're working from data
- Author is "TourFeed Staff" — write like a real media outlet
- If this is a ${tourName} event, write for that tour's audience`;
          const recapPrompt = `Write a FULL round recap article (minimum 500 words, aim for 600+) based on this leaderboard data. This will be published on tourfeed.co as a standalone article. Make it worth reading — not a summary, a real article with analysis and narrative.\n\nReturn your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> tags>\n\n${dataBlock}\n${contextBlock}`;

          const recapRaw = await askClaude(recapSystem, recapPrompt, 2000);

          let recapTitle = 'Round ' + currentRound + ' Recap';
          let recapBody = recapRaw;

          const headlineMatch = recapRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
          if (headlineMatch) recapTitle = headlineMatch[1].trim();

          const bodyMatch = recapRaw.match(/BODY:\s*([\s\S]+)/);
          if (bodyMatch) recapBody = bodyMatch[1].trim();

          const saved = await saveDraft('article_recap', recapTitle, recapBody, tournamentId, currentRound);
          if (saved.skipped) {
            results.skipped.push('article_recap');
          } else {
            results.generated.push('article_recap');
          }
        } catch (e) {
          results.errors = results.errors || [];
          results.errors.push('article_recap: ' + e.message);
        }
      }
    }

    // --- CONTENT 2: Picks Promo Tweets (4 tweets) ---
    try {
      const tweetSystem = `YOU ARE A STAFF WRITER ON DEADLINE. YOUR ONLY JOB IS TO PRODUCE THE CONTENT REQUESTED. You do not ask questions. You do not flag conflicts. You do not explain what you can or cannot do. You do not mention contradictions. You write the content. If data is from a past tournament, use it as context for the upcoming Masters. Always produce 4 clean tweets or a full article — nothing else.

Write 4 tweets promoting TourFeed's betting picks for the ${tourName} ${tournament.name}. Each tweet highlights a specific pick from the leaderboard data and drives readers to tourfeed.co for the full breakdown. Voice: sharp handicapper in a group chat. ZERO emojis. ZERO hashtags. 1-2 sentences each. End each tweet with "tourfeed.co" or "Full card at tourfeed.co" or similar CTA. Use the leaderboard data as context. If this tournament has ended, write forward-looking tweets connecting these results to the next major. Rory McIlroy is defending Masters champ (won 2025). Year 2026.

Types of pick tweets (use a mix):
1. Outright winner value pick — "[Player] at [odds] is the best value on the board right now. Here's why: tourfeed.co"
2. Top 5/Top 10 pick — "[Player] shot [score] today and sits [X] back. Top 10 at plus money is free. Full picks at tourfeed.co"
3. Longshot/dark horse — "[Player] is flying under the radar at [score]. Our model loves the number. tourfeed.co"
4. Matchup/fade — "[Player] over [Player] tomorrow is the lock of the day. Full card at tourfeed.co"`;
      const tweetPrompt = `Write 4 tweets promoting our picks. Number them 1-4, each on its own line.\n\n${dataBlock}\n${contextBlock}`;

      const tweetRaw = await askClaude(tweetSystem, tweetPrompt, 800);

      // Parse individual tweets
      const tweetLines = tweetRaw.split('\n').filter(l => l.trim());
      const tweets = [];
      let currentTweet = '';

      for (const line of tweetLines) {
        const numbered = line.match(/^\d[\.\)]\s*/);
        if (numbered) {
          if (currentTweet) tweets.push(currentTweet.trim());
          currentTweet = line.replace(/^\d[\.\)]\s*/, '');
        } else {
          currentTweet += ' ' + line.trim();
        }
      }
      if (currentTweet) tweets.push(currentTweet.trim());

      // Save up to 2 tweets per cycle
      const tweetsToSave = tweets.slice(0, 2);
      for (let i = 0; i < tweetsToSave.length; i++) {
        const tweet = tweetsToSave[i];
        if (!tweet) continue;
        const saved = await saveDraft(
          'tweet_content',
          tournament.name + ' R' + currentRound,
          tweet,
          tournamentId,
          currentRound
        );
        if (saved.skipped) {
          results.skipped.push('tweet_reaction_' + (i + 1));
        } else {
          results.generated.push('tweet_reaction_' + (i + 1));
        }
      }
    } catch (e) {
      results.errors = results.errors || [];
      results.errors.push('tweet_reactions: ' + e.message);
    }

    // --- CONTENT 3: Betting Insights Article (only after round complete) ---
    if (!roundComplete) {
      results.skipped.push('article_betting: round not complete');
    } else {
    var bestBetStr = 'our top value pick';
    try {
      var bestBets = await sb('betting_picks?pick_type=eq.outright&edge_label=eq.BEST BET&order=created_at.desc&limit=1');
      if (bestBets.length > 0) bestBetStr = bestBets[0].player_name + ' ' + bestBets[0].odds;
    } catch(e) {}
    try {
      const bettingSystem = `YOU ARE A STAFF WRITER ON DEADLINE. YOUR ONLY JOB IS TO PRODUCE THE CONTENT REQUESTED. You do not ask questions. You do not flag conflicts. You do not explain what you can or cannot do. You do not mention contradictions. You write the content. If data is from a past tournament, use it as context for the upcoming Masters. Always produce 4 clean tweets or a full article — nothing else.

You are a professional sports handicapper with 20 years experience. Your picks are read by serious bettors. For every pick you must: identify the implied probability from the odds, estimate the true probability based on form and course fit, only recommend the pick if true probability exceeds implied by at least 3 percentage points. Show your math. Be specific — cite actual recent stats, course history, strokes gained data from the context provided. No filler. No obvious picks. Find the edge or don't make the pick.

You're analyzing the ${tourName} ${tournament.name}. ZERO emojis. ZERO hashtags.

Structure your article with these sections (use <h3> tags):
1. TOURFEED BEST BET — ${bestBetStr}. Lead with our official Best Bet pick and show the value gap math.
2. OUTRIGHT WINNER PICKS — top 3 value plays with odds, implied vs true probability, reasoning
3. TOP 5 / TOP 10 PICKS — 2 picks at each level with edge calculation
4. LONGSHOT OF THE ROUND — one 20:1+ shot, full paragraph on the upside case
5. FADE — one player to avoid, explain why the market is wrong
6. HEAD-TO-HEAD MATCHUP — one matchup pick for next round with stat backing
7. WHAT TO WATCH — key storyline for bettors going forward

Rules:
- 400-700 words. Every pick needs implied probability, true probability, and the edge.
- ONLY reference players from the data. Use strokes gained and course history from the context provided.
- Voice: sharp handicapper in the group chat. Confident, fun, not stuffy.
- Rory McIlroy is defending Masters champ (won 2025). Year 2026.
- Author is "TourFeed Staff"`;
      const bettingPrompt = `Write a FULL betting analysis article (minimum 600 words) based on this leaderboard data. This is the main betting content on tourfeed.co — make it comprehensive.\n\nReturn your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> and <h3> tags>\n\n${dataBlock}\n${contextBlock}`;

      const bettingRaw = await askClaude(bettingSystem, bettingPrompt, 2000);

      let bettingTitle = 'Betting Insights - Round ' + currentRound;
      let bettingBody = bettingRaw;

      const headlineMatch = bettingRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
      if (headlineMatch) bettingTitle = headlineMatch[1].trim();

      const bodyMatch = bettingRaw.match(/BODY:\s*([\s\S]+)/);
      if (bodyMatch) bettingBody = bodyMatch[1].trim();

      const saved = await saveDraft('article_betting', bettingTitle, bettingBody, tournamentId, currentRound);
      if (saved.skipped) {
        results.skipped.push('article_betting');
      } else {
        results.generated.push('article_betting');
      }
    } catch (e) {
      results.errors = results.errors || [];
      results.errors.push('article_betting: ' + e.message);
    }
    } // end roundComplete check for betting

    // Send batched notification
    if (results.generated.length > 0) {
      const parts = [];
      const articles = results.generated.filter(g => g.startsWith('article')).length;
      const tweets = results.generated.filter(g => g.startsWith('tweet')).length;
      if (articles) parts.push(articles + ' article' + (articles > 1 ? 's' : ''));
      if (tweets) parts.push(tweets + ' tweet' + (tweets > 1 ? 's' : ''));
      try {
        await ft('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'New Drafts Ready', 'Priority': '3' },
          body: results.generated.length + ' new drafts — ' + parts.join(', ') + ' (' + results.tournament + ' R' + results.round + ')',
        });
      } catch(e) {}
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(results),
    };
  } catch (e) {
    // Error notification
    try {
      await ft('https://ntfy.sh/tourfeed-alerts', {
        method: 'POST',
        headers: { 'Title': 'TourFeed Error', 'Priority': '5', 'Tags': 'rotating_light' },
        body: 'generate-content failed: ' + e.message,
      });
    } catch(ne) {}
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
