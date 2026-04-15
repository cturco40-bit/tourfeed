// fetch-pga-graphql.js — enriches live-tournament data from orchestrator.pgatour.com/graphql
// Populates:
//   - tournament_live_context  (leaders, cut line, round status)
//   - pga_leaderboard          (player-level with live oddsToWin)
//   - course_holes             (hole-by-hole difficulty)
//   - sg_leaders               (season strokes-gained leaders)
//
// Cron cadence: every 2 min via netlify.toml. SG leaders refresh at most once per 24h
// (cheap call, but no point spamming a season stat).
//
// All GraphQL shapes below were verified against real Masters 2026 (R2026014) data
// during development — do not change field names without re-probing the schema.

const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PGA_GQL_URL = 'https://orchestrator.pgatour.com/graphql';
// Public anonymous key used by pgatour.com's own frontend. No auth required; fail cleanly if revoked.
const PGA_GQL_KEY = 'da2-gsrx5bibzbb4njvhl7t37wqyl4';

function ft(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms || 12000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(() => clearTimeout(t));
}

async function sb(path, method, body) {
  const hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST')  hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await ft(SB_URL + '/rest/v1/' + path, { method: method || 'GET', headers: hdrs, body: body ? JSON.stringify(body) : undefined });
  if (!method || method === 'GET') { try { const d = await res.json(); return Array.isArray(d) ? d : []; } catch { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch { return []; } }
  return res.ok;
}

async function pgaQuery(query) {
  const res = await ft(PGA_GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': PGA_GQL_KEY },
    body: JSON.stringify({ query }),
  }, 15000);
  if (!res.ok) throw new Error('PGA GraphQL HTTP ' + res.status);
  const data = await res.json();
  if (data.errors) throw new Error('PGA GraphQL: ' + (data.errors[0]?.message || 'unknown'));
  return data.data;
}

async function logSync(status, records, message, durationMs) {
  try {
    await sb('sync_log', 'POST', {
      sync_type: 'pga_graphql',
      status,
      records_processed: records || 0,
      error_message: message || null,
      duration_ms: durationMs || 0,
    });
  } catch {}
}

// Parse "+2.002" or "-0.345" into a number, null if garbage
function parseNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^\d.\-+]/g, ''));
  return isFinite(n) ? n : null;
}

// ═══════════════════════════════════════════════════════════════
// STEP A — Find the active tournament (local row + PGA ID)
// ═══════════════════════════════════════════════════════════════
async function findActiveTournament() {
  // Trust local Postgres: content-controller already tracks the active row.
  const rows = await sb('tournaments?status=eq.in_progress&select=id,name,pga_tournament_id,tour_id&limit=1');
  if (rows.length === 0) return null;
  const t = rows[0];
  if (t.pga_tournament_id) return t;

  // No PGA ID yet — look it up from the schedule by fuzzy name match
  // schedule(tourCode, year) returns months of tournaments; we scan current+prev month
  const year = new Date().getUTCFullYear();
  const nameLower = (t.name || '').toLowerCase();
  try {
    const data = await pgaQuery(`{ schedule(tourCode:"R", year:"${year}") {
      upcoming { tournaments { id tournamentName } }
      completed { tournaments { id tournamentName } }
    } }`);
    const all = []
      .concat(...(data.schedule?.upcoming  || []).map(m => m.tournaments || []))
      .concat(...(data.schedule?.completed || []).map(m => m.tournaments || []));
    const match = all.find(x => (x.tournamentName || '').toLowerCase().includes(nameLower) || nameLower.includes((x.tournamentName || '').toLowerCase()));
    if (match) {
      await sb('tournaments?id=eq.' + encodeURIComponent(t.id), 'PATCH', { pga_tournament_id: match.id });
      t.pga_tournament_id = match.id;
    }
  } catch (e) {
    console.log('Schedule lookup failed:', e.message);
  }
  return t.pga_tournament_id ? t : null;
}

