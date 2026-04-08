// ============================================
// TOURFEED — GENERATE CONTENT EDGE FUNCTION
// Triggered when a round completes
// Generates recap articles, betting insights, social posts
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const NTFY_TOPIC = Deno.env.get('NTFY_TOPIC') || 'tourfeed-alerts';
async function sendNotif(title, body, priority = 3) {
  try { await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, { method:'POST', headers:{'Title':title,'Priority':priority.toString()}, body }); } catch(e) {}
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ============================================
// GENERATE RECAP ARTICLE
// ============================================
async function generateRecap(tournament, leaderboard, round) {
  const top10 = leaderboard.slice(0, 10);
  const leaders = top10.map(p =>
    `${p.position} ${p.player_name} (${p.country_flag}) ${p.total_score} (Today: ${p.today_score})`
  ).join('\n');

  const prompt = `You are a professional golf journalist writing for TourFeed. Write a Round ${round} recap for ${tournament.name} at ${tournament.course}.

LEADERBOARD (Top 10):
${leaders}

Rules:
- Write a compelling headline
- Write 200-350 words
- Lead with the leader's round, not the full leaderboard
- Include specific details: key holes, momentum shifts, scoring conditions
- Mention 3-4 players beyond the leader
- Add context about what this means for the final rounds
- Confident insider voice, not generic sports writing
- Never mention AI or automation
- No markdown formatting

Respond in this format:
HEADLINE: [headline]
BODY: [article]
SUMMARY: [one sentence for social]`;

  const text = await callClaude(prompt);
  const headline = text.match(/HEADLINE:\s*(.+)/)?.[1]?.trim();
  const body = text.match(/BODY:\s*([\s\S]+?)(?=SUMMARY:)/)?.[1]?.trim();
  const summary = text.match(/SUMMARY:\s*(.+)/)?.[1]?.trim();

  if (!headline || !body) return null;

  const words = body.split(/\s+/).length;
  const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) + '-' + Date.now().toString(36);

  return { title: headline, body, summary, slug, read_time: Math.ceil(words / 200) + ' min' };
}

// ============================================
// GENERATE BETTING INSIGHTS
// ============================================
async function generateBettingInsights(tournament, leaderboard, round) {
  const top15 = leaderboard.slice(0, 15);
  const standings = top15.map(p =>
    `${p.position} ${p.player_name} ${p.total_score} (R${round}: ${p.today_score}, SG: ${p.sg_total || 'N/A'})`
  ).join('\n');

  const prompt = `You are a professional golf handicapper writing betting analysis for TourFeed. Generate betting insights for ${tournament.name} after Round ${round}.

CURRENT STANDINGS (Top 15):
${standings}

Generate:
1. OUTRIGHT WINNER analysis — top 3 value plays with realistic odds, implied vs model probability, and why
2. BEST BET — your single strongest pick with detailed reasoning. Query the betting_insights table for the current best bet. Include stats, course history, form, and matchup advantages
3. TWO PROP BETS — top 5 finish, head-to-head, top 10, etc. with analysis
4. If not the final round, include NEXT ROUND picks

Rules:
- Write like a real handicapper with real conviction
- Reference specific stats (SG, GIR, driving accuracy, etc.)
- Include confidence ratings 1-10
- Include unit sizing (1u conservative, 2u standard, 3u high confidence)
- Never mention AI
- No markdown

Respond in this format:
OUTRIGHT: [analysis of top 3 value plays]
BEST_BET: [your #1 pick with full analysis]
PROP1: [first prop/matchup bet]
PROP2: [second prop/matchup bet]`;

  const text = await callClaude(prompt);
  return text;
}

