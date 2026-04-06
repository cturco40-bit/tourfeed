// Auto-generate preview/prediction articles for upcoming tournaments
// Runs on cron — creates picks articles and drafts tweets about them

async function postDraft(text, source) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source }),
  });
  return res.ok ? await res.json() : null;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    // Find the next upcoming event
    const schedRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026');
    if (!schedRes.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Schedule fetch failed' }) };
    const schedData = await schedRes.json();

    const now = Date.now();
    const upcoming = (schedData.events || [])
      .filter(e => {
        const start = new Date(e.date).getTime();
        // Only events starting in the next 7 days
        return start > now && start < now + 7 * 86400000;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (upcoming.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No events in next 7 days' }) };
    }

    const event = upcoming[0];
    const name = event.shortName || event.name || 'Tournament';
    const course = event.competitions?.[0]?.venue?.fullName || '';
    const startDate = new Date(event.date);
    const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const isMajor = /masters|pga championship|u\.?s\.?\s*open|open championship/i.test(name);

    // Check if we already generated a preview (check get-recap for stored preview)
    try {
      const checkRes = await fetch('https://tourfeed.co/.netlify/functions/get-recap');
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.recap?.tournament === name && checkData.recap?.title?.toLowerCase().includes('preview')) {
          return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Preview already generated for ' + name }) };
        }
      }
    } catch(e) {}

    // Get recent form data — who's been playing well
    let recentForm = '';
    try {
      const lbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
      if (lbRes.ok) {
        const lbData = await lbRes.json();
        const lastEvent = lbData.events?.[0];
        if (lastEvent) {
          const comp = lastEvent.competitions?.[0];
          const top10 = (comp?.competitors || []).slice(0, 10);
          recentForm = 'Recent results from ' + (lastEvent.shortName || lastEvent.name) + ':\n' +
            top10.map((p, i) => `${i+1}. ${p.athlete?.displayName} (${p.score})`).join('\n');
        }
      }
    } catch(e) {}

    // Generate the preview article
    const articleRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        system: `You are a senior golf analyst writing tournament preview articles for TourFeed. Write with authority and insight. Your predictions should be specific and bold — not generic.

IMPORTANT FACTS:
- Rory McIlroy is the DEFENDING Masters champion (won 2025) and career Grand Slam holder
- It is currently 2026
- Do NOT invent specific stats or records you're unsure about

Rules:
- 600-900 words
- Short punchy paragraphs (2-3 sentences max)
- Include these sections with <h3> tags:
  1. Tournament Overview (course, history, what to expect)
  2. OUTRIGHT WINNER pick (one player, with reasoning)
  3. TOP 5 FINISH picks (3 players)
  4. TOP 10 FINISH picks (3 players)
  5. LONGSHOT pick (one player at high odds)
  6. FADE pick (one popular player to avoid, with reasoning)
  7. Key storylines to watch
- Use <p> tags for paragraphs
- Be specific about WHY each pick fits the course/event
- Reference recent form when the data is provided
- Never mention AI or that this was generated
- This should read as premium golf analysis`,
        messages: [{
          role: 'user',
          content: `Write a tournament preview and picks article:

Tournament: ${name}
Course: ${course}
Date: ${dateStr}
Major: ${isMajor ? 'Yes' : 'No'}

${recentForm}

Return ONLY valid JSON:
{"title":"preview headline","body":"full HTML article with <h3> and <p> tags","tweet":"a 200-char tweet promoting this preview with picks teaser"}`
        }],
      }),
    });

    if (!articleRes.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Article generation failed' }) };

    const articleData = await articleRes.json();
    const text = articleData.content?.[0]?.text || '';

    let article;
    try {
      const cleaned = text.replace(/```json\s?|```/g, '').trim();
      article = JSON.parse(cleaned);
    } catch(e) {
      try {
        const m = text.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
        if (m) article = JSON.parse(m[0]);
        else return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) };
      } catch(e2) { return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) }; }
    }

    // Store as the latest recap/preview
    try {
      await fetch('https://tourfeed.co/.netlify/functions/get-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          body: article.body,
          tournament: name,
          winner: 'Preview',
        }),
      });
    } catch(e) {}

    // Draft a tweet promoting the preview
    if (article.tweet) {
      const slug = (article.title || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      await postDraft(
        article.tweet + '\n\nFull preview → https://tourfeed.co/?recap=' + slug + '\n\n' + (isMajor ? '#TheMasters' : '#PGATour') + ' #Golf',
        'auto-preview'
      );
    }

    // Draft picks tweet
    const picksMatch = article.body?.match(/OUTRIGHT WINNER[^<]*<\/h3>\s*<p>([^<]+)/i);
    if (picksMatch) {
      await postDraft(
        name + ' Picks\n\n' + picksMatch[1].slice(0, 150) + '\n\nFull breakdown → https://tourfeed.co/?recap=' + (article.title || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '\n\n#PGATour #Golf',
        'auto-preview-picks'
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tournament: name,
        title: article.title,
        bodyLength: article.body?.length || 0,
      }),
    };

  } catch (err) {
    console.error('Auto-preview error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
