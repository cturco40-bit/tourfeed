// Generate AI-powered betting picks from real sportsbook odds + player analysis
// Stores picks in betting_insights table — single source of truth for all picks across the site

const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function fetchT(url, options, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms || 8000);
  return fetch(url, { ...options, signal: controller.signal })
    .then(function(res) { clearTimeout(timeout); return res; })
    .catch(function(e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') console.log('Fetch timed out after ' + (ms || 8000) + 'ms:', url.slice(0, 120));
      throw e;
    });
}

async function sb(path, method, body) {
  const hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await fetchT(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET', headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!method || method === 'GET') { try { return await res.json(); } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  console.log('Starting generate-picks');

  try {
    // 1. Get active tournament
    console.log('Fetching tournament from Supabase');
    let tournaments = await sb('tournaments?tour_id=eq.pga&status=neq.completed&order=start_date.desc&limit=1');
    if (!tournaments.length) tournaments = await sb('tournaments?tour_id=eq.pga&order=start_date.desc&limit=1');
    const tournament = tournaments[0];
    if (!tournament) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No tournament found' }) };
    console.log('Tournament:', tournament.name);

    // 2. Get real sportsbook odds — top 20 players
    console.log('Fetching odds from Supabase');
    const odds = await sb('player_odds?order=best_odds.asc&limit=20');
    if (!odds.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No odds data — run fetch-odds first' }) };
    console.log('Odds fetch complete, processing', odds.length, 'events');

    // 3. Get player facts for context
    let playerFacts = [];
    try {
      playerFacts = await sb('player_facts?select=*&limit=50');
    } catch(e) {}

    // 4. Get tournament facts for course context
    let courseContext = '';
    try {
      const tFacts = await sb('tournament_facts?select=*');
      const match = tFacts.find(function(f) {
        return tournament.name.toLowerCase().includes(f.name.toLowerCase().replace('the ', '')) ||
               f.name.toLowerCase().includes(tournament.name.toLowerCase().replace('the ', ''));
      });
      if (match) {
        courseContext = match.name + ' at ' + match.course + ' (Par ' + match.par + '). ' +
          'Defending champion: ' + match.defending_champion + ' (' + match.defending_score + '). ' +
          'Course record: ' + match.course_record + '. ' +
          (match.notable_history || '') + ' ' + (match.course_fit || '') + ' ' + (match.key_stats || '');
      }
    } catch(e) {}

    // 5. Build player context for the prompt
    const playerLines = odds.map(function(o) {
      const impliedPct = o.best_odds > 0
        ? (100 / (o.best_odds + 100) * 100).toFixed(1)
        : (Math.abs(o.best_odds) / (Math.abs(o.best_odds) + 100) * 100).toFixed(1);
      const oddsStr = o.best_odds > 0 ? '+' + o.best_odds : '' + o.best_odds;

      // Find matching player facts
      const name = o.player_name.toLowerCase();
      const facts = playerFacts.find(function(f) {
        return f.player_name.toLowerCase() === name ||
               name.includes(f.player_name.toLowerCase().split(' ').pop());
      });

      let line = o.player_name + ' | Odds: ' + oddsStr + ' (implied ' + impliedPct + '%) | Book: ' + (o.best_book || 'Sportsbook');
      if (o.draftkings_odds) line += ' | DK: ' + (o.draftkings_odds > 0 ? '+' : '') + o.draftkings_odds;
      if (o.fanduel_odds) line += ' | FD: ' + (o.fanduel_odds > 0 ? '+' : '') + o.fanduel_odds;

      if (facts) {
        line += '\n  Context: #' + (facts.world_ranking || '?') + ' world ranking, ' + (facts.total_majors || 0) + ' majors';
        if (facts.masters_wins) line += ', ' + facts.masters_wins + 'x Masters champ';
        if (facts.career_grand_slam) line += ', Career Grand Slam holder';
        if (facts.season_wins) line += ', ' + facts.season_wins + ' wins this season';
        if (facts.recent_notes) line += '. Recent: ' + facts.recent_notes;
        if (facts.hot_topics) line += '. Current: ' + facts.hot_topics;
      }
      return line;
    }).join('\n\n');

    // 6. Call Claude Haiku for analysis
    console.log('Calling Anthropic API now...');
    const systemPrompt = `You are TourFeed's expert golf handicapper. You analyze sportsbook odds vs player form to find VALUE — picks where the true probability exceeds the market's implied probability.

Your job: for each player, estimate their TRUE win probability based on current form, course fit, major championship pedigree, and momentum. Compare that to the implied probability from the odds. The biggest POSITIVE gaps (true > implied) are the best value bets.

Rules:
- The best bet is NOT necessarily the favorite — it's the player with the biggest value gap
- All picks must reference real odds from the data provided
- Be specific: "His strokes gained approach ranks top 5 on tour" not vague praise
- Confidence scale: 1-10. Only use 8+ for genuine conviction
- Year is 2026. Rory McIlroy won the 2025 Masters (defending champion, career Grand Slam)
- For matchups, pick the player with the better value proposition
- For props, use tournament-level props (scoring, playoffs, aces, etc.)
- For parlays, combine 2-3 legs that correlate (e.g., two players with similar course fit profiles)
- Longshot must be 30:1 or longer (+3000 or higher odds)`;

    const userPrompt = `Here are the top 20 players with real sportsbook odds for ${tournament.name}:

${playerLines}

${courseContext ? 'COURSE CONTEXT: ' + courseContext : ''}

Analyze each player's true probability vs their implied odds probability. Then generate picks.

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "best_bet": {
    "player_name": "Name",
    "odds": "+XXX",
    "implied_pct": "X.X",
    "model_pct": "X.X",
    "edge": "X.X",
    "analysis": "2-3 sentences on why this is the best value",
    "confidence": 8,
    "sportsbook": "BookName"
  },
  "top5": [
    {"player_name": "Name", "odds": "+XXX", "implied_pct": "X.X", "model_pct": "X.X", "analysis": "1-2 sentences", "confidence": 7, "sportsbook": "Book"},
    {"player_name": "Name", "odds": "+XXX", "implied_pct": "X.X", "model_pct": "X.X", "analysis": "1-2 sentences", "confidence": 7, "sportsbook": "Book"}
  ],
  "top10": [
    {"player_name": "Name", "odds": "+XXX", "implied_pct": "X.X", "model_pct": "X.X", "analysis": "1-2 sentences", "confidence": 6, "sportsbook": "Book"},
    {"player_name": "Name", "odds": "+XXX", "implied_pct": "X.X", "model_pct": "X.X", "analysis": "1-2 sentences", "confidence": 6, "sportsbook": "Book"}
  ],
  "matchups": [
    {"player_name": "PlayerA", "opponent": "PlayerB", "odds": "-110", "analysis": "1-2 sentences why A beats B", "confidence": 7},
    {"player_name": "PlayerA", "opponent": "PlayerB", "odds": "-110", "analysis": "1-2 sentences", "confidence": 7},
    {"player_name": "PlayerA", "opponent": "PlayerB", "odds": "-110", "analysis": "1-2 sentences", "confidence": 6}
  ],
  "longshot": {
    "player_name": "Name",
    "odds": "+3000",
    "implied_pct": "X.X",
    "model_pct": "X.X",
    "analysis": "2-3 sentences on the upside case",
    "confidence": 4,
    "sportsbook": "Book"
  },
  "props": [
    {"pick": "Winning Score UNDER 275.5", "odds": "-115", "analysis": "1-2 sentences", "confidence": 6},
    {"pick": "Hole in One — YES", "odds": "+110", "analysis": "1-2 sentences", "confidence": 5},
    {"pick": "Playoff — YES", "odds": "+500", "analysis": "1-2 sentences", "confidence": 4}
  ],
  "parlays": [
    {"name": "Parlay name", "legs": [{"player": "Name", "market": "Top 10", "odds": "+150"}, {"player": "Name", "market": "Top 10", "odds": "+200"}], "combined_odds": "+450", "analysis": "Why these legs correlate", "confidence": 4},
    {"name": "Parlay name", "legs": [{"player": "Name", "market": "Top 5", "odds": "+200"}, {"player": "Name", "market": "Top 5", "odds": "+250"}], "combined_odds": "+650", "analysis": "Why these legs correlate", "confidence": 3}
  ]
}`;

    const res = await fetchT('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, 25000);
    console.log('Anthropic response received');

    if (!res.ok) {
      const err = await res.text();
      console.log('Anthropic API error:', res.status, err.slice(0, 200));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Claude API failed: ' + res.status, detail: err.slice(0, 200) }) };
    }

    const data = await res.json();
    const rawText = (data.content?.[0]?.text || '').trim();

    // 7. Parse JSON response
    let picks;
    try {
      picks = JSON.parse(rawText.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      const jsonMatch = rawText.match(/\{[\s\S]*"best_bet"[\s\S]*\}/);
      if (jsonMatch) picks = JSON.parse(jsonMatch[0]);
      else return { statusCode: 200, headers, body: JSON.stringify({ error: 'Parse failed', raw: rawText.slice(0, 500) }) };
    }

    // 8. Insert into betting_insights
    console.log('Saving to Supabase...');
    const batchId = new Date().toISOString();
    const tournamentId = tournament.id;
    const inserted = [];

    // Helper to insert a pick row
    async function insertPick(betType, edgeLabel, pick) {
      const row = {
        tournament_id: tournamentId,
        player_name: pick.player_name || null,
        bet_type: betType,
        pick: pick.pick || pick.player_name + ' to ' + betType,
        odds: pick.odds || '',
        implied_probability: pick.implied_pct || null,
        model_probability: pick.model_pct || null,
        is_value: true,
        edge_label: edgeLabel,
        analysis: pick.analysis || '',
        confidence: pick.confidence || 5,
        units: betType === 'outright' ? 2.0 : betType === 'top5' ? 1.5 : betType === 'longshot' || betType === 'parlay' ? 0.5 : 1.0,
        result: 'pending',
        sportsbook: pick.sportsbook || 'DraftKings',
        batch_id: batchId,
        meta: JSON.stringify(pick.meta || {}),
        created_at: batchId,
      };
      const result = await sb('betting_insights', 'POST', row);
      inserted.push({ bet_type: betType, player: pick.player_name || pick.pick || pick.name });
      return result;
    }

    // Best bet
    if (picks.best_bet) {
      picks.best_bet.pick = picks.best_bet.player_name + ' to win outright';
      await insertPick('outright', 'BEST BET', picks.best_bet);
    }

    // Top 5 picks
    if (picks.top5) {
      for (const p of picks.top5.slice(0, 2)) {
        p.pick = p.player_name + ' Top 5 finish';
        await insertPick('top5', 'VALUE', p);
      }
    }

    // Top 10 picks
    if (picks.top10) {
      for (const p of picks.top10.slice(0, 2)) {
        p.pick = p.player_name + ' Top 10 finish';
        await insertPick('top10', 'VALUE', p);
      }
    }

    // Matchups
    if (picks.matchups) {
      for (const m of picks.matchups.slice(0, 3)) {
        m.pick = m.player_name + ' over ' + m.opponent;
        m.meta = { opponent: m.opponent };
        await insertPick('matchup', 'MATCHUP', m);
      }
    }

    // Longshot
    if (picks.longshot) {
      picks.longshot.pick = picks.longshot.player_name + ' to win outright';
      await insertPick('longshot', 'LONGSHOT', picks.longshot);
    }

    // Props
    if (picks.props) {
      for (const p of picks.props.slice(0, 3)) {
        p.player_name = null;
        p.meta = { prop_description: p.pick };
        await insertPick('prop', 'PROP', p);
      }
    }

    // Parlays
    if (picks.parlays) {
      for (const p of picks.parlays.slice(0, 2)) {
        p.player_name = null;
        p.pick = p.name || 'Parlay';
        p.odds = p.combined_odds || '';
        p.meta = { legs: p.legs };
        await insertPick('parlay', 'PARLAY', p);
      }
    }

    console.log('Supabase write complete');

    // 9. Notify
    try {
      const bestName = picks.best_bet?.player_name || 'Unknown';
      const bestOdds = picks.best_bet?.odds || '';
      await fetchT('https://ntfy.sh/tourfeed-alerts', {
        method: 'POST',
        headers: { 'Title': 'Picks Updated', 'Priority': '3' },
        body: inserted.length + ' picks generated. Best Bet: ' + bestName + ' ' + bestOdds + ' (' + tournament.name + ')',
      });
    } catch(e) {}

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        tournament: tournament.name,
        batch_id: batchId,
        picks_inserted: inserted.length,
        best_bet: picks.best_bet?.player_name + ' ' + picks.best_bet?.odds,
        picks: inserted,
      }),
    };

  } catch(err) {
    console.log('generate-picks fatal error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
