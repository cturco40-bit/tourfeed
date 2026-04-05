// In-memory recap storage (resets on cold start, but recaps regenerate)
// For persistence, this would use Supabase or KV store
let latestRecap = null;

exports.setRecap = (recap) => { latestRecap = recap; };
exports.getRecap = () => latestRecap;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // POST = store a recap
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      latestRecap = {
        title: data.title || '',
        body: data.body || '',
        tournament: data.tournament || '',
        winner: data.winner || '',
        timestamp: Date.now(),
      };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch(e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
  }

  // GET = retrieve latest recap
  if (!latestRecap) {
    return { statusCode: 200, headers, body: JSON.stringify({ recap: null }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ recap: latestRecap }),
  };
};
