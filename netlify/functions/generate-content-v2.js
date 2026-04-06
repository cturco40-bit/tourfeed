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

  // --- Save draft with dedup ---
  // Generate branded image URL based on content type
  function getImageUrl(type, title, tournament) {
    const base = 'https://tourfeed.co/.netlify/functions/generate-image';
    if (type === 'article_recap') return `${base}?type=headline&tag=RECAP&headline=${encodeURIComponent(title || '')}`;
    if (type === 'article_betting') return `${base}?type=headline&tag=BETTING&headline=${encodeURIComponent(title || '')}`;
    if (type === 'article_news') return `${base}?type=headline&tag=BREAKING&headline=${encodeURIComponent(title || '')}`;
    if (type === 'article_preview') return `${base}?type=headline&tag=PREVIEW&headline=${encodeURIComponent(title || '')}`;
    if (type === 'article_analysis') return `${base}?type=headline&tag=ANALYSIS&headline=${encodeURIComponent(title || '')}`;
    return `${base}?type=headline&tag=NEWS&headline=${encodeURIComponent(title || '')}`;
  }

  async function saveDraft(type, title, body, tournamentId, round) {
    const hash = hashText(title + ' ' + body);
    if (await isDuplicate(hash)) {
      return { skipped: true, hash };
    }
    const imageUrl = getImageUrl(type, title);
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
    const tournaments = await sb('tournaments?select=*&status=neq.scheduled&order=start_date.desc&limit=1');
    if (!tournaments.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No tournaments found' }) };
    }
    const tournament = tournaments[0];
    const tournamentId = tournament.id;

    // 2. Get top 15 leaderboard entries for this tournament
    const leaderboard = await sb(
      'leaderboard?tournament_id=eq.' + tournamentId + '&select=*&order=position.asc&limit=15'
    );
    if (!leaderboard.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No leaderboard data found for tournament: ' + tournament.name }) };
    }

    // Determine current round from leaderboard data
    const currentRound = leaderboard[0].current_round || leaderboard[0].round || tournament.current_round || 1;

    // Format leaderboard data for Claude
    const leaderboardText = leaderboard.map((p, i) => {
      const pos = p.position || (i + 1);
      const name = p.player_name || p.name || 'Unknown';
      const total = p.total_score || p.total || p.score || '--';
      const today = p.today || p.round_score || '--';
      const thru = p.thru || p.holes_played || '--';
      return `${pos}. ${name} | Total: ${total} | Today: ${today} | Thru: ${thru}`;
    }).join('\n');

    const dataBlock = `Tournament: ${tournament.name}\nRound: ${currentRound}\nDate: ${new Date().toISOString().split('T')[0]}\n\nLeaderboard (Top 15):\n${leaderboardText}`;

    const results = { tournament: tournament.name, round: currentRound, generated: [], skipped: [] };

    // --- CONTENT 1: Round Recap Article ---
    try {
      const recapSystem = "You are a golf journalist writing from raw data. Write a 300-400 word round recap. Clickbait-style headline. Short punchy paragraphs. Reference specific scores, movements, key storylines. Never mention AI. IMPORTANT: Rory McIlroy is the defending Masters champion (won 2025). It is 2026.";
      const recapPrompt = `Write a round recap article based on this leaderboard data. Return your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> tags>\n\n${dataBlock}`;

      const recapRaw = await askClaude(recapSystem, recapPrompt, 1500);

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

    // --- CONTENT 2: Tweet Reactions (4 tweets) ---
    try {
      const tweetSystem = "Write 4 tweets reacting to this round. Voice: golf fan in a group chat. ZERO emojis. ZERO hashtags. Never mention TourFeed. Short, opinionated, funny when it fits. 1-2 sentences each.";
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
          'Tweet Reaction R' + currentRound + ' #' + (i + 1),
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

    // --- CONTENT 3: Betting Insights Article ---
    try {
      const bettingSystem = "You're a sharp handicapper. Write betting analysis from this leaderboard data. Include: best value outright pick, top 5 finish pick, top 10 finish pick, longshot pick, fade pick. Include odds and reasoning. ZERO emojis.";
      const bettingPrompt = `Write betting insights based on this leaderboard data. Return your response in this exact format:\n\nHEADLINE: <your headline here>\n\nBODY:\n<your HTML article here using <p> and <h3> tags>\n\n${dataBlock}`;

      const bettingRaw = await askClaude(bettingSystem, bettingPrompt, 1500);

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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(results),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
