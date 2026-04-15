// Fetch real sportsbook odds from The Odds API and store in Supabase
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms || 8000);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function sb(path, method, body) {
  const hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=minimal';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await fetchWithTimeout(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET', headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  }, 8000);
  if (!method || method === 'GET') { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!ODDS_API_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'ODDS_API_KEY not set' }) };

  try {
    // ── STEP 1 — discover currently active golf sport keys ──
    // The Odds API /v4/sports endpoint returns a catalog filtered to in-season events.
    // This replaces the previous hardcoded 4-majors list which failed every non-major week.
    const sportsRes = await fetchWithTimeout(`https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}`, {}, 8000);
    if (!sportsRes.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Odds API /sports HTTP ' + sportsRes.status }) };
    }
    const allSports = await sportsRes.json();
    const golfSports = (allSports || []).filter(function(s) {
      return s.group === 'Golf' && s.active && /winner/i.test(s.key);
    });
    if (golfSports.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No active golf outright markets on Odds API' }) };
    }
    console.log('Active golf sports:', golfSports.map(function(s) { return s.key; }).join(', '));

    // ── STEP 2 — pick the key that matches our next tournament ──
    const nextRows = await sb('tournaments?status=in.(scheduled,in_progress)&order=start_date.asc&limit=5');
    const nextTournament = nextRows[0] || null;
    const nextNameLower = (nextTournament?.name || '').toLowerCase();
    function keyScore(sport) {
      const t = (sport.title || '').toLowerCase();
      if (!nextNameLower) return 0;
      // Reward strong name overlap
      const words = nextNameLower.split(/\s+/).filter(function(w) { return w.length > 3; });
      return words.reduce(function(acc, w) { return acc + (t.includes(w) ? 1 : 0); }, 0);
    }
    const ranked = golfSports.slice().sort(function(a, b) { return keyScore(b) - keyScore(a); });
    console.log('Tournament:', nextTournament?.name, '→ ranked sport matches:', ranked.map(function(s) { return s.key + '(' + keyScore(s) + ')'; }).join(', '));

    // ── STEP 3 — try each candidate until one has odds ──
    let oddsData = null;
    let sportKey = '';
    let matchedName = '';
    for (const sport of ranked) {
      const url = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=outrights&oddsFormat=american`;
      try {
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok) { console.log('Odds API', res.status, 'for', sport.key); continue; }
        const data = await res.json();
        console.log('Odds API', sport.key, ':', data.length, 'events');
        if (data && data.length > 0) {
          oddsData = data[0];
          sportKey = sport.key;
          matchedName = sport.title;
          break;
        }
      } catch(e) { console.log('Odds API err', sport.key, ':', e.message); continue; }
    }

    if (!oddsData || !oddsData.bookmakers) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No odds data available from any active golf market', candidates: ranked.map(function(s) { return s.key; }) }) };
    }
    console.log('Matched', sportKey, '(' + matchedName + ') for', nextTournament?.name || 'unknown tournament');

    // Parse odds from all bookmakers
    const playerOdds = {};

    for (const book of oddsData.bookmakers) {
      const market = book.markets.find(m => m.key === 'outrights');
      if (!market) continue;

      for (const outcome of market.outcomes) {
        const name = outcome.name;
        if (!playerOdds[name]) {
          playerOdds[name] = { player_name: name, best_odds: -99999, best_book: '', draftkings_odds: null, fanduel_odds: null, betmgm_odds: null };
        }

        const odds = outcome.price;

        // Track best odds (highest payout)
        if (odds > playerOdds[name].best_odds) {
          playerOdds[name].best_odds = odds;
          playerOdds[name].best_book = book.title;
        }

        // Track specific books
        const bookKey = book.key.toLowerCase();
        if (bookKey.includes('draftkings')) playerOdds[name].draftkings_odds = odds;
        else if (bookKey.includes('fanduel')) playerOdds[name].fanduel_odds = odds;
        else if (bookKey.includes('betmgm')) playerOdds[name].betmgm_odds = odds;
      }
    }

    // Calculate implied probability and upsert
    const tournamentId = sportKey.replace('golf_', '').replace('_winner', '');
    let upserted = 0;

    // Purge any previously-stored rows for a DIFFERENT tournament AND any rows
    // older than 7 days. Prevents completed-event odds from lingering on the frontend.
    try {
      await sb('player_odds?tournament_id=neq.' + encodeURIComponent(tournamentId), 'DELETE');
      const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await sb('player_odds?updated_at=lt.' + staleCutoff, 'DELETE');
    } catch(e) { console.log('purge stale odds:', e.message); }

    for (const [name, data] of Object.entries(playerOdds)) {
      const odds = data.best_odds;
      const implied = odds > 0
        ? (100 / (odds + 100) * 100)
        : (Math.abs(odds) / (Math.abs(odds) + 100) * 100);

      // Upsert into player_odds
      const existing = await sb(`player_odds?tournament_id=eq.${encodeURIComponent(tournamentId)}&player_name=eq.${encodeURIComponent(name)}&select=id`);

      if (existing && existing.length > 0) {
        await sb(`player_odds?id=eq.${existing[0].id}`, 'PATCH', {
          best_odds: data.best_odds,
          best_book: data.best_book,
          draftkings_odds: data.draftkings_odds,
          fanduel_odds: data.fanduel_odds,
          betmgm_odds: data.betmgm_odds,
          implied_probability: parseFloat(implied.toFixed(2)),
          updated_at: new Date().toISOString(),
        });
      } else {
        await sb('player_odds', 'POST', {
          tournament_id: tournamentId,
          player_name: name,
          best_odds: data.best_odds,
          best_book: data.best_book,
          draftkings_odds: data.draftkings_odds,
          fanduel_odds: data.fanduel_odds,
          betmgm_odds: data.betmgm_odds,
          implied_probability: parseFloat(implied.toFixed(2)),
          updated_at: new Date().toISOString(),
        });
      }
      upserted++;
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        sport: sportKey,
        tournament: oddsData.sport_title,
        books: oddsData.bookmakers.map(b => b.title),
        players: upserted,
        topOdds: Object.entries(playerOdds)
          .sort((a, b) => a[1].best_odds - b[1].best_odds)
          .slice(0, 10)
          .map(([name, d]) => ({ name, odds: d.best_odds > 0 ? '+' + d.best_odds : '' + d.best_odds, book: d.best_book })),
      }),
    };

  } catch(err) {
    console.log('fetch-odds fatal error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
