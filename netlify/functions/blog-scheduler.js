// Daily blog content scheduler
// Monday: Power Rankings | Tuesday: Course Preview | Wednesday: Betting Preview
// Friday: Cut Line Analysis | Sunday: Final Recap + Next Week

const SUPABASE_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

async function sb(path, method, body) {
  const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: method || 'GET', headers: hdrs, body: body ? JSON.stringify(body) : undefined });
  if (!method || method === 'GET') { try { const d = await res.json(); return Array.isArray(d) ? d : []; } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

function hashText(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3).sort().join(' ');
  let h = 0;
  for (let i = 0; i < words.length; i++) h = ((h << 5) - h + words.charCodeAt(i)) | 0;
  return 'h' + Math.abs(h).toString(36);
}

// All available content types — callable by day schedule or force_type param
const ALL_CONTENT = {
  power_rankings: { type: 'article_analysis', prompt: 'Write a POWER RANKINGS article ranking the top 15 golfers heading into this week\'s tournament. Include recent form, key stats, and reasoning. ONLY rank players confirmed in the field — check PLAYER FACTS for who is NOT playing. If a player is marked NOT in the field, do NOT include them. 800+ words.' },
  course_preview: { type: 'article_preview', prompt: 'Write a detailed COURSE PREVIEW for this week\'s tournament. Cover course layout, key holes, signature moments, what type of player the course rewards, par 5 strategy, green complexes, historical scoring trends, and past champions. Include course-specific stats that matter. 800+ words.' },
  betting_preview: { type: 'article_betting', prompt: 'Write a comprehensive BETTING PREVIEW. Include: outright winner picks (3 with odds, confidence 1-10, unit sizing), top 5 picks (3), top 10 picks (3), first round leader (2), head-to-head matchups (3 with pick and reasoning), longshot of the week (50:1+), prop bets (3), and a parlay suggestion. ONLY include players in the field. 800+ words.' },
  cut_line: { type: 'article_betting', prompt: 'Write a CUT LINE ANALYSIS. Who is on the bubble? Which bubble players are worth betting on for the weekend? Include specific players, scores, projected cut line, and weekend outright odds.' },
  field_breakdown: { type: 'article_analysis', prompt: 'Write a FIELD BREAKDOWN article. Group the field into tiers: favorites, contenders, dark horses, and longshots. For each tier, explain why those players are placed there. Include recent form, course history, and key stats. Focus on players actually IN the field. 800+ words.' },
  storylines: { type: 'article_preview', prompt: 'Write a TOP STORYLINES article for this week\'s tournament. Cover the 5-7 biggest narratives: defending champion drama, injury comebacks, rivalry matchups, LIV players competing, record chases, personal stories (new babies, comebacks from surgery, etc.). Each storyline gets 2-3 paragraphs. Make it the article fans share with friends. 800+ words.' },
  masters_preview: { type: 'article_preview', prompt: 'Write the ULTIMATE MASTERS PREVIEW. This is the biggest tournament in golf and this article needs to match the moment. Cover: defending champion Rory McIlroy\'s back-to-back bid, Scottie Scheffler arriving with newborn, Tiger Woods absence (first since 1994), Phil Mickelson withdrawal, LIV players at Augusta, course breakdown of Augusta National, Amen Corner, favorites, dark horses, and your pick to win. ONLY include players confirmed in the field. 1000+ words. Make this a flagship article.' },
};

