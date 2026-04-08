// Generate AI-powered betting picks from real sportsbook odds + player analysis
// Stores picks in betting_picks table — single source of truth for all picks across the site

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

    // 5. Build compact odds string
    const oddsStr = odds.map(function(o) {
      var s = o.best_odds > 0 ? '+' + o.best_odds : '' + o.best_odds;
      return o.player_name + ' ' + s;
    }).join(', ');

    // 6. Call Claude Haiku for analysis
    console.log('Calling Anthropic API now...');
    const systemPrompt = 'You are a sharp sports handicapper. Analyze these Masters odds and return ONLY valid JSON — no explanation, no markdown, just the JSON object. Be fast and precise.';

    const userPrompt = `Given these 20 players and their American odds, return a JSON object with exactly these picks:
- best_bet: { player_name, odds, analysis (1 sentence) }
- value_plays: array of 3 { player_name, odds, analysis (1 sentence) }
- longshot: { player_name, odds, analysis (1 sentence) }
- fade: { player_name, odds, analysis (1 sentence) }

Only pick players where true probability exceeds implied probability. Return raw JSON only.

${tournament.name} odds: ${oddsStr}`;

    const res = await fetchT('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, 40000);
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

    // 8. Insert into betting_picks
    console.log('Saving to Supabase...');
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
        is_value: true,
        edge_label: edgeLabel,
        analysis: pick.analysis || '',
        confidence: pick.confidence || 5,
        units: betType === 'outright' ? 2.0 : betType === 'top5' ? 1.5 : betType === 'longshot' || betType === 'parlay' ? 0.5 : 1.0,
        result: 'pending',
        sportsbook: pick.sportsbook || 'DraftKings',
        created_at: new Date().toISOString(),
      };
      console.log('Inserting into table: betting_picks');
      console.log('Attempting Supabase insert, row:', JSON.stringify(row, null, 2));
      const insertRes = await fetchT(SB_URL + '/rest/v1/betting_picks', {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      console.log('Supabase insert response status:', insertRes.status);
      const insertBody = await insertRes.text();
      console.log('Supabase insert response body:', insertBody.slice(0, 500));
      inserted.push({ bet_type: betType, player: pick.player_name || pick.pick || pick.name });
      return insertBody;
    }

    console.log('Attempting Supabase insert, picks array:', JSON.stringify(picks, null, 2));

    // Best bet
    if (picks.best_bet) {
      picks.best_bet.pick = picks.best_bet.player_name + ' to win outright';
      await insertPick('outright', 'BEST BET', picks.best_bet);
    }

    // Value plays → store as top5 type for frontend compatibility
    if (picks.value_plays) {
      for (const p of picks.value_plays.slice(0, 3)) {
        p.pick = p.player_name + ' Top 5 finish';
        await insertPick('top5', 'VALUE', p);
      }
    }

    // Longshot
    if (picks.longshot) {
      picks.longshot.pick = picks.longshot.player_name + ' to win outright';
      await insertPick('longshot', 'LONGSHOT', picks.longshot);
    }

    // Fade → store as top10 type with FADE label
    if (picks.fade) {
      picks.fade.pick = 'Fade ' + picks.fade.player_name;
      await insertPick('top10', 'FADE', picks.fade);
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
