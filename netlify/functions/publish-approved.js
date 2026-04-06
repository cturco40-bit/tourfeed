// Publish approved drafts — check every 5 min via cron
// Tweets → post via Twitter API
// Articles → insert into articles table

const SUPABASE_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

async function sb(path, method, body) {
  const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (method === 'POST') hdrs['Prefer'] = 'return=representation';
  if (method === 'PATCH') hdrs['Prefer'] = 'return=minimal';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: method || 'GET', headers: hdrs, body: body ? JSON.stringify(body) : undefined });
  if (!method || method === 'GET') { try { const d = await res.json(); return Array.isArray(d) ? d : []; } catch(e) { return []; } }
  if (method === 'POST' && res.ok) { try { return await res.json(); } catch(e) { return []; } }
  return res.ok;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    // Auto-expire stale drafts (6h for tweets, 48h for articles/blogs)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    // Expire old tweet drafts
    await sb('content_drafts?status=eq.pending&type=like.tweet*&created_at=lt.' + sixHoursAgo, 'PATCH', { status: 'expired' });
    // Expire old article drafts
    await sb('content_drafts?status=eq.pending&type=like.article*&created_at=lt.' + twoDaysAgo, 'PATCH', { status: 'expired' });

    // Get all approved drafts
    const approved = await sb('content_drafts?status=eq.approved&order=created_at.asc&limit=10');

    if (approved.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ published: 0, message: 'No approved drafts' }) };
    }

    const results = [];

    for (const draft of approved) {
      try {
        // Tweet types → post to Twitter
        if (draft.type?.startsWith('tweet')) {
          const tweetRes = await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: draft.body.slice(0, 280),
              image: draft.image_url || undefined,
            }),
          });
          const tweetData = await tweetRes.json();

          if (tweetData.success) {
            await sb(`content_drafts?id=eq.${draft.id}`, 'PATCH', {
              status: 'published',
              published_at: new Date().toISOString(),
              meta: { ...draft.meta, tweet_id: tweetData.tweet_id },
            });
            results.push({ id: draft.id, type: draft.type, status: 'published', tweet_id: tweetData.tweet_id });
          } else {
            results.push({ id: draft.id, type: draft.type, status: 'failed', error: tweetData.error });
          }
        }

        // Article types → insert into articles table
        else if (draft.type?.startsWith('article')) {
          const slug = (draft.title || draft.body.slice(0, 50))
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

          const wordCount = draft.body.replace(/<[^>]+>/g, '').split(/\s+/).length;
          const readTime = Math.max(1, Math.ceil(wordCount / 200));

          // Determine tag from type
          const tagMap = {
            'article_recap': 'RECAP',
            'article_news': 'NEWS',
            'article_preview': 'PREVIEW',
            'article_analysis': 'ANALYSIS',
            'article_betting': 'BETTING',
          };

          await sb('articles', 'POST', {
            type: draft.type?.replace('article_', '') || 'news',
            title: draft.title || 'TourFeed Article',
            body: draft.body,
            summary: draft.body.replace(/<[^>]+>/g, '').slice(0, 200),
            slug,
            header_image: draft.image_url,
            read_time: readTime,
            tag: tagMap[draft.type] || 'NEWS',
            published_at: new Date().toISOString(),
            tour_id: draft.tour_id || 'pga',
            tournament_id: draft.tournament_id,
          });

          await sb(`content_drafts?id=eq.${draft.id}`, 'PATCH', {
            status: 'published',
            published_at: new Date().toISOString(),
            article_slug: slug,
            article_url: `https://tourfeed.co/article/${slug}`,
          });

          results.push({ id: draft.id, type: draft.type, status: 'published', slug });
        }

      } catch (err) {
        results.push({ id: draft.id, type: draft.type, status: 'error', error: err.message });
      }
    }

    // Send notification for published items
    const published = results.filter(r => r.status === 'published');
    if (published.length > 0) {
      const tweetCount = published.filter(r => r.type?.startsWith('tweet')).length;
      const articleCount = published.filter(r => r.type?.startsWith('article')).length;
      const parts = [];
      if (tweetCount) parts.push(tweetCount + ' tweet' + (tweetCount > 1 ? 's' : ''));
      if (articleCount) parts.push(articleCount + ' article' + (articleCount > 1 ? 's' : ''));
      const msg = 'Published: ' + parts.join(', ');
      try {
        await fetch('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'TourFeed Published', 'Priority': '3' },
          body: msg,
        });
      } catch(e) {}
    }

    // Notify on errors
    const errors = results.filter(r => r.status === 'error' || r.status === 'failed');
    if (errors.length > 0) {
      try {
        await fetch('https://ntfy.sh/tourfeed-alerts', {
          method: 'POST',
          headers: { 'Title': 'TourFeed Error', 'Priority': '4', 'Tags': 'warning' },
          body: 'Publish failed for ' + errors.length + ' draft(s): ' + errors.map(e => e.error).join(', '),
        });
      } catch(e) {}
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ published: published.length, results }),
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
