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

const CONTENT_TYPES = {
  0: null, // Sunday — handled by auto-recap
  1: { type: 'article_analysis', prompt: 'Write a POWER RANKINGS article ranking the top 15 golfers heading into this week. Include recent form, stats, and why each player is ranked where they are.' },
  2: { type: 'article_preview', prompt: 'Write a COURSE PREVIEW for this week\'s tournament. Cover course layout, key holes, what type of player the course rewards, weather expectations, and past champions.' },
  3: { type: 'article_betting', prompt: 'Write a comprehensive BETTING PREVIEW. Include: outright winner picks (3), top 5 picks (3), top 10 picks (3), first round leader (2), head-to-head matchups (3), longshot pick, and a parlay suggestion. Include odds, confidence ratings, and detailed reasoning for each.' },
  4: null, // Thursday — tournament starts
  5: { type: 'article_betting', prompt: 'Write a CUT LINE ANALYSIS. Who\'s on the bubble? Which bubble players are worth betting on for the weekend? Include specific players, their scores, projected cut line, and weekend outright odds for players who make the cut.' },
  6: null, // Saturday — covered by round recaps
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const config = CONTENT_TYPES[dayOfWeek];

    if (!config) return { statusCode: 200, headers, body: JSON.stringify({ skipped: `No scheduled content for day ${dayOfWeek}` }) };

    // Get tournament data for context
    const tournaments = await sb('tournaments?select=*&status=neq.scheduled&order=start_date.desc&limit=1');
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

    // Check if we already generated today's content
    const todayStr = today.toISOString().split('T')[0];
    const existing = await sb(`content_drafts?type=eq.${config.type}&created_at=gte.${todayStr}T00:00:00`);
    if (existing.length > 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: `Already generated ${config.type} today` }) };
    }

    // Generate the article
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: `You are a senior golf analyst writing for TourFeed. Your content is original, data-driven, and written with authority. Clickbait-style headlines that make people click. Short punchy paragraphs.

FACTS: Rory McIlroy is defending Masters champion (won 2025). It is 2026. Don't invent specific stats you're unsure about.

Rules:
- 500-800 words
- Use <h3> for section headers, <p> for paragraphs
- Clickbait headline
- Never mention AI
- Include specific player names and analysis`,
        messages: [{
          role: 'user',
          content: `${config.prompt}\n\nContext:\n${tournament ? `Recent tournament: ${tournament.name} at ${tournament.course}` : 'No recent tournament data.'}\n${leaderboard}\n${upcoming}\n\nReturn ONLY valid JSON:\n{"title":"headline","body":"full HTML article"}`
        }],
      }),
    });

    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'AI generation failed' }) };

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();
    let article;
    try {
      article = JSON.parse(text.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      const m = text.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
      if (m) article = JSON.parse(m[0]);
      else return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) };
    }

    const hash = hashText(article.title + article.body.slice(0, 200));
    const existingHash = await sb(`content_hashes?hash=eq.${hash}`);
    if (existingHash.length > 0) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Duplicate hash' }) };

    await sb('content_hashes', 'POST', { hash, type: config.type, source: 'blog-scheduler' });
    const tagMap = { 'article_analysis': 'ANALYSIS', 'article_preview': 'PREVIEW', 'article_betting': 'BETTING' };
    const imgTag = tagMap[config.type] || 'NEWS';
    const imageUrl = `https://tourfeed.co/.netlify/functions/generate-image?type=headline&tag=${imgTag}&headline=${encodeURIComponent(article.title)}`;
    await sb('content_drafts', 'POST', {
      type: config.type,
      title: article.title,
      body: article.body,
      image_url: imageUrl,
      tournament_id: tournament?.id,
      source_event: 'blog-scheduler',
      content_hash: hash,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, type: config.type, title: article.title }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