// ═══════════════════════════════════════════════════════════════
// STEP B — Live leaderboard enrichment
// ═══════════════════════════════════════════════════════════════
async function fetchLeaderboard(pgaId) {
  const data = await pgaQuery(`{
    leaderboardV3(id:"${pgaId}") {
      id
      tournamentStatus
      leaderboardRoundHeader
      cutLineProbabilities { projectedCutLine probableCutLine lastUpdated }
      players {
        ... on PlayerRowV3 {
          id
          player { id firstName lastName shortName country countryFlag }
          scoringData {
            position total totalStrokes score thru playerState
            oddsToWin movementDirection movementAmount currentRound
          }
        }
      }
    }
  }`);
  const lb = data.leaderboardV3;
  if (!lb) return { context: 0, rows: 0 };

  // Filter out non-player rows (cut markers, etc — they lack `player`)
  const rows = (lb.players || []).filter(r => r && r.player && r.scoringData);

  const leadersJson = rows.slice(0, 10).map(r => ({
    position: r.scoringData.position,
    player: r.player.shortName,
    country: r.player.country,
    total: r.scoringData.total,
    today: r.scoringData.score,
    thru: r.scoringData.thru,
    odds: r.scoringData.oddsToWin,
    state: r.scoringData.playerState,
  }));
  const currentRound = rows.find(r => r.scoringData?.currentRound)?.scoringData?.currentRound || null;

  // Upsert context (delete-then-insert — Supabase REST upsert needs schema hints we're avoiding)
  await sb('tournament_live_context?pga_tournament_id=eq.' + encodeURIComponent(pgaId), 'DELETE');
  await sb('tournament_live_context', 'POST', {
    pga_tournament_id:  pgaId,
    tournament_name:    null,
    tournament_status:  lb.tournamentStatus || null,
    current_round:      currentRound,
    round_header:       lb.leaderboardRoundHeader || null,
    projected_cut_line: lb.cutLineProbabilities?.projectedCutLine || null,
    probable_cut_line:  lb.cutLineProbabilities?.probableCutLine || null,
    cut_last_updated:   lb.cutLineProbabilities?.lastUpdated || null,
    leaders_json:       leadersJson,
    raw_player_count:   rows.length,
    fetched_at:         new Date().toISOString(),
  });

  // Replace per-player rows for this tournament
  await sb('pga_leaderboard?pga_tournament_id=eq.' + encodeURIComponent(pgaId), 'DELETE');
  // Batch insert in chunks of 50 to stay well under PostgREST limits
  const nowIso = new Date().toISOString();
  const toInsert = rows.map(r => ({
    pga_tournament_id:  pgaId,
    pga_player_id:      r.player.id,
    player_name:        r.player.shortName || ((r.player.firstName || '') + ' ' + (r.player.lastName || '')).trim(),
    country:            r.player.country || null,
    country_flag:       r.player.countryFlag || null,
    position:           r.scoringData.position || null,
    total:              r.scoringData.total || null,
    total_strokes:      r.scoringData.totalStrokes || null,
    today_score:        r.scoringData.score || null,
    thru:               r.scoringData.thru || null,
    player_state:       r.scoringData.playerState || null,
    odds_to_win:        r.scoringData.oddsToWin || null,
    movement_direction: r.scoringData.movementDirection || null,
    movement_amount:    r.scoringData.movementAmount || null,
    current_round:      r.scoringData.currentRound || null,
    fetched_at:         nowIso,
  }));
  for (let i = 0; i < toInsert.length; i += 50) {
    await sb('pga_leaderboard', 'POST', toInsert.slice(i, i + 50));
  }

  return { context: 1, rows: toInsert.length };
}

