// Generate branded TourFeed images as SVG
// Returns SVG that can be served as image/svg+xml
// For Twitter, convert to PNG via post-tweet's media upload

const NAVY = '#1B2538';
const GREEN = '#2D8F6F';
const GOLD = '#D4A853';
const WHITE = '#FFFFFF';
const GRAY = '#868E96';
const DIM = '#CED4DA';
const RED = '#FF6B6B';

function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text, maxChars, x, startY, lineH, fill, size, weight) {
  const words = (text || '').split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 5).map((l, i) =>
    `<text x="${x}" y="${startY + i * lineH}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escXml(l)}</text>`
  ).join('\n');
}

function logo(x, y, size) {
  return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="900" fill="${WHITE}" letter-spacing="1">TOUR</text>` +
    `<text x="${x + size * 3}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="900" fill="${GOLD}" letter-spacing="1">FEED</text>`;
}

function generateLeaderboard(params) {
  const title = params.title || 'LEADERBOARD';
  const subtitle = params.subtitle || '';
  const players = (params.players || '').split(',').filter(Boolean).map(p => {
    const [name, score, today, pos] = p.split('|');
    return { name: name || '', score: score || '', today: today || '', pos: pos || '' };
  });
  const h = 180 + players.length * 48;
  return `<svg width="1080" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="${h}" fill="${NAVY}"/>
    <rect width="1080" height="4" fill="${GREEN}"/>
    ${logo(40, 55, 28)}
    <text x="40" y="100" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${GREEN}" letter-spacing="3">${escXml(title)}</text>
    ${subtitle ? `<text x="40" y="130" font-family="Arial,sans-serif" font-size="24" font-weight="800" fill="${WHITE}">${escXml(subtitle)}</text>` : ''}
    ${players.map((p, i) => {
      const y = 170 + i * 48;
      const sc = !p.score ? GRAY : p.score.startsWith('+') ? RED : p.score === 'E' ? GRAY : '#2DD4A0';
      const tc = !p.today ? GRAY : p.today.startsWith('+') ? RED : p.today === 'E' ? GRAY : '#2DD4A0';
      return `
        ${i === 0 ? `<rect x="30" y="${y - 15}" width="1020" height="42" rx="8" fill="rgba(45,143,111,0.1)"/>` : ''}
        <text x="50" y="${y + 10}" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${i === 0 ? GOLD : GRAY}">${p.pos || i + 1}</text>
        <text x="100" y="${y + 10}" font-family="Arial,sans-serif" font-size="18" font-weight="${i === 0 ? '800' : '600'}" fill="${WHITE}">${escXml(p.name)}</text>
        <text x="800" y="${y + 10}" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${tc}">${escXml(p.today)}</text>
        <text x="950" y="${y + 10}" font-family="Arial,sans-serif" font-size="20" font-weight="800" fill="${sc}">${escXml(p.score)}</text>
        ${i < players.length - 1 ? `<line x1="40" y1="${y + 30}" x2="1040" y2="${y + 30}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>` : ''}
      `;
    }).join('')}
    <text x="540" y="${h - 20}" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="middle">tourfeed.co</text>
  </svg>`;
}

function generateHeadline(params) {
  const tag = params.tag || 'BREAKING';
  const headline = params.headline || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : RED;
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${NAVY}"/>
    <rect width="1080" height="5" fill="${tagColor}"/>
    ${logo(40, 60, 30)}
    <rect x="40" y="100" width="${tag.length * 16 + 30}" height="36" rx="6" fill="${tagColor}" opacity="0.15"/>
    <text x="55" y="124" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="${tagColor}" letter-spacing="3">${escXml(tag)}</text>
    ${wrapText(headline, 28, 40, 220, 52, WHITE, 42, '800')}
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generatePick(params) {
  const label = params.label || 'BEST BET';
  const name = params.name || '';
  const odds = params.odds || '';
  const reason = params.reason || '';
  const labelColor = label === 'LONGSHOT' ? GOLD : label === 'FADE' ? RED : GREEN;
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${NAVY}"/>
    <rect width="1080" height="5" fill="${labelColor}"/>
    ${logo(40, 60, 30)}
    <rect x="40" y="100" width="${label.length * 16 + 30}" height="36" rx="6" fill="${labelColor}" opacity="0.15"/>
    <text x="55" y="124" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="${labelColor}" letter-spacing="3">${escXml(label)}</text>
    <text x="540" y="400" font-family="Arial,sans-serif" font-size="64" font-weight="900" fill="${WHITE}" text-anchor="middle">${escXml(name)}</text>
    <text x="540" y="480" font-family="Arial,sans-serif" font-size="48" font-weight="800" fill="${labelColor}" text-anchor="middle">${escXml(odds)}</text>
    ${reason ? wrapText(reason, 40, 100, 560, 32, DIM, 22, '500') : ''}
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generateWinner(params) {
  const name = params.name || '';
  const tournament = params.tournament || '';
  const score = params.score || '';
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${NAVY}"/>
    <rect width="1080" height="5" fill="${GOLD}"/>
    ${logo(40, 60, 30)}
    <text x="540" y="300" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${GOLD}" text-anchor="middle" letter-spacing="5">WINNER</text>
    <text x="540" y="420" font-family="Arial,sans-serif" font-size="60" font-weight="900" fill="${WHITE}" text-anchor="middle">${escXml(name)}</text>
    <text x="540" y="510" font-family="Arial,sans-serif" font-size="72" font-weight="900" fill="${GREEN}" text-anchor="middle">${escXml(score)}</text>
    <text x="540" y="600" font-family="Arial,sans-serif" font-size="24" font-weight="600" fill="${DIM}" text-anchor="middle">${escXml(tournament)}</text>
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'headline';

  let svg = '';
  switch (type) {
    case 'leaderboard': svg = generateLeaderboard(params); break;
    case 'headline': svg = generateHeadline(params); break;
    case 'pick': svg = generatePick(params); break;
    case 'winner': svg = generateWinner(params); break;
    default: svg = generateHeadline(params);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
    body: svg,
  };
};
