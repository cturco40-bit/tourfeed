// Post TourFeed picks to Reddit (r/golf, r/sportsbetting)
// Runs daily at 8am UTC or triggered manually after generate-picks

const SB_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

function fetchT(url, options, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms || 8000);
  return fetch(url, { ...options, signal: controller.signal })
    .then(function(res) { clearTimeout(timeout); return res; })
    .catch(function(e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') console.log('Fetch timed out:', url.slice(0, 120));
      throw e;
    });
}

async function sb(path, method, body) {
  var hdrs = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  var res = await fetchT(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET', headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!method || method === 'GET') { try { return await res.json(); } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

async function getRedditToken() {
  var clientId = process.env.REDDIT_CLIENT_ID;
  var clientSecret = process.env.REDDIT_CLIENT_SECRET;
  var username = process.env.REDDIT_USERNAME;
  var password = process.env.REDDIT_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) return null;

  var res = await fetchT('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TourFeed/1.0 by ' + username,
    },
    body: 'grant_type=password&username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password),
  });

  if (!res.ok) {
    console.log('Reddit auth failed:', res.status);
    return null;
  }
  var data = await res.json();
  return data.access_token || null;
}

async function postToSubreddit(token, subreddit, title, body) {
  var username = process.env.REDDIT_USERNAME;
  var res = await fetchT('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TourFeed/1.0 by ' + username,
    },
    body: 'sr=' + encodeURIComponent(subreddit) +
      '&kind=self' +
      '&title=' + encodeURIComponent(title) +
      '&text=' + encodeURIComponent(body) +
      '&api_type=json',
  });

  var data = await res.json();
  if (data.json?.errors?.length > 0) {
    console.log('Reddit post error for r/' + subreddit + ':', JSON.stringify(data.json.errors));
    return { success: false, error: data.json.errors };
  }
  var postUrl = data.json?.data?.url || null;
  console.log('Posted to r/' + subreddit + ':', postUrl);
  return { success: true, url: postUrl };
}

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    console.log('Starting post-reddit');

    // 1. Get current tournament
    var tournaments = await sb('tournaments?tour_id=eq.pga&order=start_date.desc&limit=1');
    var tournament = tournaments[0];
    if (!tournament) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No tournament found' }) };
    var tournamentId = tournament.id;
    var tournamentName = tournament.name || 'Golf Tournament';
    console.log('Tournament:', tournamentName);

    // 2. Check if we already posted for this tournament
    var subreddits = ['golf', 'sportsbetting'];
    var alreadyPosted = await sb('posted_reddit?tournament_id=eq.' + encodeURIComponent(tournamentId) + '&select=subreddit');
    var postedSubs = alreadyPosted.map(function(r) { return r.subreddit; });

    var subsToPost = subreddits.filter(function(s) { return postedSubs.indexOf(s) === -1; });
    if (subsToPost.length === 0) {
      console.log('Already posted to all subreddits for', tournamentName);
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Already posted for ' + tournamentName }) };
    }

    // 3. Fetch picks
    var picks = await sb('betting_picks?tournament_id=eq.' + encodeURIComponent(tournamentId) + '&order=created_at.desc');
    if (!picks.length) picks = await sb('betting_picks?order=created_at.desc&limit=10');
    if (!picks.length) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'No picks to post' }) };

    var bestBet = picks.find(function(p) { return p.edge_label === 'BEST BET'; });
    var valuePlays = picks.filter(function(p) { return p.edge_label === 'VALUE'; });
    var longshot = picks.find(function(p) { return p.edge_label === 'LONGSHOT'; });
    var fade = picks.find(function(p) { return p.edge_label === 'FADE'; });

    // 4. Format post
    var year = new Date().getFullYear();
    var title = tournamentName + ' ' + year + ' Betting Picks \u2014 Our Best Bets + Value Plays [TourFeed]';

    var body = 'We run a model that compares implied probability vs true probability to find edges. Here\'s what we like this week:\n\n';

    if (bestBet) {
      body += '**BEST BET:** ' + (bestBet.player_name || '') + ' ' + (bestBet.odds || '') + ' \u2014 ' + (bestBet.analysis || '') + '\n\n';
    }

    if (valuePlays.length > 0) {
      body += '**VALUE PLAYS:**\n\n';
      valuePlays.forEach(function(p) {
        body += '- ' + (p.player_name || '') + ' ' + (p.odds || '') + ' \u2014 ' + (p.analysis || '') + '\n';
      });
      body += '\n';
    }

    if (longshot) {
      body += '**LONGSHOT:** ' + (longshot.player_name || '') + ' ' + (longshot.odds || '') + ' \u2014 ' + (longshot.analysis || '') + '\n\n';
    }

    if (fade) {
      body += '**FADE:** ' + (fade.player_name || '') + ' ' + (fade.odds || '') + ' \u2014 ' + (fade.analysis || '') + '\n\n';
    }

    body += '---\n\nFull breakdown and reasoning at [tourfeed.co](https://tourfeed.co)\n\n';
    body += '*Picks generated from real sportsbook odds via The Odds API. All picks are for entertainment purposes only. Gamble responsibly.*';

    // 5. Authenticate with Reddit
    var token = await getRedditToken();
    if (!token) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Reddit auth failed — check REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD env vars' }) };
    }

    // 6. Post to each subreddit
    var results = [];
    for (var i = 0; i < subsToPost.length; i++) {
      var sub = subsToPost[i];
      try {
        var result = await postToSubreddit(token, sub, title, body);
        results.push({ subreddit: sub, ...result });

        if (result.success) {
          await sb('posted_reddit', 'POST', {
            tournament_id: tournamentId,
            subreddit: sub,
            post_url: result.url || '',
            posted_at: new Date().toISOString(),
          });
        }
      } catch(e) {
        console.log('Error posting to r/' + sub + ':', e.message);
        results.push({ subreddit: sub, success: false, error: e.message });
      }
    }

    // 7. Notify
    var posted = results.filter(function(r) { return r.success; });
    if (posted.length > 0) {
      try {
        await fetchT('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'Reddit Posts Live', 'Priority': '3' },
          body: 'Posted picks to ' + posted.map(function(r) { return 'r/' + r.subreddit; }).join(', ') + ' for ' + tournamentName,
        });
      } catch(e) {}
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, tournament: tournamentName, results: results }),
    };

  } catch(err) {
    console.log('post-reddit fatal error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
