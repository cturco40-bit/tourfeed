// Generate branded TourFeed images — SVG or PNG
// Supports: leaderboard, headline, pick, winner, stat, hot_take, article_header
// Add ?format=png for PNG output (needed for Twitter media upload)

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
  return lines.slice(0, 6).map((l, i) =>
    `<text x="${x}" y="${startY + i * lineH}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escXml(l)}</text>`
  ).join('\n');
}

function logo(x, y, size) {
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="900" fill="${WHITE}" letter-spacing="1">TOUR</text>` +
    `<text x="${x + size * 3}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="900" fill="${GOLD}" letter-spacing="1">FEED</text>`;
}

function watermark(w, h) {
  return `<text x="${w - 40}" y="${h - 20}" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="${GRAY}" text-anchor="end" opacity="0.5">TOUR</text>` +
    `<text x="${w - 40 + 36}" y="${h - 20}" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="${GOLD}" text-anchor="end" opacity="0.5">FEED</text>`;
}

function generateLeaderboard(params) {
  const title = params.title || 'LEADERBOARD';
  const subtitle = params.subtitle || '';
  const players = (params.players || '').split(',').filter(Boolean).map(p => {
    const [name, score, today, pos] = p.split('|');
    return { name: name || '', score: score || '', today: today || '', pos: pos || '' };
  }).slice(0, 8);
  const h = 180 + players.length * 48;
  return `<svg width="1080" height="${Math.max(h, 1080)}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient></defs>
    <rect width="1080" height="${Math.max(h, 1080)}" fill="url(#bg)"/>
    <rect width="1080" height="4" fill="${GREEN}"/>
    <rect x="0" y="${Math.max(h, 1080) - 4}" width="1080" height="4" fill="${GREEN}" opacity="0.3"/>
    ${logo(40, 55, 28)}
    <text x="40" y="100" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="${GREEN}" letter-spacing="3">${escXml(title)}</text>
    ${subtitle ? `<text x="40" y="135" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="800" fill="${WHITE}">${escXml(subtitle)}</text>` : ''}
    ${players.map((p, i) => {
      const y = 170 + i * 48;
      const sc = !p.score ? GRAY : p.score.startsWith('+') ? RED : p.score === 'E' ? GRAY : '#2DD4A0';
      const tc = !p.today ? GRAY : p.today.startsWith('+') ? RED : p.today === 'E' ? GRAY : '#2DD4A0';
      return `
        ${i === 0 ? `<rect x="30" y="${y - 15}" width="1020" height="42" rx="8" fill="rgba(45,143,111,0.1)"/>` : ''}
        <text x="50" y="${y + 10}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="${i === 0 ? GOLD : GRAY}">${p.pos || i + 1}</text>
        <text x="100" y="${y + 10}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="${i === 0 ? '800' : '600'}" fill="${WHITE}">${escXml(p.name)}</text>
        <text x="800" y="${y + 10}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="${tc}">${escXml(p.today)}</text>
        <text x="950" y="${y + 10}" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="${sc}">${escXml(p.score)}</text>
        ${i < players.length - 1 ? `<line x1="40" y1="${y + 30}" x2="1040" y2="${y + 30}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>` : ''}
      `;
    }).join('')}
    ${watermark(1080, Math.max(h, 1080))}
  </svg>`;
}