// ============================================
// GENERATE SOCIAL POSTS
// ============================================
async function generateSocialPosts(tournament, leaderboard, round, articleId) {
  const leader = leaderboard[0];
  const prompt = `Write 3 tweets for @TourFeedGolf about the Round ${round} recap at ${tournament.name}. Leader: ${leader.player_name} at ${leader.total_score}.

Tweet 1: Leaderboard summary (who's leading, by how much, key movers)
Tweet 2: Hot take or interesting angle
Tweet 3: Looking ahead to tomorrow

Rules: Under 280 chars each. Punchy. No hashtags. No emojis. Golf insider voice.

Format:
TWEET1: [text]
TWEET2: [text]
TWEET3: [text]`;

  const text = await callClaude(prompt);
  const tweets = [];
  for (let i = 1; i <= 3; i++) {
    const match = text.match(new RegExp(`TWEET${i}:\\s*(.+)`));
    if (match) tweets.push(match[1].trim());
  }

  for (const tweet of tweets) {
    await sb.from('social_posts').insert({
      tournament_id: tournament.id,
      article_id: articleId,
      platform: 'twitter',
      content: tweet,
      posted: false,
    });
  }

  return tweets.length;
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(async (req) => {
  const startTime = Date.now();

  try {
    const { tournament_id, round } = await req.json();

    // Get tournament info
    const { data: tournament } = await sb
      .from('tournaments')
      .select('*')
      .eq('id', tournament_id)
      .single();

    if (!tournament) {
      return new Response(JSON.stringify({ error: 'Tournament not found' }), { status: 404 });
    }

    // Get leaderboard
    const { data: leaderboard } = await sb
      .from('v_leaderboard')
      .select('*')
      .eq('tournament_id', tournament_id)
      .order('position_num', { ascending: true });

    if (!leaderboard || leaderboard.length === 0) {
      return new Response(JSON.stringify({ error: 'No leaderboard data' }), { status: 404 });
    }

    // Check tour tier — only generate full content for tier 1-2
    const { data: tour } = await sb.from('tours').select('tier').eq('id', tournament.tour_id).single();
    const tier = tour?.tier || 3;

    let recapId = null;

    // Generate recap (tier 1-2)
    if (tier <= 2) {
      const recap = await generateRecap(tournament, leaderboard, round);
      if (recap) {
        const { data: inserted } = await sb.from('articles').insert({
          tournament_id: tournament_id,
          tour_id: tournament.tour_id,
          type: 'recap',
          title: recap.title,
          body: recap.body,
          summary: recap.summary,
          tag: 'RECAP',
          read_time: recap.read_time,
          slug: recap.slug,
          published: true,
          published_at: new Date().toISOString(),
        }).select().single();

        recapId = inserted?.id;
        await sendNotif('⛳ Recap Published', `${recap.title}\n\n${tournament.name} Round ${round}`);
      }
    }

    // Generate betting insights (tier 1 only)
    if (tier === 1) {
      const insights = await generateBettingInsights(tournament, leaderboard, round);
      if (insights) {
        // Store raw insights as an article
        const slug = `betting-${tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-r${round}-${Date.now().toString(36)}`;
        await sb.from('articles').insert({
          tournament_id: tournament_id,
          tour_id: tournament.tour_id,
          type: 'analysis',
          title: `${tournament.name} R${round} Betting Insights`,
          body: insights,
          tag: 'BETTING',
          read_time: '3 min',
          slug: slug,
          published: true,
          published_at: new Date().toISOString(),
        });
      }
    }

    // Generate social posts (tier 1-2)
    if (tier <= 2) {
      await generateSocialPosts(tournament, leaderboard, round, recapId);

      // Trigger content queue — generates Reddit, Instagram, newsletter
      if (recapId) {
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/content-queue`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ article_id: recapId, tournament_id }),
          });
        } catch (e) {
          console.error('Content queue trigger failed:', e.message);
        }
      }
    }

    await sb.from('sync_log').insert({
      sync_type: 'content_generation',
      tournament_id: tournament_id,
      status: 'success',
      duration_ms: Date.now() - startTime,
    });

    return new Response(JSON.stringify({
      success: true,
      tournament: tournament.name,
      round: round,
      duration_ms: Date.now() - startTime,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Content generation error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