// ═══════════════════════════════════════════════════════════════
// STEP C — Course hole difficulty
// ═══════════════════════════════════════════════════════════════
async function fetchCourseHoles(pgaId) {
  const data = await pgaQuery(`{
    courseStats(tournamentId:"${pgaId}") {
      courses {
        courseId courseName par yardage
        roundHoleStats {
          roundHeader
          holeStats {
            ... on CourseHoleStats {
              courseHoleNum parValue yards scoringAverage scoringAverageDiff
              rank eagles birdies pars bogeys doubleBogey
            }
          }
        }
      }
    }
  }`);
  const courses = data.courseStats?.courses || [];
  if (courses.length === 0) return 0;

  // Wipe previous rows for this tournament, insert fresh "All Rounds" slice per course
  await sb('course_holes?pga_tournament_id=eq.' + encodeURIComponent(pgaId), 'DELETE');
  const nowIso = new Date().toISOString();
  let total = 0;
  for (const c of courses) {
    const all = (c.roundHoleStats || []).find(r => r.roundHeader === 'All Rounds') || c.roundHoleStats?.[0];
    if (!all) continue;
    // Filter out SummaryRow rows (they lack courseHoleNum)
    const holes = (all.holeStats || []).filter(h => h && typeof h.courseHoleNum === 'number');
    const rows = holes.map(h => ({
      pga_tournament_id: pgaId,
      course_id:         c.courseId || null,
      hole:              h.courseHoleNum,
      par:               parseInt(h.parValue, 10) || null,
      yards:             h.yards || null,
      avg_score:         parseNum(h.scoringAverage),
      rank:              h.rank || null,
      eagles:            h.eagles || 0,
      birdies:           h.birdies || 0,
      pars:              h.pars || 0,
      bogeys:            h.bogeys || 0,
      doubles_plus:      h.doubleBogey || 0,
      fetched_at:        nowIso,
    }));
    for (let i = 0; i < rows.length; i += 50) {
      await sb('course_holes', 'POST', rows.slice(i, i + 50));
      total += rows.length;
    }
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════
// STEP D — Season SG leaders (runs at most once per 24h)
// ═══════════════════════════════════════════════════════════════
async function refreshSGLeadersIfStale() {
  const tourCode = 'R';
  const season = new Date().getUTCFullYear();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await sb(`sg_leaders?tour_code=eq.${tourCode}&season=eq.${season}&fetched_at=gte.${cutoff}&select=id&limit=1`);
  if (recent.length > 0) return { skipped: true };

  const data = await pgaQuery(`{
    statLeaders(tourCode:R, category:STROKES_GAINED, year:${season}) {
      subCategories { subCategoryName stats { statId playerId statTitle statValue playerName rank country countryFlag } }
    }
  }`);
  const subs = data.statLeaders?.subCategories || [];
  const rows = [];
  for (const sub of subs) {
    for (const s of (sub.stats || [])) {
      if (!s.statId || !s.playerName) continue;
      rows.push({
        tour_code:      tourCode,
        season,
        stat_id:        s.statId,
        stat_title:     s.statTitle || sub.subCategoryName || 'SG',
        rank:           s.rank || null,
        player_name:    s.playerName,
        player_id:      s.playerId || null,
        country:        s.country || null,
        country_flag:   s.countryFlag || null,
        stat_value:     s.statValue || '',
        stat_value_num: parseNum(s.statValue),
        fetched_at:     new Date().toISOString(),
      });
    }
  }
  if (rows.length === 0) return { inserted: 0 };
  // Replace season rows
  await sb(`sg_leaders?tour_code=eq.${tourCode}&season=eq.${season}`, 'DELETE');
  for (let i = 0; i < rows.length; i += 50) {
    await sb('sg_leaders', 'POST', rows.slice(i, i + 50));
  }
  return { inserted: rows.length };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
exports.handler = async () => {
  const started = Date.now();
  const resp = { lb_rows: 0, hole_rows: 0, sg: null, tournament: null, skipped: null };
  try {
    if (!SB_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

    // SG leaders first — cheap, independent of tournament state
    try { resp.sg = await refreshSGLeadersIfStale(); }
    catch (e) { resp.sg = { error: e.message }; }

    // Active tournament enrichment
    const active = await findActiveTournament();
    if (!active) {
      resp.skipped = 'no active tournament';
      await logSync('success', 0, 'no active tournament', Date.now() - started);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) };
    }
    resp.tournament = { id: active.id, pga: active.pga_tournament_id, name: active.name };

    try {
      const lb = await fetchLeaderboard(active.pga_tournament_id);
      resp.lb_rows = lb.rows;
    } catch (e) {
      resp.lb_error = e.message;
    }

    try {
      resp.hole_rows = await fetchCourseHoles(active.pga_tournament_id);
    } catch (e) {
      resp.hole_error = e.message;
    }

    await logSync('success', resp.lb_rows + resp.hole_rows, JSON.stringify({ sg: resp.sg, tournament: active.pga_tournament_id }), Date.now() - started);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) };
  } catch (e) {
    await logSync('error', 0, e.message, Date.now() - started);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
