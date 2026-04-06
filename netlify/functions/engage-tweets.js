// TourFeed Engagement Engine
// Finds PGA Tour highlight clips, trending golf content, and quote tweets
// with hot takes to drive engagement and followers

async function postDraft(text, source) {
  const res = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280), source: source || 'engage' }),
  });
  if (!res.ok) throw new Error(`draft ${res.status}`);
  return await res.json();
}

// Generate a hot take using Claude
async function generateTake(tweetText, authorName, context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: `You write quote tweets for TourFeed (@TourFeedGolf), a golf media brand with personality. Think Foreplay/Barstool meets Golf Digest — knowledgeable but fun, not corporate.

Style:
- Short and punchy — 1-2 sentences MAX
- Have an OPINION. Take a side. Be bold but respectful
- React like a fan who really knows golf — stats, history, context
- Use golf slang naturally (Sunday red, moving day, amen corner, etc.)
- Emojis sparingly — max 1-2
- Ask questions that drive replies ("Am I wrong?" "Who says no?")
- Reference specific stats or history when relevant
- Sound like a person, not a brand
- NEVER mention AI or automation
- Do NOT state specific major counts, win totals, or career records — just react to the tweet's content
- Rory McIlroy is the DEFENDING Masters champion (won 2025). He has completed the career Grand Slam
- Keep it under 180 characters to leave room for the quote tweet URL

${context ? 'Context: ' + context : ''}`,
        messages: [{
          role: 'user',
          content: `Write a quote tweet reaction to this from @${authorName}:\n\n"${tweetText}"\n\nReturn ONLY the quote tweet text.`
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
  } catch (e) { return null; }
}

// Target accounts — prioritized by engagement value
const HIGHLIGHT_ACCOUNTS = [
  'PGATour', 'TheMasters', 'LiveOnThePGA',
];
const GOLF_MEDIA = [
  'GolfDigest', 'NoLayingUp', 'GolfChannel', 'SkratchTV',
  'GolfWeek', 'NUCLRGOLF', 'foreaborik',
];
const PLAYERS = [
  'McIlroyRory', 'JustinThomas34', 'JordanSpieth',
  'TigerWoods', 'RickieFowler', 'MaxHoma',
  'BKoepka', 'camaborik', 'ABORIK',
];

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No bearer token' }) };

  try {
    // Collect tweet IDs already posted or in drafts — never re-draft these
    const usedIds = new Set();
    try {
      const uRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
        headers: { 'Authorization': `Bearer ${bearer}` },
      });
      if (uRes.ok) {
        const userId = (await uRes.json()).data?.id;
        if (userId) {
          const tRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=20&tweet.fields=text`, {
            headers: { 'Authorization': `Bearer ${bearer}` },
          });
          if (tRes.ok) (await tRes.json()).data?.forEach(t => {
            const m = t.text.match(/twitter\.com\/\w+\/status\/(\d+)/);
            if (m) usedIds.add(m[1]);
          });
        }
      }
    } catch(e) {}
    try {
      const dRes = await fetch('https://tourfeed.co/.netlify/functions/draft-tweet');
      if (dRes.ok) {
        const dData = await dRes.json();
        // Add current draft tweet IDs
        (dData.drafts || []).forEach(d => {
          const m = d.text.match(/twitter\.com\/\w+\/status\/(\d+)/);
          if (m) usedIds.add(m[1]);
        });
        // Add rejected tweet IDs
        (dData.rejectedIds || []).forEach(id => usedIds.add(id));
      }
    } catch(e) {}

    const results = [];

    // Strategy 1: PGA Tour / Masters highlight clips
    const highlightQuery = HIGHLIGHT_ACCOUNTS.map(a => `from:${a}`).join(' OR ');
    const h = await tryQuoteTweet(bearer, `(${highlightQuery}) has:videos -is:retweet`, 'highlight', usedIds);
    if (h) results.push(h);

    // Strategy 2: Trending Masters/golf content with video
    const t = await tryQuoteTweet(bearer, `(#TheMasters OR #Masters OR "the masters" OR "augusta") has:videos -is:retweet min_faves:10`, 'trending_masters', usedIds);
    if (t) results.push(t);

    // Strategy 3: Golf media reactions
    const mediaQuery = GOLF_MEDIA.map(a => `from:${a}`).join(' OR ');
    const m = await tryQuoteTweet(bearer, `(${mediaQuery}) -is:retweet -is:reply`, 'media_react', usedIds);
    if (m) results.push(m);

    // Strategy 4: Player tweets
    const playerQuery = PLAYERS.slice(0, 5).map(a => `from:${a}`).join(' OR ');
    const p = await tryQuoteTweet(bearer, `(${playerQuery}) -is:retweet -is:reply`, 'player_react', usedIds);
    if (p) results.push(p);

    // Strategy 5: Trending golf conversations
    const g = await tryQuoteTweet(bearer, `(#PGATour OR #LIVGolf OR #Golf) has:videos -is:retweet min_faves:20`, 'trending', usedIds);
    if (g) results.push(g);

    if (results.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No suitable content found' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ drafted: results.length, results }) };

  } catch (err) {
    console.error('Engage error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function tryQuoteTweet(bearer, query, strategy, usedIds) {
  try {
    const searchUrl = new URL('https://api.twitter.com/2/tweets/search/recent');
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('max_results', '10');
    searchUrl.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    searchUrl.searchParams.set('expansions', 'author_id');
    searchUrl.searchParams.set('user.fields', 'username');

    const res = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const tweets = data.data || [];
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    // Sort by engagement — skip used, link-only, and low-engagement tweets
    const sorted = tweets
      .filter(t => {
        if (usedIds && usedIds.has(t.id)) return false; // Already drafted or posted
        if ((t.public_metrics?.like_count || 0) < 3) return false;
        const textOnly = (t.text || '').replace(/https?:\/\/\S+/g, '').trim();
        if (textOnly.length < 10) return false;
        return true;
      })
      .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0));

    // Get current tournament context for smarter takes
    let context = '';
    try {
      const espnRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
      if (espnRes.ok) {
        const espnData = await espnRes.json();
        const evt = espnData.events?.[0];
        if (evt) {
          const comp = evt.competitions?.[0];
          const leader = comp?.competitors?.[0];
          context = `Current: ${evt.shortName || evt.name}. Leader: ${leader?.athlete?.displayName} (${leader?.score}). Status: ${comp?.status?.type?.description}`;
        }
      }
    } catch(e) {}

    // Try each candidate
    for (const target of sorted.slice(0, 5)) {
      const author = users[target.author_id];
      const authorName = author?.username || 'unknown';

      const take = await generateTake(target.text, authorName, context);
      if (!take) continue;
      // Skip broken AI responses
      if (/don't have access|can't see|can't view|unable to|I cannot|provide more context/i.test(take)) continue;

      // Send to draft queue (not post directly)
      try {
        if (usedIds) usedIds.add(target.id); // Mark as used for this run
        const result = await postDraft(take + '\n\nhttps://twitter.com/' + authorName + '/status/' + target.id, 'engage-' + strategy);
        return {
          success: true,
          strategy,
          target: `@${authorName}: ${target.text.slice(0, 80)}`,
          take,
          draft_id: result.id,
        };
      } catch (e) {
        continue;
      }
    }
  } catch(e) {}
  return null;
}
