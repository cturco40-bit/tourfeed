const SUPABASE_URL = 'https://yumahmnoltvbiadjefxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';

exports.handler = async () => {
  let articleUrls = '';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=slug,published_at&order=published_at.desc&limit=200`, {
      headers: { 'apikey': SUPABASE_KEY },
    });
    if (res.ok) {
      const articles = await res.json();
      articleUrls = articles.filter(a => a.slug).map(a => {
        const lastmod = a.published_at ? `<lastmod>${a.published_at.split('T')[0]}</lastmod>` : '';
        return `  <url><loc>https://tourfeed.co/article/${a.slug}</loc>${lastmod}<priority>0.7</priority></url>`;
      }).join('\n');
    }
  } catch (e) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://tourfeed.co/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
  <url><loc>https://tourfeed.co/scores</loc><changefreq>always</changefreq><priority>0.9</priority></url>
  <url><loc>https://tourfeed.co/picks</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>https://tourfeed.co/news</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>
${articleUrls}
</urlset>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
    body: xml,
  };
};