// Monday-Sunday schedule — generates multiple articles on key days
const DAILY_SCHEDULE = {
  0: ['masters_preview'], // Sunday before tournament
  1: ['power_rankings', 'storylines'], // Monday — rankings + narratives
  2: ['course_preview', 'field_breakdown'], // Tuesday — deep dives
  3: ['betting_preview'], // Wednesday — full betting guide
  4: [], // Thursday — tournament starts, covered by generate-content
  5: ['cut_line'], // Friday — cut line analysis
  6: [], // Saturday — covered by round recaps
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    const params = event.queryStringParameters || {};
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Allow forcing a specific content type via ?force=betting_preview
    let contentKeys = [];
    if (params.force && ALL_CONTENT[params.force]) {
      contentKeys = [params.force];
    } else {
      contentKeys = DAILY_SCHEDULE[dayOfWeek] || [];
    }

    if (!contentKeys.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No scheduled content for day ' + dayOfWeek }) };

    const results = [];
    for (const key of contentKeys) {
      const config = ALL_CONTENT[key];

    // Get tournament data for context
    // Always prioritize PGA Tour for blog content
    let tournaments = await sb('tournaments?select=*&tour_id=eq.pga&status=neq.scheduled&order=start_date.desc&limit=1');
    if (!tournaments.length) tournaments = await sb('tournaments?select=*&status=neq.scheduled&order=start_date.desc&limit=1');
    const tournament = tournaments[0];

    // Get upcoming tournament
    let upcoming = '';
    try {
      const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026');
      if (res.ok) {
        const data = await res.json();
        const next = (data.events || []).find(e => new Date(e.date) > new Date());
        if (next) upcoming = `Next event: ${next.shortName || next.name} at ${next.competitions?.[0]?.venue?.fullName || ''}`;
      }
    } catch(e) {}

    // Get leaderboard for context
    let leaderboard = '';
    if (tournament) {
      const lb = await sb(`leaderboard?tournament_id=eq.${tournament.id}&order=position.asc&limit=15&select=position,total_score,player_id,players(name)`);
      if (lb.length > 0) {
        leaderboard = 'Current standings:\n' + lb.map((r, i) => `${i+1}. ${r.players?.name || 'Unknown'} (${r.total_score})`).join('\n');
      }
    }

    // Check if we already generated this specific content type today
    const todayStr = today.toISOString().split('T')[0];
    const existing = await sb(`content_drafts?type=eq.${config.type}&source_event=eq.blog-scheduler-${key}&created_at=gte.${todayStr}T00:00:00`);
    if (existing.length > 0) {
      results.push({ skipped: key, reason: 'Already generated today' });
      continue;
    }

    // Fetch player facts for context
    let playerFacts = '';
    try {
      const pfRes = await fetch('https://yumahmnoltvbiadjefxw.supabase.co/rest/v1/player_facts?select=player_name,world_ranking,total_majors,masters_wins,masters_best,career_grand_slam,recent_notes&limit=30', {
        headers: { 'apikey': SUPABASE_KEY }
      });
      if (pfRes.ok) {
        const pf = await pfRes.json();
        playerFacts = '\n\nPLAYER FACTS — DO NOT CONTRADICT:\n' + pf.map(f => {
          let s = f.player_name + ': #' + (f.world_ranking||'?') + ', ' + f.total_majors + ' majors';
          if (f.masters_wins) s += ', ' + f.masters_wins + 'x Masters champ';
          if (f.career_grand_slam) s += ', Career Grand Slam';
          if (f.recent_notes) s += '. ' + f.recent_notes;
          return s;
        }).join('\n');
      }
    } catch(e) {}

    // Generate the article
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: require('./voice') + `

Year is 2026. Rory McIlroy WON the 2025 Masters. DEFENDING champion. Career Grand Slam holder.
300-500 words for previews/analysis. 400-700 for betting articles. Use <h3> for sections, <p> for paragraphs.
${playerFacts}`,
        messages: [{
          role: 'user',
          content: `${config.prompt}\n\nContext:\n${tournament ? `Recent tournament: ${tournament.name} at ${tournament.course}` : 'No recent tournament data.'}\n${leaderboard}\n${upcoming}\n\nReturn ONLY valid JSON:\n{"title":"headline","body":"full HTML article"}`
        }],
      }),
    });

    if (!res.ok) { results.push({ skipped: key, reason: 'AI failed' }); continue; }

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();
    let article;
    try {
      article = JSON.parse(text.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      const m = text.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
      if (m) article = JSON.parse(m[0]);
      else { results.push({ skipped: key, reason: 'Parse failed' }); continue; }
    }

    const hash = hashText(article.title + article.body.slice(0, 200));
    const existingHash = await sb(`content_hashes?hash=eq.${hash}`);
    if (existingHash.length > 0) { results.push({ skipped: key, reason: 'Duplicate' }); continue; }

    await sb('content_hashes', 'POST', { hash, type: config.type, source: 'blog-scheduler' });
    const tagMap = { 'article_analysis': 'ANALYSIS', 'article_preview': 'PREVIEW', 'article_betting': 'BETTING' };
    // Images added manually via admin editor — no auto-generation
    await sb('content_drafts', 'POST', {
      type: config.type,
      title: article.title,
      body: article.body,
      image_url: null,
      tournament_id: tournament?.id,
      source_event: 'blog-scheduler-' + key,
      content_hash: hash,
    });

    results.push({ success: true, key, type: config.type, title: article.title });
    } // end for loop

    // Send notification
    var generated = results.filter(function(r) { return r.success; });
    if (generated.length > 0) {
      try {
        await fetch('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'New Articles Ready', 'Priority': '3' },
          body: generated.length + ' new article' + (generated.length > 1 ? 's' : '') + ': ' + generated.map(function(r) { return r.title; }).join(' | '),
        });
      } catch(e) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
