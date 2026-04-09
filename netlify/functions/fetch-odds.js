// Fetch real sportsbook odds from The Odds API and store in Supabase
const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e8ed97fe49b8efaf710868b29e1c6c1b';
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

  try {
    // Fetch odds for Masters (or current golf event)
    const sports = ['golf_masters_tournament_winner', 'golf_pga_championship_winner', 'golf_us_open_winner', 'golf_the_open_championship_winner'];
    let oddsData = null;
    let sportKey = '';

    for (const sport of sports) {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=outrights&oddsFormat=american`;
      console.log('Fetching odds:', url.replace(ODDS_API_KEY, 'REDACTED'));
      try {
        const res = await fetchWithTimeout(url, {}, 8000);
        if (res.ok) {
          const data = await res.json();
          console.log('Odds API response for', sport, ':', data.length, 'events');
          if (data && data.length > 0) {
            oddsData = data[0];
            sportKey = sport;
            break;
          }
        } else {
          console.log('Odds API returned', res.status, 'for', sport);
        }
      } catch(e) {
        console.log('Odds API fetch failed for', sport, ':', e.message);
        continue;
      }
    }

    if (!oddsData || !oddsData.bookmakers) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No odds data available', sports_checked: sports }) };
    }

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
