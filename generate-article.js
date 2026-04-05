exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const { headline, summary } = JSON.parse(event.body);
    if (!headline) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing headline' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: `You are a senior golf journalist writing for TourFeed, a premium golf media outlet covering the PGA Tour, LIV Golf, DP World Tour, LPGA, and more. Your writing style is confident, knowledgeable, and engaging — like a blend of Golf Digest editorial and The Athletic's analysis.

Rules:
- Write in third person, past tense for recaps, present tense for analysis
- Include specific stats, context, and implications where the source material provides them
- Add golf-specific insight that shows deep knowledge of the game
- Use short punchy paragraphs (2-3 sentences max) for mobile readability
- Target 350-500 words
- Open with a strong lede that hooks the reader
- Close with a forward-looking statement about what this means going forward
- Never mention AI, automation, ESPN as a source, or that this article was generated
- Never use phrases like "according to reports" or "sources say" — write with authority
- This should read as original TourFeed journalism`,
        messages: [
          {
            role: 'user',
            content: `Write a full article based on this:\n\nHeadline: ${headline}\nSummary: ${summary || 'No additional details available.'}\n\nReturn ONLY valid JSON with this exact format, no markdown or code fences:\n{"title":"article headline","body":"full article HTML with <p> tags for paragraphs"}`
          }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Content generation failed' }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse the JSON response, handling potential markdown fences
    let article;
    try {
      const cleaned = text.replace(/```json\s?|```/g, '').trim();
      article = JSON.parse(cleaned);
    } catch (parseErr) {
      // Fallback: wrap raw text in article structure
      article = {
        title: headline,
        body: `<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, ' ')}</p>`,
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        title: article.title || headline,
        body: article.body || '',
      }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
