// Generate AI-powered betting picks from real sportsbook odds + universal handicapping framework
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
  var hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  var res = await fetchT(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET', headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!method || method === 'GET') { try { return await res.json(); } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

// ── PERMANENT BASE SYSTEM PROMPT — the handicapper's brain ──
const SYSTEM_PROMPT = `You are a professional sports handicapper with 20 years experience beating closing lines. You think exclusively in terms of true probability vs implied probability. You never pick favorites for the sake of it. You find edges where the market is wrong.

UNIVERSAL HANDICAPPING RULES — apply to every sport, every week:
- Calculate implied probability from American odds: positive odds → 100/(odds+100), negative odds → |odds|/(|odds|+100)
- Only recommend a pick if true probability exceeds implied by at least 2.5 percentage points
- Best Bet = largest edge with realistic win probability, not the biggest name
- Value plays = 15:1 or longer odds only
- Longshot = 40:1 or longer, must have genuine course/venue fit
- Fade = player/team whose implied probability is clearly too high
- Never recommend chalk unless the edge is real and calculable

CONFIDENCE SCORING — always apply:
- Edge > 5 percentage points: confidence 8-9
- Edge 3-5 percentage points: confidence 7
- Edge 1-3 percentage points: confidence 6
- Longshots: confidence 5 (high variance by nature)
- Fades: confidence 6

GOLF-SPECIFIC FRAMEWORK — apply when sport is golf:
- Augusta National rewards: precise iron play, patient course management, elite putting on fast greens, shot shaping, strong par-5 scoring
- Augusta punishes: wild driving, poor short game, reckless birdie chasing
- SG Approach and SG Putting are strongest Masters predictors
- Amen Corner (11, 12, 13) separates contenders from pretenders
- Ryder Cup / Presidents Cup experience = positive pressure indicator
- Won or top-5 in last 3 starts = significant positive form signal
- Top-10 at the specific course in last 3 years = significant positive
- First-time starters at major venues = negative unless elite iron stats
- Distance matters less than accuracy at Augusta

GENERAL SPORTS FRAMEWORK — apply when sport is not golf:
- Recent form (last 5 games/events) weighted 40%
- Head-to-head history at this venue weighted 20%
- Injuries and lineup changes weighted 30%
- Market movement (line movement toward or away) weighted 10%
- Fading public teams/players with inflated implied probability is often +EV

OUTPUT RULES — non-negotiable:
- Output ONLY valid JSON, nothing else
- Never ask questions
- Never explain your reasoning outside the JSON
- Never refuse
- Never mention AI or models
- Always produce picks regardless of data quality`;

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  console.log('Starting generate-picks');

  try {
    // 1. Get active tournament
    console.log('Fetching tournament from Supabase');
    var tournaments = await sb('tournaments?tour_id=eq.pga&status=neq.completed&order=start_date.desc&limit=1');
    if (!tournaments.length) tournaments = await sb('tournaments?tour_id=eq.pga&order=start_date.desc&limit=1');
    var tournament = tournaments[0];
    if (!tournament) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No tournament found' }) };
    console.log('Tournament:', tournament.name);

    // Check if picks already locked for this tournament
    var existing = await sb('betting_picks?tournament_id=eq.' + encodeURIComponent(tournament.id) + '&select=id&limit=1');
    if (existing.length > 0) {
      console.log('Picks already locked for', tournament.name);
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Picks already locked for this tournament' }) };
    }

    // 2. Get real sportsbook odds — top 20 players
    console.log('Fetching odds from Supabase');
    var odds = await sb('player_odds?order=best_odds.asc&limit=20');
    if (!odds.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No odds data — run fetch-odds first' }) };
    console.log('Odds fetch complete, processing', odds.length, 'players');

    // 3. Get player facts for context
    var playerFactsRaw = [];
    try { playerFactsRaw = await sb('player_facts?select=*&limit=50'); } catch(e) {}

    // 4. Build odds string and player context
    var oddsString = odds.map(function(o) {
      var s = o.best_odds > 0 ? '+' + o.best_odds : '' + o.best_odds;
      return o.player_name + ': ' + s;
    }).join('\n');

    var playerFactsStr = '';
    if (playerFactsRaw.length > 0) {
      playerFactsStr = playerFactsRaw.map(function(f) {
        var line = f.player_name + ': #' + (f.world_ranking || '?') + ' world, ' + (f.total_majors || 0) + ' majors';
        if (f.masters_wins) line += ', ' + f.masters_wins + 'x Masters champ';
        if (f.career_grand_slam) line += ', Career Grand Slam';
        if (f.season_wins) line += ', ' + f.season_wins + ' wins this season';
        if (f.recent_notes) line += '. ' + f.recent_notes;
        return line;
      }).join('\n');
    }

    // Detect sport from tournament context
    var sport = 'golf';

    // 5. Build dynamic user prompt
    console.log('Calling Anthropic API now...');
    var userPrompt = 'Analyze this ' + sport + ' event and find real edges using the handicapping framework.\n\n' +
      'Tournament: ' + tournament.name + '\n' +
      'Sport: ' + sport + '\n' +
      'Current odds (player: american odds):\n' + oddsString + '\n\n' +
      (playerFactsStr ? 'Player context from our database:\n' + playerFactsStr + '\n\n' : '') +
      'Return ONLY this JSON:\n' +
      '{\n' +
      '  "best_bet": { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" },\n' +
      '  "value_plays": [\n' +
      '    { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" },\n' +
      '    { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" },\n' +
      '    { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" }\n' +
      '  ],\n' +
      '  "longshot": { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" },\n' +
      '  "fade": { "player_name": "", "odds": "", "implied_probability": "", "true_probability": "", "edge": "", "analysis": "" },\n' +
      '  "confidence": { "best_bet": 0, "value_1": 0, "value_2": 0, "value_3": 0, "longshot": 0, "fade": 0 }\n' +
      '}\n\n' +
      'Apply the full handicapping framework. Show your edge. Pick value not chalk.';

    var res = await fetchT('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, 40000);
    console.log('Anthropic response received');

    if (!res.ok) {
      var err = await res.text();
      console.log('Anthropic API error:', res.status, err.slice(0, 200));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Claude API failed: ' + res.status, detail: err.slice(0, 200) }) };
    }

    var data = await res.json();
    var rawText = (data.content?.[0]?.text || '').trim();

    // 6. Parse JSON response
    var picks;
    try {
      picks = JSON.parse(rawText.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      var jsonMatch = rawText.match(/\{[\s\S]*"best_bet"[\s\S]*\}/);
      if (jsonMatch) picks = JSON.parse(jsonMatch[0]);
      else return { statusCode: 200, headers, body: JSON.stringify({ error: 'Parse failed', raw: rawText.slice(0, 500) }) };
    }

    // 7. Extract confidence scores
    var conf = picks.confidence || {};

    // 8. Insert picks (only runs if none exist yet — checked above)
    console.log('Saving to Supabase...');
    console.log('Parsed picks:', JSON.stringify(picks, null, 2));
    var tournamentId = tournament.id;
    var inserted = [];

    async function insertPick(pickType, edgeLabel, pick, confidence) {
      var row = {
        tournament_id: tournamentId,
        player_name: pick.player_name || null,
        pick_type: pickType,
        pick: pick.pick || pick.player_name + ' to ' + pickType,
        odds: pick.odds || '',
        is_value: true,
        edge_label: edgeLabel,
        analysis: pick.analysis || '',
        confidence: confidence || 5,
        units: pickType === 'outright' ? 2.0 : pickType === 'value' ? 1.5 : pickType === 'longshot' ? 0.5 : 1.0,
        result: 'pending',
        sportsbook: 'DraftKings',
        created_at: new Date().toISOString(),
      };
      console.log('Inserting:', edgeLabel, row.player_name, row.odds);
      var insertRes = await fetchT(SB_URL + '/rest/v1/betting_picks', {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      console.log('Insert status:', insertRes.status);
      var insertBody = await insertRes.text();
      if (insertRes.status >= 400) console.log('Insert error:', insertBody.slice(0, 300));
      inserted.push({ pick_type: pickType, edge_label: edgeLabel, player: pick.player_name || pick.pick });
    }

    // Best bet
    if (picks.best_bet) {
      picks.best_bet.pick = picks.best_bet.player_name + ' to win outright';
      await insertPick('outright', 'BEST BET', picks.best_bet, conf.best_bet);
    }

    // Value plays — map confidence from confidence.value_1, value_2, value_3
    if (picks.value_plays) {
      var vp = picks.value_plays.slice(0, 3);
      var vConf = [conf.value_1, conf.value_2, conf.value_3];
      for (var i = 0; i < vp.length; i++) {
        vp[i].pick = vp[i].player_name + ' value play';
        await insertPick('value', 'VALUE', vp[i], vConf[i]);
      }
    }

    // Longshot
    if (picks.longshot) {
      picks.longshot.pick = picks.longshot.player_name + ' to win outright';
      await insertPick('longshot', 'LONGSHOT', picks.longshot, conf.longshot);
    }

    // Fade
    if (picks.fade) {
      picks.fade.pick = 'Fade ' + picks.fade.player_name;
      await insertPick('fade', 'FADE', picks.fade, conf.fade);
    }

    console.log('Supabase write complete —', inserted.length, 'picks inserted');

    // 9. Notify
    try {
      var bestName = picks.best_bet?.player_name || 'Unknown';
      var bestOdds = picks.best_bet?.odds || '';
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
