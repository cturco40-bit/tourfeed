async function postTweet(text) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), image: 'https://tourfeed.co/og-image.png' }),
  });
  if (!res.ok) throw new Error(`post-tweet ${res.status}: ${await res.text()}`);
  return await res.json();
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    // Check all tours for completed events
    const tours = [
      { id: 'pga', sport: 'golf/pga', label: 'PGA Tour' },
      { id: 'lpga', sport: 'golf/lpga', label: 'LPGA' },
      { id: 'dpw', sport: 'golf/eur', label: 'DP World Tour' },
      { id: 'kft', sport: 'golf/kft', label: 'Korn Ferry Tour' },
      { id: 'champ', sport: 'golf/champ', label: 'Champions Tour' },
    ];

    for (const tour of tours) {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${tour.sport}/scoreboard`);
        if (!res.ok) continue;
        const data = await res.json();
        const evt = data.events?.[0];
        if (!evt) continue;

        const comp = evt.competitions?.[0];
        const status = comp?.status;
        const isFinal = status?.type?.name === 'STATUS_FINAL' || status?.type?.completed === true;
        if (!isFinal) continue;

        const tourneyName = evt.shortName || evt.name || 'Tournament';
        const course = comp?.venue?.fullName || '';
        const players = comp?.competitors || [];
        if (players.length === 0) continue;

        // Check if we already recapped this event (check recent tweets)
        const bearer = process.env.TWITTER_BEARER_TOKEN;
        if (bearer) {
          try {
            const uRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
              headers: { 'Authorization': `Bearer ${bearer}` },
            });
            if (uRes.ok) {
              const uData = await uRes.json();
              const userId = uData.data?.id;
              if (userId) {
                const tRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=text`, {
                  headers: { 'Authorization': `Bearer ${bearer}` },
                });
                if (tRes.ok) {
                  const tData = await tRes.json();
                  const alreadyRecapped = (tData.data || []).some(t =>
                    t.text.includes('FULL RECAP')
                  );
                  if (alreadyRecapped) continue;
                }
              }
            }
          } catch(e) {}
        }

        // Build leaderboard data for the recap
        const top10 = players.slice(0, 10).map(p => ({
          name: p.athlete?.displayName || '?',
          shortName: p.athlete?.shortName || '?',
          score: typeof p.score === 'string' ? p.score : '?',
          rounds: (p.linescores || []).map(l => l.value).filter(v => v && v > 50),
        }));

        const winner = top10[0];
        const runnerUp = top10[1];

        // Generate full recap article with Claude
        const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
        if (!ANTHROPIC_KEY) continue;

        const leaderboardText = top10.map((p, i) =>
          `${i + 1}. ${p.name} (${p.score})${p.rounds.length > 0 ? ' - Rounds: ' + p.rounds.join(', ') : ''}`
        ).join('\n');

        const articleRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2000,
            system: `You are a senior golf journalist writing an instant tournament recap for TourFeed. Write with authority and insight. Include round-by-round narrative, key moments, and what this means going forward (next tournament, rankings implications, etc).

Rules:
- 500-700 words
- Short punchy paragraphs (2-3 sentences max)
- Strong opening lede
- Include specific scores and round details from the data provided
- Mention the runner-up battle and notable performances
- Close with what's next (the upcoming tournament)
- Never mention AI, ESPN, or that this was generated
- Use <p> tags for paragraphs`,
            messages: [{
              role: 'user',
              content: `Write a tournament recap:\n\nTournament: ${tourneyName}\nCourse: ${course}\nTour: ${tour.label}\n\nFinal Leaderboard:\n${leaderboardText}\n\nReturn ONLY valid JSON:\n{"title":"recap headline","body":"full article with <p> tags","tweet":"a 200-char tweet summarizing the result with the winner's name"}`
            }],
          }),
        });

        if (!articleRes.ok) continue;

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
            else continue;
          } catch(e2) { continue; }
        }

        // Store the recap so the frontend can display it
        const slug = (article.title || tourneyName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        try {
          await fetch('https://tourfeed.co/.netlify/functions/get-recap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: article.title,
              body: article.body,
              tournament: tourneyName,
              winner: winner.name,
            }),
          });
        } catch(e) { console.warn('Recap store failed:', e.message); }

        // Tweet the recap with deep link to the article
        const recapUrl = `https://tourfeed.co/?recap=${slug}`;
        const tweetText = (article.tweet || `${winner.name} wins the ${tourneyName} at ${winner.score}`) +
          `\n\nFULL RECAP → ${recapUrl}\n\n#PGATour #Golf`;

        try {
          await postTweet(tweetText.slice(0, 280));
        } catch(e) { console.warn('Recap tweet failed:', e.message); }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            tournament: tourneyName,
            winner: winner.name,
            title: article.title,
            bodyLength: article.body?.length || 0,
          }),
        };

      } catch(tourErr) {
        console.warn(`Recap check failed for ${tour.id}:`, tourErr.message);
        continue;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No completed events needing recap' }) };

  } catch (err) {
    console.error('Auto-recap error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
