const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yumahmnoltvbiadjefxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

const TOURS = [
  { key: 'pga',   label: 'PGA Tour',      url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard' },
  { key: 'lpga',  label: 'LPGA Tour',      url: 'https://site.api.espn.com/apis/site/v2/sports/golf/lpga/scoreboard' },
  { key: 'eur',   label: 'DP World Tour',  url: 'https://site.api.espn.com/apis/site/v2/sports/golf/eur/scoreboard' },
  { key: 'liv',   label: 'LIV Golf',       url: 'https://site.api.espn.com/apis/site/v2/sports/golf/liv/scoreboard' },
];

const MAJOR_NAMES = [
  'masters', 'u.s. open', 'the open', 'pga championship',
  'players championship',
];

// ── HTTP helpers (no dependencies) ──────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' }, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

function supabaseRequest(method, path, body) {
  const urlObj = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
    };
    options.timeout = 8000;
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Supabase ${res.statusCode} on ${method} ${path}: ${data}`));
        }
        resolve(data ? JSON.parse(data) : null);
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Supabase timeout on ' + method + ' ' + path)); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function upsert(table, rows) {
  if (!rows || rows.length === 0) return Promise.resolve(null);
  // Add on_conflict for tables with unique constraints
  var conflict = '';
  if (table === 'leaderboard') conflict = '?on_conflict=tournament_id,player_id';
  else if (table === 'players') conflict = '?on_conflict=id';
  else if (table === 'tournaments') conflict = '?on_conflict=id';
  return supabaseRequest('POST', table + conflict, rows);
}

// ── ESPN parsing ────────────────────────────────────────────────────────────

function isMajor(name) {
  const lower = (name || '').toLowerCase();
  return MAJOR_NAMES.some((m) => lower.includes(m));
}

function parseStatus(espnStatus) {
  // ESPN status types: STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL
  if (!espnStatus) return 'scheduled';
  const t = (espnStatus.type?.name || espnStatus.type?.state || '').toLowerCase();
  if (t.includes('final') || t === 'post') return 'completed';
  if (t.includes('in_progress') || t === 'in') return 'in_progress';
  return 'scheduled';
}

function detectCurrentRound(competitions) {
  // Look at competition status for round info
  if (!competitions || !competitions.length) return 1;
  const comp = competitions[0];
  if (comp.status?.period) return comp.status.period;

  // Fallback: look at competitors' linescores to determine furthest round
  const competitors = comp.competitors || [];
  let maxRound = 1;
  for (const c of competitors) {
    const scores = c.linescores || [];
    if (scores.length > maxRound) maxRound = scores.length;
  }
  return maxRound;
}

function isRoundComplete(competitions) {
  if (!competitions || !competitions.length) return false;
  const comp = competitions[0];
  const state = (comp.status?.type?.state || '').toLowerCase();
  return state === 'post';
}

function parseTournament(event, tourKey) {
  const comp = event.competitions?.[0];
  const venue = comp?.venue || event.venue;

  // Extract dates
  const startDate = event.date || event.startDate;
  const endDate = event.endDate;
  const dates = endDate ? `${startDate} - ${endDate}` : startDate || '';

  // Broadcast info
  let broadcast = '';
  if (comp?.broadcasts?.length) {
    const names = comp.broadcasts.flatMap((b) => b.names || [b.name]).filter(Boolean);
    broadcast = names.join(', ');
  } else if (comp?.geoBroadcasts?.length) {
    const names = comp.geoBroadcasts.map((b) => b.media?.shortName).filter(Boolean);
    broadcast = [...new Set(names)].join(', ');
  }

  // Par — try course detail, then season-level
  let par = 72; // default
  if (comp?.course?.par) par = comp.course.par;
  else if (event.courses?.[0]?.par) par = event.courses[0].par;

  return {
    id: String(event.id),
    name: event.name || event.shortName || '',
    course: venue?.fullName || venue?.shortName || '',
    start_date: startDate || null,
    end_date: endDate || null,
    purse: event.purse ? Number(event.purse) : null,
    status: parseStatus(comp?.status),
    current_round: detectCurrentRound(event.competitions),
    par,
    broadcast,
    tour_id: tourKey,
    espn_event_id: String(event.id),
    is_major: isMajor(event.name),
  };
}

function parseCompetitor(competitor, tournamentId, tournamentPar) {
  const athlete = competitor.athlete || {};
  const playerId = String(athlete.id || competitor.id || '');

  // Player record
  const player = {
    id: playerId,
    name: athlete.displayName || athlete.fullName || '',
    country: athlete.flag?.alt || athlete.citizenship || '',
  };

  // Position — ESPN uses "order" field or "place" in status
  let position = '';
  if (competitor.status?.position?.displayName) {
    position = competitor.status.position.displayName;
  } else if (competitor.place != null) {
    position = String(competitor.place);
  } else if (competitor.order != null) {
    position = String(competitor.order);
  }

  // Total score — ESPN sends as a string like "-15", "E", "+3"
  const totalScore = competitor.score != null ? String(competitor.score) : '';

  // Today score
  let todayScore = '';
  const linescores = competitor.linescores || [];
  if (linescores.length > 0) {
    const latest = linescores[linescores.length - 1];
    if (latest.displayValue != null) {
      todayScore = String(latest.displayValue);
    } else if (latest.value != null && tournamentPar) {
      const diff = Number(latest.value) - tournamentPar;
      todayScore = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : String(diff));
    }
  }

  // Thru
  let thru = '';
  if (competitor.status?.thru != null) {
    thru = String(competitor.status.thru);
  } else if (competitor.status?.type?.name === 'STATUS_FINAL' ||
             competitor.status?.type?.state === 'post') {
    thru = 'F';
  }

  // Round scores from linescores
  const round1 = linescores[0]?.value != null ? Number(linescores[0].value) : null;
  const round2 = linescores[1]?.value != null ? Number(linescores[1].value) : null;
  const round3 = linescores[2]?.value != null ? Number(linescores[2].value) : null;
  const round4 = linescores[3]?.value != null ? Number(linescores[3].value) : null;

  // Player status: active, cut, wd, dq
  let status = 'active';
  const statusType = (competitor.status?.type?.name || '').toLowerCase();
  if (statusType.includes('cut')) status = 'cut';
  else if (statusType.includes('wd') || statusType.includes('withdraw')) status = 'wd';
  else if (statusType.includes('dq') || statusType.includes('disqualif')) status = 'dq';

  // Movement
  let movement = null;
  if (competitor.movement != null) {
    movement = Number(competitor.movement);
  }

  // Strokes gained
  let sgTotal = null;
  if (competitor.statistics) {
    const sgStat = competitor.statistics.find(
      (s) => s.name === 'strokesGainedTotal' || s.abbreviation === 'SG:T'
    );
    if (sgStat) sgTotal = Number(sgStat.displayValue || sgStat.value);
  }

  const leaderboardEntry = {
    tournament_id: tournamentId,
    player_id: playerId,
    position,
    total_score: totalScore,
    today_score: todayScore,
    thru,
    round1,
    round2,
    round3,
    round4,
    status,
    movement,
    sg_total: sgTotal,
    updated_at: new Date().toISOString(),
  };

  return { player, leaderboardEntry };
}

// ── Main processing ─────────────────────────────────────────────────────────

async function processTour(tour) {
  const result = {
    tour: tour.key,
    label: tour.label,
    tournaments: [],
    playersUpserted: 0,
    leaderboardRows: 0,
    errors: [],
  };

  let data;
  try {
    data = await httpGet(tour.url);
  } catch (err) {
    result.errors.push(`Fetch failed: ${err.message}`);
    return result;
  }

  const events = data.events || [];
  if (events.length === 0) {
    result.tournaments.push({ name: '(no active events)', status: 'none' });
    return result;
  }

  for (const event of events) {
    const tournament = parseTournament(event, tour.key);
    const tournamentSummary = {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      round: tournament.current_round,
      roundComplete: false,
      tournamentComplete: false,
      playerCount: 0,
    };

    // Upsert tournament
    try {
      await upsert('tournaments', [tournament]);
    } catch (err) {
      result.errors.push(`Tournament upsert failed (${tournament.name}): ${err.message}`);
    }

    // Parse competitors
    const comp = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    const players = [];
    const leaderboardRows = [];

    for (const c of competitors) {
      try {
        const { player, leaderboardEntry } = parseCompetitor(c, tournament.id, tournament.par);
        if (player.id) {
          players.push(player);
          leaderboardRows.push(leaderboardEntry);
        }
      } catch (err) {
        result.errors.push(`Competitor parse error: ${err.message}`);
      }
    }

    // Upsert players
    if (players.length > 0) {
      try {
        await upsert('players', players);
        result.playersUpserted += players.length;
      } catch (err) {
        result.errors.push(`Players upsert failed: ${err.message}`);
      }
    }

    // Upsert leaderboard in batches (Supabase can struggle with huge payloads)
    const BATCH_SIZE = 50;
    for (let i = 0; i < leaderboardRows.length; i += BATCH_SIZE) {
      const batch = leaderboardRows.slice(i, i + BATCH_SIZE);
      try {
        await upsert('leaderboard', batch);
      } catch (err) {
        result.errors.push(`Leaderboard upsert batch failed: ${err.message}`);
      }
    }
    result.leaderboardRows += leaderboardRows.length;

    // Round / tournament completion detection
    const roundComplete = isRoundComplete(event.competitions);
    const tournamentComplete = tournament.status === 'completed';

    tournamentSummary.roundComplete = roundComplete;
    tournamentSummary.tournamentComplete = tournamentComplete;
    tournamentSummary.playerCount = competitors.length;

    result.tournaments.push(tournamentSummary);
  }

  return result;
}

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async function (event, context) {
  // Allow filtering to a specific tour via query param ?tour=pga
  const params = event.queryStringParameters || {};
  const tourFilter = params.tour ? params.tour.toLowerCase() : null;

  const toursToProcess = tourFilter
    ? TOURS.filter((t) => t.key === tourFilter)
    : TOURS;

  if (toursToProcess.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Unknown tour: ${tourFilter}. Valid: pga, lpga, eur, liv` }),
    };
  }

  const startTime = Date.now();
  const results = [];

  // Process tours in parallel
  const settled = await Promise.allSettled(toursToProcess.map((t) => processTour(t)));

  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled') {
      results.push(settled[i].value);
    } else {
      results.push({
        tour: toursToProcess[i].key,
        label: toursToProcess[i].label,
        tournaments: [],
        playersUpserted: 0,
        leaderboardRows: 0,
        errors: [settled[i].reason?.message || 'Unknown error'],
      });
    }
  }

  const elapsed = Date.now() - startTime;
  const totalPlayers = results.reduce((s, r) => s + r.playersUpserted, 0);
  const totalRows = results.reduce((s, r) => s + r.leaderboardRows, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  const response = {
    ok: totalErrors === 0,
    elapsed_ms: elapsed,
    summary: {
      tours_processed: results.length,
      total_players_upserted: totalPlayers,
      total_leaderboard_rows: totalRows,
      total_errors: totalErrors,
    },
    tours: results,
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(response, null, 2),
  };
};