function generateHeadline(params) {
  const tag = params.tag || 'BREAKING';
  const headline = params.headline || '';
  const tournament = params.tournament || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : RED;
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${tagColor}" stop-opacity="0.15"/><stop offset="100%" stop-color="${tagColor}" stop-opacity="0"/></linearGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <rect width="1080" height="5" fill="${tagColor}"/>
    <rect x="0" y="0" width="8" height="1080" fill="${tagColor}" opacity="0.6"/>
    <rect x="0" y="160" width="1080" height="500" fill="url(#accent)"/>
    ${logo(50, 70, 28)}
    <rect x="50" y="110" width="${tag.length * 15 + 30}" height="34" rx="6" fill="${tagColor}" opacity="0.2"/>
    <text x="65" y="132" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="${tagColor}" letter-spacing="3">${escXml(tag)}</text>
    ${wrapText(headline, 22, 50, 240, 64, WHITE, 52, '800')}
    ${tournament ? `<text x="50" y="940" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="600" fill="${DIM}">${escXml(tournament)}</text>` : ''}
    <rect x="50" y="980" width="200" height="3" rx="2" fill="${tagColor}" opacity="0.4"/>
    ${logo(50, 1040, 20)}
    <text x="1030" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generateArticleHeader(params) {
  const tag = params.tag || 'NEWS';
  const headline = params.headline || '';
  const tournament = params.tournament || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : tag === 'BREAKING' ? RED : GREEN;
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect width="1200" height="5" fill="${tagColor}"/>
    ${logo(50, 60, 28)}
    <rect x="50" y="90" width="${tag.length * 14 + 30}" height="32" rx="6" fill="${tagColor}" opacity="0.15"/>
    <text x="65" y="112" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="${tagColor}" letter-spacing="2">${escXml(tag)}</text>
    ${wrapText(headline, 35, 50, 200, 48, WHITE, 38, '800')}
    ${tournament ? `<text x="50" y="560" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="600" fill="${DIM}">${escXml(tournament)}</text>` : ''}
    <line x1="50" y1="580" x2="1150" y2="580" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(50, 610, 18)}
    <text x="1150" y="610" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generatePick(params) {
  const label = params.label || 'BEST BET';
  const name = params.name || '';
  const odds = params.odds || '';
  const reason = params.reason || '';
  const confidence = params.confidence || '';
  const units = params.units || '';
  const labelColor = label === 'LONGSHOT' ? GOLD : label === 'FADE' ? RED : label === 'VALUE PLAY' ? '#4A90D9' : GREEN;
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <rect width="1080" height="5" fill="${labelColor}"/>
    ${logo(40, 60, 30)}
    <rect x="40" y="100" width="${label.length * 16 + 30}" height="36" rx="6" fill="${labelColor}" opacity="0.15"/>
    <text x="55" y="124" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="${labelColor}" letter-spacing="3">${escXml(label)}</text>
    <text x="540" y="380" font-family="Arial,Helvetica,sans-serif" font-size="60" font-weight="900" fill="${WHITE}" text-anchor="middle">${escXml(name)}</text>
    <text x="540" y="470" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="800" fill="${labelColor}" text-anchor="middle">${escXml(odds)}</text>
    ${confidence ? `<text x="540" y="530" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="600" fill="${DIM}" text-anchor="middle">Confidence: ${escXml(confidence)}/10${units ? '  |  ' + escXml(units) : ''}</text>` : ''}
    ${reason ? wrapText(reason, 40, 100, 600, 32, DIM, 20, '500') : ''}
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generateWinner(params) {
  const name = params.name || '';
  const tournament = params.tournament || '';
  const score = params.score || '';
  const flag = params.flag || '';
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient>
    <linearGradient id="glow" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${GOLD}" stop-opacity="0.1"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <rect x="0" y="200" width="1080" height="400" fill="url(#glow)"/>
    <rect width="1080" height="5" fill="${GOLD}"/>
    ${logo(40, 60, 30)}
    <text x="540" y="300" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="${GOLD}" text-anchor="middle" letter-spacing="8">WINNER</text>
    <text x="540" y="420" font-family="Arial,Helvetica,sans-serif" font-size="60" font-weight="900" fill="${WHITE}" text-anchor="middle">${escXml(name)}</text>
    ${flag ? `<text x="540" y="470" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="600" fill="${DIM}" text-anchor="middle">${escXml(flag)}</text>` : ''}
    <text x="540" y="550" font-family="Arial,Helvetica,sans-serif" font-size="72" font-weight="900" fill="${GREEN}" text-anchor="middle">${escXml(score)}</text>
    <text x="540" y="630" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="600" fill="${DIM}" text-anchor="middle">${escXml(tournament)}</text>
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generateStat(params) {
  const number = params.number || '';
  const label = params.label || '';
  const player = params.player || '';
  const context = params.context || '';
  const comparison = params.comparison || '';
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <rect width="1080" height="5" fill="${GREEN}"/>
    ${logo(40, 60, 30)}
    <text x="540" y="350" font-family="Arial,Helvetica,sans-serif" font-size="120" font-weight="900" fill="${WHITE}" text-anchor="middle">${escXml(number)}</text>
    <text x="540" y="420" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="600" fill="${DIM}" text-anchor="middle">${escXml(label)}</text>
    <text x="540" y="520" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="800" fill="${WHITE}" text-anchor="middle">${escXml(player)}</text>
    ${context ? `<text x="540" y="570" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="600" fill="${GRAY}" text-anchor="middle">${escXml(context)}</text>` : ''}
    ${comparison ? `<text x="540" y="650" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="500" fill="${DIM}" text-anchor="middle">${escXml(comparison)}</text>` : ''}
    <line x1="40" y1="980" x2="1040" y2="980" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    ${logo(40, 1040, 22)}
    <text x="1040" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

function generateHotTake(params) {
  const quote = params.quote || '';
  const context = params.context || '';
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0F1923"/></linearGradient>
      <linearGradient id="glow" x1="0" y1="0.2" x2="0" y2="0.8"><stop offset="0%" stop-color="${GREEN}" stop-opacity="0.08"/><stop offset="50%" stop-color="${GREEN}" stop-opacity="0.03"/><stop offset="100%" stop-color="transparent"/></linearGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <rect x="0" y="150" width="1080" height="700" fill="url(#glow)"/>
    <rect width="1080" height="5" fill="${GREEN}"/>
    <rect x="0" y="0" width="8" height="1080" fill="${GREEN}" opacity="0.5"/>
    ${logo(50, 70, 28)}
    <rect x="50" y="110" width="130" height="34" rx="6" fill="${GREEN}" opacity="0.2"/>
    <text x="65" y="132" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="${GREEN}" letter-spacing="3">HOT TAKE</text>
    <text x="50" y="300" font-family="Arial,Helvetica,sans-serif" font-size="100" font-weight="900" fill="${GREEN}" opacity="0.15">&quot;</text>
    ${wrapText(quote, 24, 70, 340, 56, WHITE, 42, '700')}
    ${context ? `<text x="540" y="920" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="600" fill="${GRAY}" text-anchor="middle">${escXml(context)}</text>` : ''}
    <rect x="50" y="980" width="200" height="3" rx="2" fill="${GREEN}" opacity="0.4"/>
    ${logo(50, 1040, 20)}
    <text x="1030" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="600" fill="${GRAY}" text-anchor="end">tourfeed.co</text>
  </svg>`;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'headline';
  const format = params.format || 'svg';

  let svg = '';
  switch (type) {
    case 'leaderboard': svg = generateLeaderboard(params); break;
    case 'headline': svg = generateHeadline(params); break;
    case 'article_header': svg = generateArticleHeader(params); break;
    case 'pick': svg = generatePick(params); break;
    case 'winner': svg = generateWinner(params); break;
    case 'stat': svg = generateStat(params); break;
    case 'hot_take': svg = generateHotTake(params); break;
    default: svg = generateHeadline(params);
  }

  // PNG conversion
  if (format === 'png') {
    try {
      const { Resvg } = require('@resvg/resvg-js');
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'original' },
        font: { loadSystemFonts: false },
      });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
        body: pngBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (e) {
      console.error('PNG conversion failed, falling back to SVG:', e.message);
      // Fall through to SVG
    }
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
