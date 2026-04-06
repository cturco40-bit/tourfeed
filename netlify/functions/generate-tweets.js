// Generate original standalone tweets based on what's trending in golf
// Not quote tweets — original TourFeed content that rides trending topics

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
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!bearer || !apiKey) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Missing keys' }) };

  try {
    // 1. Find what's trending in golf right now
    const searches = [
      'masters golf',
      'pga tour golf',
      'scheffler OR mcilroy OR rory OR tiger woods',
      'liv golf OR augusta OR "green jacket"',
    ];

    let trendingTopics = [];
    for (const q of searches) {
      try {
        const url = new URL('https://api.twitter.com/2/tweets/search/recent');
        url.searchParams.set('query', q + ' -is:retweet lang:en');
        url.searchParams.set('max_results', '10');
        // Only last 2 hours for freshness
        url.searchParams.set('start_time', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
        url.searchParams.set('tweet.fields', 'public_metrics,created_at');
        const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${bearer}` } });
        if (!res.ok) continue;
        const data = await res.json();
        (data.data || [])
          .filter(t => (t.public_metrics?.like_count || 0) >= 1)
          .forEach(t => {
            const text = (t.text || '').replace(/https?:\/\/\S+/g, '').trim();
            if (text.length > 20) trendingTopics.push(text);
          });
      } catch(e) {}
    }

    if (trendingTopics.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No trending topics found' }) };
    }

    // 2. Get current tournament context
    let context = '';
    try {
      const espnRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
      if (espnRes.ok) {
        const d = await espnRes.json();
        const evt = d.events?.[0];
        if (evt) {
          const comp = evt.competitions?.[0];
          const top3 = (comp?.competitors || []).slice(0, 3);
          context = `Current event: ${evt.shortName || evt.name}. Status: ${comp?.status?.type?.description}. `;
          if (top3.length > 0) context += 'Top 3: ' + top3.map(p => `${p.athlete?.displayName} (${p.score})`).join(', ') + '. ';
        }
      }
    } catch(e) {}

    // 3. Generate 5 original tweets based on what people are talking about
    const topicSample = trendingTopics.slice(0, 15).map((t, i) => `${i+1}. "${t.slice(0, 150)}"`).join('\n');

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
        system: `You generate original tweets. You're given trending golf topics — write ORIGINAL tweets inspired by them.

BRAND VOICE:
You're a golf fan in a group chat, not a journalist. Mix serious takes with funny ones. Like Foreplay meets a sharp handicapper. You talk like you're watching the tournament with the boys.

IMPORTANT FACTS:
- Rory McIlroy is the DEFENDING Masters champion (won 2025), career Grand Slam holder
- It is 2026
- Do NOT state specific stats/records you're unsure about

VOICE RULES:
- Sound like a golf fan in a group chat, not a journalist
- Short. 1-2 sentences. Sometimes just a few words.
- ZERO emojis. ZERO hashtags. No exceptions.
- NEVER link to anything or mention TourFeed by name
- Contractions always. Slang is fine. "Built different." "That's filthy." "Ice in his veins."
- Reference specific shots, holes, moments when possible
- Okay to be funny: "Somebody check on the Phil Mickelson bettors."
- Okay to be blunt: "Tiger at +5. Painful to watch."
- Okay to crown someone: "Scheffler is the best golfer on the planet and it's not close."
- Okay to troll: "LIV guys watching this Masters leaderboard like they made a huge mistake."
- Never use "incredible", "amazing", "unbelievable"

GOOD EXAMPLES:
"Scheffler just hit a 4-iron to 3 feet on 12. That hole has ended careers and he's out here playing target practice."
"McIlroy three back going into Sunday. We've seen this movie before."
"Rahm at +2000 is free money and I don't care who knows it."
"Hovland birdied four of his last six and nobody's talking about it. Dangerous."

BAD EXAMPLES (never write like this):
"What an incredible day at Augusta National! The Masters never disappoints!"
"Congrats to the leader on an amazing round! #Masters2026 ⛳"

${context}`,
        messages: [{
          role: 'user',
          content: `Here's what golf Twitter is talking about right now:\n\n${topicSample}\n\nWrite 5 original standalone tweets inspired by these trending topics. Different style for each.\n\nReturn ONLY a JSON array of strings:\n["tweet 1","tweet 2","tweet 3","tweet 4","tweet 5"]`
        }],
      }),
    });

    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'AI generation failed' }) };

    const aiData = await res.json();
    const text = (aiData.content?.[0]?.text || '').trim();

    let tweets;
    try {
      const cleaned = text.replace(/```json\s?|```/g, '').trim();
      tweets = JSON.parse(cleaned);
    } catch(e) {
      // Try to extract array
      const match = text.match(/\[[\s\S]*\]/);
      if (match) tweets = JSON.parse(match[0]);
      else return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Parse failed' }) };
    }

    if (!Array.isArray(tweets) || tweets.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No tweets generated' }) };
    }

    // 4. Draft all of them
    const drafted = [];
    for (const tweet of tweets) {
      if (!tweet || tweet.length < 10) continue;
      // Filter out bad ones
      if (/don't have|can't see|I cannot/i.test(tweet)) continue;
      const result = await postDraft(tweet, 'generate-original');
      if (result?.success) drafted.push(tweet);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, drafted: drafted.length, tweets: drafted }),
    };

  } catch (err) {
    console.error('Generate tweets error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
