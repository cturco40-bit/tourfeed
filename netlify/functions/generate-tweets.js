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
      '#TheMasters OR #Masters OR "the masters" OR "augusta national"',
      '#PGATour OR "pga tour"',
      '"golf" (scheffler OR rory OR mcilroy OR tiger OR spieth OR rahm OR koepka)',
      '#LIVGolf OR "liv golf"',
    ];

    let trendingTopics = [];
    for (const q of searches) {
      try {
        const url = new URL('https://api.twitter.com/2/tweets/search/recent');
        url.searchParams.set('query', q + ' -is:retweet lang:en');
        url.searchParams.set('max_results', '10');
        url.searchParams.set('tweet.fields', 'public_metrics,created_at');
        const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${bearer}` } });
        if (!res.ok) continue;
        const data = await res.json();
        (data.data || [])
          .filter(t => (t.public_metrics?.like_count || 0) >= 5)
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
        system: `You generate original tweets for TourFeed (@TourFeedGolf), a golf media brand. You're given trending golf topics — write ORIGINAL tweets inspired by them. NOT reactions to specific tweets. Your own takes.

Voice: Foreplay meets Golf Digest. Knowledgeable, fun, opinionated. Like a smart golf buddy.

IMPORTANT FACTS:
- Rory McIlroy is the DEFENDING Masters champion (won 2025), career Grand Slam holder
- It is 2026
- Do NOT state specific stats/records you're unsure about

Tweet types to mix:
- Hot take ("Scheffler at +400 is disrespectful. The man doesn't lose at Augusta.")
- Engagement bait ("Your Masters pick — who's wearing green Sunday? Reply below")
- Storyline ("Rory defending at Augusta as a father. Different energy this year.")
- Stats/facts ("Only 3 players have gone back-to-back at the Masters. Rory's chasing history.")
- Hype ("72 hours until the greatest week in golf. Who else can't sleep?")
- Picks ("My outright: Scheffler. My top 5 sleeper: Morikawa. My longshot: MacIntyre. Lock it in.")
- Controversial ("Hot take: LIV players missing the Masters makes it BETTER. Fight me.")

Rules:
- Each tweet under 260 chars (leave room for hashtags)
- 1-2 hashtags per tweet MAX (#TheMasters #PGATour #Golf etc.)
- Emojis sparingly — 0-2 per tweet
- No AI mentions ever
- Each tweet is DIFFERENT — different style, different angle
- Sound human, not corporate

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
