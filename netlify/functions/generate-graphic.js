// Generate branded TourFeed graphics as SVG → PNG for tweets
// Uses SVG rendered to PNG via resvg-js or returns SVG directly

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'image/svg+xml',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '' };
  }

  const params = event.queryStringParameters || {};
  const type = params.type || 'leaderboard';

  // Brand colors
  const navy = '#1B2538';
  const navyLight = '#243044';
  const green = '#2D8F6F';
  const gold = '#D4A853';
  const white = '#FFFFFF';
  const gray = '#868E96';
  const dimText = '#CED4DA';

  let svg = '';

  if (type === 'leaderboard') {
    // Leaderboard graphic with player headshots
    const title = params.title || 'LEADERBOARD';
    const subtitle = params.subtitle || '';
    // Players: "Name|Score|Today|ID,Name|Score|Today|ID,..."
    const playersStr = params.players || '';
    const players = playersStr.split(',').filter(Boolean).map(p => {
      const parts = p.split('|');
      return { name: parts[0] || '', score: parts[1] || '', today: parts[2] || '', id: parts[3] || '' };
    });

    const rowHeight = 56;
    const height = 200 + players.length * rowHeight;
    svg = `<svg width="800" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${navy}"/>
          <stop offset="100%" stop-color="#0f1923"/>
        </linearGradient>
        <clipPath id="circle"><circle cx="20" cy="20" r="18"/></clipPath>
      </defs>
      <rect width="800" height="${height}" fill="url(#bg)"/>
      <rect x="0" y="0" width="800" height="4" fill="${green}"/>
      <!-- Logo -->
      <text x="30" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${white}" letter-spacing="1">TOUR</text>
      <text x="108" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${gold}" letter-spacing="1">FEED</text>
      <!-- Title -->
      <text x="30" y="90" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="${green}" letter-spacing="3">${escXml(title)}</text>
      ${subtitle ? `<text x="30" y="118" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="800" fill="${white}">${escXml(subtitle)}</text>` : ''}
      <!-- Header -->
      <text x="50" y="155" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${gray}" letter-spacing="1">POS</text>
      <text x="140" y="155" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${gray}" letter-spacing="1">PLAYER</text>
      <text x="580" y="155" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${gray}" letter-spacing="1">TODAY</text>
      <text x="700" y="155" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${gray}" letter-spacing="1">TOTAL</text>
      <line x1="30" y1="165" x2="770" y2="165" stroke="${navyLight}" stroke-width="1"/>
      ${players.map((p, i) => {
        const y = 175 + i * rowHeight;
        const textY = y + 30;
        const isLeader = i === 0;
        const scoreColor = !p.score ? gray : p.score.startsWith('+') ? '#FF6B6B' : p.score === 'E' ? gray : '#2DD4A0';
        const todayColor = !p.today ? gray : p.today.startsWith('+') ? '#FF6B6B' : p.today === 'E' ? gray : '#2DD4A0';
        const headshotUrl = p.id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/golf/players/full/${p.id}.png&amp;w=80&amp;h=60` : '';
        return `
          ${isLeader ? `<rect x="30" y="${y + 4}" width="740" height="${rowHeight - 8}" rx="8" fill="rgba(45,143,111,0.1)"/>` : ''}
          <text x="50" y="${textY}" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="700" fill="${isLeader ? gold : gray}">${i + 1}</text>
          ${headshotUrl ? `
            <clipPath id="clip${i}"><circle cx="${97}" cy="${y + rowHeight/2}" r="18"/></clipPath>
            <circle cx="97" cy="${y + rowHeight/2}" r="19" fill="${navyLight}"/>
            <image href="${headshotUrl}" x="79" y="${y + rowHeight/2 - 18}" width="36" height="36" clip-path="url(#clip${i})"/>
          ` : `<circle cx="97" cy="${y + rowHeight/2}" r="18" fill="${navyLight}"/>`}
          <text x="130" y="${textY}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="${isLeader ? '800' : '600'}" fill="${white}">${escXml(p.name)}</text>
          <text x="580" y="${textY}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="${todayColor}">${escXml(p.today)}</text>
          <text x="700" y="${textY}" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="800" fill="${scoreColor}">${escXml(p.score)}</text>
          ${i < players.length - 1 ? `<line x1="30" y1="${y + rowHeight - 2}" x2="770" y2="${y + rowHeight - 2}" stroke="${navyLight}" stroke-width="0.5"/>` : ''}
        `;
      }).join('')}
      <!-- Footer -->
      <text x="400" y="${height - 15}" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="600" fill="${gray}" text-anchor="middle">tourfeed.co</text>
    </svg>`;
  } else if (type === 'picks') {
    // Picks graphic
    const title = params.title || 'TOURFEED PICKS';
    const subtitle = params.subtitle || '';
    const picksStr = params.picks || '';
    const picks = picksStr.split(',').filter(Boolean).map(p => {
      const [label, name, odds, reason] = p.split('|');
      return { label: label || '', name: name || '', odds: odds || '', reason: reason || '' };
    });

    const height = 180 + picks.length * 80;
    svg = `<svg width="800" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${navy}"/>
          <stop offset="100%" stop-color="#0f1923"/>
        </linearGradient>
      </defs>
      <rect width="800" height="${height}" fill="url(#bg)"/>
      <rect x="0" y="0" width="800" height="4" fill="${gold}"/>
      <!-- Logo -->
      <text x="30" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${white}" letter-spacing="1">TOUR</text>
      <text x="108" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${gold}" letter-spacing="1">FEED</text>
      <!-- Title -->
      <text x="30" y="90" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="${gold}" letter-spacing="3">${escXml(title)}</text>
      ${subtitle ? `<text x="30" y="118" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="800" fill="${white}">${escXml(subtitle)}</text>` : ''}
      ${picks.map((p, i) => {
        const y = 160 + i * 80;
        const labelColor = p.label === 'FAVORITE' ? green : p.label === 'LONGSHOT' ? gold : '#4A90D9';
        const bgColor = p.label === 'FAVORITE' ? 'rgba(45,143,111,0.12)' : p.label === 'LONGSHOT' ? 'rgba(212,168,83,0.12)' : 'rgba(74,144,217,0.12)';
        return `
          <rect x="30" y="${y}" width="740" height="65" rx="8" fill="${bgColor}"/>
          <rect x="30" y="${y}" width="4" height="65" rx="2" fill="${labelColor}"/>
          <text x="50" y="${y + 20}" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${labelColor}" letter-spacing="2">${escXml(p.label)}</text>
          <text x="50" y="${y + 42}" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="${white}">${escXml(p.name)}</text>
          <text x="720" y="${y + 35}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="800" fill="${dimText}" text-anchor="end">${escXml(p.odds)}</text>
          ${p.reason ? `<text x="50" y="${y + 57}" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="${gray}">${escXml(p.reason)}</text>` : ''}
        `;
      }).join('')}
      <!-- Footer -->
      <text x="400" y="${height - 15}" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="600" fill="${gray}" text-anchor="middle">tourfeed.co</text>
    </svg>`;
  } else if (type === 'headline') {
    // News headline graphic
    const headline = params.headline || '';
    const tag = params.tag || 'BREAKING';
    const tagColor = tag === 'RECAP' ? green : tag === 'MAJOR' ? gold : green;

    svg = `<svg width="800" height="420" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${navy}"/>
          <stop offset="100%" stop-color="#0f1923"/>
        </linearGradient>
      </defs>
      <rect width="800" height="420" fill="url(#bg)"/>
      <rect x="0" y="0" width="800" height="4" fill="${tagColor}"/>
      <!-- Logo -->
      <text x="30" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${white}" letter-spacing="1">TOUR</text>
      <text x="108" y="50" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="900" fill="${gold}" letter-spacing="1">FEED</text>
      <!-- Tag -->
      <rect x="30" y="80" width="${tag.length * 12 + 20}" height="28" rx="4" fill="${tagColor}" opacity="0.15"/>
      <text x="40" y="99" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="${tagColor}" letter-spacing="2">${escXml(tag)}</text>
      <!-- Headline (wrap manually) -->
      ${wrapText(headline, 36, 30, 160, 36, white, '800')}
      <!-- Footer -->
      <text x="400" y="400" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="600" fill="${gray}" text-anchor="middle">tourfeed.co</text>
    </svg>`;
  }

  return {
    statusCode: 200,
    headers,
    body: svg,
  };
};

function escXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Simple text wrapping for SVG
function wrapText(text, maxChars, x, startY, lineHeight, fill, weight) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxChars) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += ' ' + word;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  return lines.slice(0, 5).map((line, i) =>
    `<text x="${x}" y="${startY + i * lineHeight}" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="${weight}" fill="${fill}">${escXml(line)}</text>`
  ).join('\n');
}
