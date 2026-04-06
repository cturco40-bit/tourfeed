// Generate original tweets from FRESH news headlines
// Every run pulls latest ESPN + RSS headlines and creates new takes

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No API key' }) };

  try {
    // Pull fresh headlines from ESPN
    const headlines = [];
    try {
      const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=15');
      if (res.ok) {
        const data = await res.json();
        (data.articles || []).forEach(a => {
          if (a.headline) headlines.push(a.headline);
        });
      }
    } catch(e) {}

    // Also get current tournament context
    let context = '';
    try {
      const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
      if (res.ok) {
        const d = await res.json();
        const evt = d.events?.[0];
        if (evt) {
          const comp = evt.competitions?.[0];
          const top5 = (comp?.competitors || []).slice(0, 5);
          context = `Current: ${evt.shortName || evt.name}. Status: ${comp?.status?.type?.description}. `;
          if (top5.length > 0) context += 'Top 5: ' + top5.map(p => `${p.athlete?.displayName} (${p.score})`).join(', ');
        }
      }
    } catch(e) {}

    // Also check what we've already drafted/posted to avoid repeats
    let recentTexts = [];
    try {
      const dRes = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet');
      if (dRes.ok) {
        const dData = await dRes.json();
        recentTexts = (dData.drafts || []).map(d => d.text.toLowerCase());
      }
    } catch(e) {}

    if (headlines.length === 0 && !context) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No headlines found' }) };
    }

    const headlineList = headlines.slice(0, 10).map((h, i) => `${i+1}. ${h}`).join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `You generate original tweets. You're given fresh golf headlines — write ORIGINAL tweets reacting to them or inspired by them. Each tweet should be about a DIFFERENT headline/topic.

BRAND VOICE:
You're a golf fan in a group chat, not a journalist. Like Foreplay meets a sharp handicapper.

IMPORTANT FACTS:
- Rory McIlroy is the DEFENDING Masters champion (won 2025), career Grand Slam holder
- It is 2026
- Do NOT state specific stats/records you're unsure about

RULES:
- ZERO emojis. ZERO hashtags. No exceptions.
- NEVER link to anything or mention TourFeed
- Each tweet about a DIFFERENT topic/headline — no repeats
- 1-2 sentences max. Short and punchy.
- Slang is fine. "Built different." "That's filthy." "Ice in his veins."
- Never use "incredible", "amazing", "unbelievable"
- Be opinionated. Take stances. Be funny when it fits.
- Mix: hot takes, reactions, picks, observations, questions

GOOD: "Scheffler just hit a 4-iron to 3 feet on 12. That hole has ended careers and he's out here playing target practice."
GOOD: "McIlroy three back going into Sunday. We've seen this movie before."
GOOD: "Rahm at +2000 is free money and I don't care who knows it."
BAD: "What an incredible day at Augusta National! The Masters never disappoints!"

${context}`,
        messages: [{
          role: 'user',
          content: `Here are the latest golf headlines:\n\n${headlineList}\n\nWrite 5 original tweets — each one about a DIFFERENT headline. Different style for each.\n\nReturn ONLY a JSON array:\n["tweet 1","tweet 2","tweet 3","tweet 4","tweet 5"]`
        }],
      }),
    });

    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'AI failed' }) };

    const aiData = await res.json();
    const text = (aiData.content?.[0]?.text || '').trim();

    let tweets;
    try {
      tweets = JSON.parse(text.replace(/```json\s?|```/g, '').trim());
    } catch(e) {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) tweets = JSON.parse(match[0]);
      else return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) };
    }

    if (!Array.isArray(tweets)) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Not an array' }) };

    // Filter and draft
    const drafted = [];
    for (const tweet of tweets) {
      if (!tweet || tweet.length < 15) continue;
      if (/don't have|can't see|I cannot/i.test(tweet)) continue;
      // Check against recent drafts for similarity
      const tweetLower = tweet.toLowerCase();
      const words = tweetLower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      let isDupe = false;
      for (const recent of recentTexts) {
        const overlap = words.filter(w => recent.includes(w)).length;
        if (overlap >= words.length * 0.5) { isDupe = true; break; }
      }
      if (isDupe) continue;

      const result = await postDraft(tweet, 'generate-original');
      if (result?.success) {
        drafted.push(tweet);
        recentTexts.push(tweetLower); // Track for next iteration
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, drafted: drafted.length, tweets: drafted }) };

  } catch (err) {
    console.error('Generate tweets error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
