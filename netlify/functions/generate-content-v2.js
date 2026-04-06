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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  // --- Supabase helper ---
  async function sb(path, method, body) {
    const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';
    const hdrs = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
    if (method === 'POST') hdrs['Prefer'] = 'return=representation';
    if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
    const res = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/' + path, {
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

  async function generateAndUploadImage(type, title, body, playerPhotoUrl) {
    try {
      const headline = type.startsWith('tweet') ? (body || title || '').slice(0, 80) : (title || '');
      const tag = type.startsWith('tweet') ? 'HOT TAKE' :
                  type === 'article_recap' ? 'RECAP' :
                  type === 'article_betting' ? 'BETTING' :
                  type === 'article_news' ? 'BREAKING' :
                  type === 'article_preview' ? 'PREVIEW' :
                  type === 'article_analysis' ? 'ANALYSIS' : 'NEWS';

      // Build generate-image URL with player photo
      const base = 'https://tourfeed.co/.netlify/functions/generate-image';
      const photoParam = playerPhotoUrl ? `&photo=${encodeURIComponent(playerPhotoUrl)}` : '';
      let imgFnUrl;
      if (type.startsWith('tweet')) {
        imgFnUrl = `${base}?type=hot_take&quote=${encodeURIComponent(headline)}${photoParam}`;
      } else {
        imgFnUrl = `${base}?type=article_header&tag=${encodeURIComponent(tag)}&headline=${encodeURIComponent(headline)}${photoParam}`;
      }

      // Download PNG from generate-image function
      const imgRes = await fetch(imgFnUrl);
      if (!imgRes.ok) throw new Error('Image generation failed: ' + imgRes.status);
      const pngBuffer = Buffer.from(await imgRes.arrayBuffer());
      if (pngBuffer.length < 1000) throw new Error('Image too small, likely blank');

      // Upload to Supabase Storage
      const filename = type.replace(/[^a-z0-9]/g, '-') + '-' + Date.now() + '.png';
      const uploadRes = await fetch(`${SB_STORAGE_URL}/object/images/${filename}`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs',
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

  async function saveDraft(type, title, body, tournamentId, round, playerPhotoUrl) {
    // Quality check — reject garbage content
    if (BAD_PHRASES.test(title) || BAD_PHRASES.test(body)) {
      return { skipped: true, reason: 'Failed quality check' };
    }
    const hash = hashText(title + ' ' + body);
    if (await isDuplicate(hash)) {
      return { skipped: true, hash };
    }
    // Generate real PNG with player photo and upload to Supabase Storage
    const imageUrl = await generateAndUploadImage(type, title, body, playerPhotoUrl);
    const draft = await sb('content_drafts', 'POST', {
      type,
      title,
      body,
      image_url: imageUrl,
      tournament_id: tournamentId,
      round,
      status: 'pending',
      content_hash: hash,
      created_at: new Date().toISOString(),
    });
    await recordHash(hash, type);
    return { skipped: false, hash, draft };
  }

  // --- Call Claude Haiku ---
  async function askClaude(systemPrompt, userPrompt, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens || 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Claude API error: ' + res.status + ' ' + err);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  try {
    // 1. Get latest tournament
    // Always prioritize PGA Tour, then others
    let tournaments = await sb('tournaments?select=*&tour_id=eq.pga&status=neq.scheduled&order=start_date.desc&limit=1');
    if (!tournaments.length) tournaments = await sb('tournaments?select=*&status=neq.scheduled&order=start_date.desc&limit=1');
    if (!tournaments.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No tournaments found' }) };
    }
    const tournament = tournaments[0];
    const tournamentId = tournament.id;

    // 2. Get top 15 leaderboard entries for this tournament
    // Join leaderboard with players to get names
    const leaderboard = await sb(
      'leaderboard?tournament_id=eq.' + tournamentId + '&select=*,players(id,name,country)&order=position.asc&limit=15'
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

    // Well-known players — ESPN ID map for headshot lookup
    const KNOWN_IDS = {
      'tiger':462,'woods':462,'rory':3448,'mcilroy':3448,
      'scheffler':9780,'scottie':9780,'schauffele':10046,'xander':10046,
      'rahm':9527,'koepka':10592,'brooks':10592,'spieth':5765,
      'morikawa':11098,'hovland':4364873,'fleetwood':5539,
      'lowry':4587,'cantlay':10404,'matsuyama':4375627,'hideki':4375627,
      'fowler':3702,'rickie':3702,'clark':4686009,'wyndham':4686009,
      'burns':9726,'finau':9478,'thomas':4848,'aberg':4375972,'ludvig':4375972,
      'macintyre':11378,'spaun':10166,'theegala':10980,'homa':8973,
      'kim':7081,'fitzpatrick':9037,'sungjae':9508,'dechambeau':10046,
    };

    // Build player name → photo URL from leaderboard + known players
    const playerPhotos = {};
    validPlayers.forEach(p => {
      if (p.players?.id && p.players?.name) {
        const lastName = p.players.name.split(' ').pop().toLowerCase();
        playerPhotos[lastName] = `https://a.espncdn.com/i/headshots/golf/players/full/${p.players.id}.png`;
      }
    });

    // Find player photos mentioned in text — check known IDs first, then leaderboard
    function findPhotosInText(text) {
      const found = [];
      const lower = (text || '').toLowerCase();

      // Check known players first (Tiger, Rory, Scottie etc.)
      for (const [name, id] of Object.entries(KNOWN_IDS)) {
        if (lower.includes(name)) {
          const url = `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png`;
          if (!found.includes(url)) found.push(url);
          if (found.length >= 2) break;
        }
      }

      // Then check leaderboard players
      if (found.length < 2) {
        for (const [name, url] of Object.entries(playerPhotos)) {
          if (lower.includes(name) && !found.includes(url)) {
            found.push(url);
            if (found.length >= 2) break;
          }
        }
      }

      return found.length > 0 ? found.join(',') : '';
    }

    const results = { tournament: tournament.name, round: currentRound, generated: [], skipped: [] };

    // --- CONTENT 1: Round Recap Article ---
    try {
      const recapSystem = `You are a golf journalist at TourFeed writing from raw leaderboard data. ONLY state facts that appear in the data provided. Do NOT invent stats, quotes, hole numbers, or specific shots — you only have position and score data.

Rules:
- MINIMUM 500 words, aim for 600-700. This is a full article, not a summary.
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
      const recapPrompt = `Write a FULL round recap article (minimum 500 words, aim for 600+) based on this leaderboard data. This will be published on tourfeed.co as a standalone article. Make it worth reading — not a summary, a real article with analysis and narrative.\n\nReturn your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> tags>\n\n${dataBlock}`;

      const recapRaw = await askClaude(recapSystem, recapPrompt, 2500);

      let recapTitle = 'Round ' + currentRound + ' Recap';
      let recapBody = recapRaw;

      const headlineMatch = recapRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
      if (headlineMatch) recapTitle = headlineMatch[1].trim();

      const bodyMatch = recapRaw.match(/BODY:\s*([\s\S]+)/);
      if (bodyMatch) recapBody = bodyMatch[1].trim();

      const saved = await saveDraft('article_recap', recapTitle, recapBody, tournamentId, currentRound, findPhotosInText(recapTitle + ' ' + recapBody));
      if (saved.skipped) {
        results.skipped.push('article_recap');
      } else {
        results.generated.push('article_recap');
      }
    } catch (e) {
      results.errors = results.errors || [];
      results.errors.push('article_recap: ' + e.message);
    }

    // --- CONTENT 2: Tweet Reactions (4 tweets) ---
    try {
      const tweetSystem = `Write 4 tweets about this ${tourName} tournament. Voice: golf fan in a group chat. ZERO emojis. ZERO hashtags. Never mention TourFeed. 1-2 sentences each. ONLY reference players and scores from the data. Do NOT invent specific shots, holes, or moments. Do NOT complain about data quality. Rory McIlroy is defending Masters champ (won 2025). Year 2026.`;
      const tweetPrompt = `Write 4 tweets reacting to this round. Number them 1-4, each on its own line.\n\n${dataBlock}`;

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

      // Save up to 4 tweets
      const tweetsToSave = tweets.slice(0, 4);
      for (let i = 0; i < tweetsToSave.length; i++) {
        const tweet = tweetsToSave[i];
        if (!tweet) continue;
        const saved = await saveDraft(
          'tweet_reaction',
          tournament.name + ' R' + currentRound,
          tweet,
          tournamentId,
          currentRound,
          findPhotosInText(tweet)
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

    // --- CONTENT 3: Betting Insights Article ---
    try {
      const bettingSystem = `You're TourFeed's sharp handicapper analyzing the ${tourName} ${tournament.name}. Write a comprehensive betting breakdown using ONLY the leaderboard data provided. ZERO emojis. ZERO hashtags.

Structure your article with these sections (use <h3> tags):
1. OUTRIGHT WINNER PICKS — top 3 value plays with odds, model probability, reasoning
2. TOP 5 / TOP 10 PICKS — 2 picks at each level, why they'll contend
3. LONGSHOT OF THE ROUND — one 20:1+ shot that could shock everyone, full paragraph
4. FADE — one player to avoid, explain why the price is wrong
5. HEAD-TO-HEAD MATCHUP — one matchup pick for next round
6. WHAT TO WATCH — key storyline for bettors going forward

Rules:
- MINIMUM 600 words. This is a full betting article, not a blurb.
- Include estimated odds for every pick
- ONLY reference players from the data. Do NOT invent strokes gained or course history stats.
- Voice: sharp handicapper in the group chat. Confident, fun, not stuffy.
- Rory McIlroy is defending Masters champ (won 2025). Year 2026.
- Author is "TourFeed Staff"`;
      const bettingPrompt = `Write a FULL betting analysis article (minimum 600 words) based on this leaderboard data. This is the main betting content on tourfeed.co — make it comprehensive.\n\nReturn your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> and <h3> tags>\n\n${dataBlock}`;

      const bettingRaw = await askClaude(bettingSystem, bettingPrompt, 2500);

      let bettingTitle = 'Betting Insights - Round ' + currentRound;
      let bettingBody = bettingRaw;

      const headlineMatch = bettingRaw.match(/HEADLINE:\s*(.+?)(?:\n|$)/);
      if (headlineMatch) bettingTitle = headlineMatch[1].trim();

      const bodyMatch = bettingRaw.match(/BODY:\s*([\s\S]+)/);
      if (bodyMatch) bettingBody = bodyMatch[1].trim();

      const saved = await saveDraft('article_betting', bettingTitle, bettingBody, tournamentId, currentRound, findPhotosInText(bettingTitle + ' ' + bettingBody));
      if (saved.skipped) {
        results.skipped.push('article_betting');
      } else {
        results.generated.push('article_betting');
      }
    } catch (e) {
      results.errors = results.errors || [];
      results.errors.push('article_betting: ' + e.message);
    }

    // Send batched notification
    if (results.generated.length > 0) {
      const parts = [];
      const articles = results.generated.filter(g => g.startsWith('article')).length;
      const tweets = results.generated.filter(g => g.startsWith('tweet')).length;
      if (articles) parts.push(articles + ' article' + (articles > 1 ? 's' : ''));
      if (tweets) parts.push(tweets + ' tweet' + (tweets > 1 ? 's' : ''));
      try {
        await fetch('https://ntfy.sh/tourfeed-alerts', {
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
      await fetch('https://ntfy.sh/tourfeed-alerts', {
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
