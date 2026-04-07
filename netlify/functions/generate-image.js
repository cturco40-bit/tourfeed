// TourFeed Image Generator
// Two modes:
// 1. Auto-generated data cards (leaderboard, betting, stat, etc.) — no photos needed
// 2. Photo composites via query params (photo= URL) — for manual editor or ESPN photos

const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fontB64 = require('./font-data');
const fontPath = path.join(os.tmpdir(), 'DMSans.ttf');
if (!fs.existsSync(fontPath)) {
  fs.writeFileSync(fontPath, Buffer.from(fontB64, 'base64'));
}
GlobalFonts.registerFromPath(fontPath, 'DM Sans');

const NAVY = '#1B2538';
const NAVY_D = '#111927';
const GREEN = '#2D8F6F';
const GOLD = '#D4A853';
const WHITE = '#FFFFFF';
const GRAY = '#868E96';
const GRAY_D = '#495057';
const RED = '#E63946';
const S_GREEN = '#2DD4A0';
const S_RED = '#FF6B6B';

function F(w, s) { return `${w} ${s}px "DM Sans"`; }

async function fetchImg(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 500 ? await loadImage(b) : null;
  } catch(e) { return null; }
}

function drawLogo(ctx, x, y, sz) {
  ctx.font = F(900, sz);
  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.fillText('TOUR', x, y);
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + ctx.measureText('TOUR').width + 2, y);
}

function watermark(ctx, W, H) {
  ctx.globalAlpha = 0.6;
  ctx.font = F(900, 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = WHITE;
  var tw = ctx.measureText('TOUR').width;
  var fw = ctx.measureText('FEED').width;
  ctx.fillText('TOUR', W - 25 - fw - 2, H - 22);
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', W - 25, H - 22);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function fitText(ctx, text, x, y, maxW, maxH, startSz, weight) {
  var sz = startSz;
  while (sz > 14) {
    ctx.font = F(weight, sz);
    var lh = Math.round(sz * 1.25);
    var lines = [], line = '';
    for (var w of (text||'').split(' ')) {
      var t = line + (line ? ' ' : '') + w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    if (lines.length * lh <= maxH) {
      lines.forEach(function(l, i) { ctx.fillText(l, x, y + i * lh); });
      return y + lines.length * lh;
    }
    sz -= 2;
  }
  ctx.font = F(weight, 14);
  var line2 = '', cy = y;
  for (var w2 of (text||'').split(' ')) {
    var t2 = line2 + (line2 ? ' ' : '') + w2;
    if (ctx.measureText(t2).width > maxW && line2) { ctx.fillText(line2, x, cy); cy += 18; line2 = w2; }
    else line2 = t2;
  }
  if (line2) { ctx.fillText(line2, x, cy); cy += 18; }
  return cy;
}

function bg(ctx, W, H) {
  var g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, NAVY_D);
  g.addColorStop(0.5, NAVY);
  g.addColorStop(1, '#1a3a2f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function scoreColor(s) {
  if (!s) return GRAY;
  s = String(s);
  return s.startsWith('+') ? S_RED : s === 'E' || s === '0' ? GRAY : S_GREEN;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE A: LEADERBOARD CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildLeaderboard(p) {
  var players = [];
  try { players = JSON.parse(p.players || '[]'); } catch(e) {}
  if (!players.length) return null;
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  // Top bar
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  // Logo + LIVE badge
  drawLogo(ctx, 40, 52, 26);
  if (p.status && p.status.toLowerCase().includes('progress')) {
    ctx.fillStyle = S_GREEN + '30';
    ctx.beginPath(); ctx.roundRect(W - 110, 25, 75, 30, 6); ctx.fill();
    ctx.font = F(700, 13); ctx.fillStyle = S_GREEN; ctx.textAlign = 'center';
    ctx.fillText('LIVE', W - 72, 46); ctx.textAlign = 'left';
  }

  // Tournament name
  ctx.font = F(900, 40); ctx.fillStyle = WHITE;
  ctx.fillText(p.tournament || 'Tournament', 40, 110);
  ctx.font = F(500, 20); ctx.fillStyle = GRAY;
  ctx.fillText((p.status || '') + (p.course ? ' \u2022 ' + p.course : ''), 40, 142);

  // Column headers
  ctx.font = F(700, 14); ctx.fillStyle = GRAY_D;
  ctx.fillText('POS', 40, 195);
  ctx.fillText('PLAYER', 110, 195);
  ctx.textAlign = 'center'; ctx.fillText('TODAY', 800, 195);
  ctx.textAlign = 'right'; ctx.fillText('TOTAL', 1020, 195);
  ctx.textAlign = 'left';

  ctx.fillStyle = WHITE + '08'; ctx.fillRect(40, 205, 1000, 1);

  // Player rows
  players.slice(0, 10).forEach(function(pl, i) {
    var y = 230 + i * 76;
    // Leader highlight
    if (i === 0) {
      ctx.fillStyle = GREEN + '10';
      ctx.beginPath(); ctx.roundRect(20, y - 6, 1040, 68, 8); ctx.fill();
    }
    // Position
    ctx.font = F(800, 24); ctx.fillStyle = i === 0 ? GOLD : GRAY;
    ctx.fillText(String(pl.pos || i + 1), 50, y + 32);
    // Name
    ctx.font = F(i === 0 ? 800 : 600, 24); ctx.fillStyle = WHITE;
    ctx.fillText(pl.name || '', 110, y + 32);
    // Flag
    if (pl.flag) {
      ctx.font = F(500, 14); ctx.fillStyle = GRAY;
      ctx.fillText(pl.flag, 110, y + 52);
    }
    // Today
    ctx.font = F(700, 22); ctx.fillStyle = scoreColor(pl.today);
    ctx.textAlign = 'center'; ctx.fillText(pl.today || '', 800, y + 32);
    // Total
    ctx.font = F(900, 28); ctx.fillStyle = scoreColor(pl.total);
    ctx.textAlign = 'right'; ctx.fillText(pl.total || '', 1020, y + 32);
    ctx.textAlign = 'left';
    // Divider
    if (i < players.length - 1 && i < 9) {
      ctx.fillStyle = WHITE + '06'; ctx.fillRect(40, y + 64, 1000, 1);
    }
  });

  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE B: BETTING PICK CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildPick(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  var label = (p.label || 'BEST BET').toUpperCase();
  var lc = label === 'LONGSHOT' ? GOLD : label.includes('VALUE') ? '#4A90D9' : label === 'FADE' ? RED : GREEN;

  // Gold accent glow
  var glow = ctx.createRadialGradient(W * 0.8, 100, 50, W * 0.8, 100, 500);
  glow.addColorStop(0, lc + '15');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = lc; ctx.fillRect(0, 0, W, 4);
  drawLogo(ctx, 40, 52, 24);

  // Label badge
  ctx.font = F(900, 18); var tw = ctx.measureText(label).width;
  ctx.fillStyle = lc + '25';
  ctx.beginPath(); ctx.roundRect(40, 90, tw + 30, 36, 6); ctx.fill();
  ctx.fillStyle = lc; ctx.fillText(label, 55, 115);

  // Player name huge
  ctx.font = F(900, 52); ctx.fillStyle = WHITE;
  ctx.fillText(p.player || '', 40, 230);

  // Odds massive
  ctx.font = F(900, 72); ctx.fillStyle = lc;
  ctx.fillText(p.odds || '', 40, 320);

  // Reasoning
  if (p.reasoning) {
    ctx.font = F(500, 20); ctx.fillStyle = '#CED4DA';
    fitText(ctx, p.reasoning, 40, 380, W - 80, 180, 20, 500);
  }

  // Confidence dots
  if (p.confidence) {
    var conf = parseInt(p.confidence) || 0;
    ctx.font = F(700, 14); ctx.fillStyle = GRAY; ctx.fillText('CONFIDENCE', 40, 600);
    for (var i = 0; i < 10; i++) {
      ctx.beginPath(); ctx.arc(55 + i * 30, 630, 10, 0, Math.PI * 2);
      ctx.fillStyle = i < conf ? lc : WHITE + '15'; ctx.fill();
    }
  }

  // Units
  if (p.units) {
    ctx.font = F(800, 18); ctx.fillStyle = WHITE;
    ctx.fillStyle = lc + '30';
    ctx.beginPath(); ctx.roundRect(40, 660, 80, 34, 6); ctx.fill();
    ctx.fillStyle = lc; ctx.font = F(800, 16);
    ctx.fillText(p.units, 58, 682);
  }

  // Tournament
  ctx.font = F(600, 16); ctx.fillStyle = GRAY;
  ctx.fillText((p.tournament || '').toUpperCase(), 40, H - 60);

  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE C: STAT CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildStat(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, W, 4);
  drawLogo(ctx, 40, 52, 24);

  // Label
  ctx.font = F(900, 16); ctx.fillStyle = GREEN;
  ctx.fillText('STAT OF THE DAY', 40, 110);

  // Big number centered
  ctx.font = F(900, 130); ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(p.number || '', W / 2, 400);

  // Stat label
  ctx.font = F(700, 28); ctx.fillStyle = GOLD;
  ctx.fillText((p.label || '').toUpperCase(), W / 2, 460);

  // Player + context
  ctx.font = F(600, 22); ctx.fillStyle = GRAY;
  ctx.fillText(p.player || '', W / 2, 530);
  ctx.font = F(500, 18); ctx.fillStyle = GRAY_D;
  ctx.fillText(p.context || '', W / 2, 565);

  // Comparison
  if (p.comparison) {
    ctx.font = F(500, 16); ctx.fillStyle = GRAY_D;
    ctx.fillText(p.comparison, W / 2, 640);
  }

  ctx.textAlign = 'left';
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE D: ARTICLE HEADER (1200x630)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function buildArticleHeader(p) {
  var W = 1200, H = 630;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  var tag = (p.tag || 'NEWS').toUpperCase();
  var tc = tag === 'RECAP' || tag === 'PREVIEW' ? GREEN : tag === 'BETTING' || tag === 'ANALYSIS' ? GOLD : tag === 'BREAKING' ? RED : GREEN;

  // Photo background if provided
  if (p.photo) {
    var img = await fetchImg(p.photo);
    if (img) {
      var scale = Math.max(W / img.width, H / img.height);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(img, (W - img.width * scale) / 2, (H - img.height * scale) / 2, img.width * scale, img.height * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = NAVY_D + 'CC';
      ctx.fillRect(0, 0, W, H);
    }
  }

  ctx.fillStyle = tc; ctx.fillRect(0, 0, W, 4);
  drawLogo(ctx, 40, 42, 18);

  // Tag
  ctx.font = F(700, 12);
  var tagW = ctx.measureText(tag).width;
  ctx.fillStyle = tc + '30';
  ctx.beginPath(); ctx.roundRect(40, 56, tagW + 20, 24, 5); ctx.fill();
  ctx.fillStyle = tc; ctx.fillText(tag, 50, 73);

  // Headline
  ctx.fillStyle = WHITE; ctx.textAlign = 'left';
  fitText(ctx, p.headline || '', 40, 140, W - 80, 380, 38, 800);

  // Footer
  ctx.font = F(600, 12); ctx.fillStyle = GRAY;
  ctx.fillText((p.tournament || '').toUpperCase() + (p.read_time ? '  \u2022  ' + p.read_time : ''), 40, H - 30);
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE E: BREAKING NEWS (text only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildBreaking(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  // Dark bg with red accent
  ctx.fillStyle = NAVY_D; ctx.fillRect(0, 0, W, H);
  var rg = ctx.createRadialGradient(W / 2, 200, 50, W / 2, 200, 600);
  rg.addColorStop(0, RED + '15');
  rg.addColorStop(1, 'transparent');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = RED; ctx.fillRect(0, 0, W, 5);
  drawLogo(ctx, 40, 52, 24);

  // BREAKING badge
  ctx.font = F(900, 20);
  var bw = ctx.measureText('BREAKING').width;
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.roundRect(40, 100, bw + 30, 40, 6); ctx.fill();
  ctx.fillStyle = WHITE; ctx.fillText('BREAKING', 55, 128);

  // Headline centered
  ctx.fillStyle = WHITE; ctx.textAlign = 'center';
  var endY = fitText(ctx, (p.headline || '').toUpperCase(), W / 2, 280, W - 100, 400, 48, 900);

  // Green line
  ctx.strokeStyle = GREEN; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W * 0.2, endY + 30); ctx.lineTo(W * 0.8, endY + 30); ctx.stroke();

  // Context
  if (p.context) {
    ctx.font = F(700, 20); ctx.fillStyle = '#CED4DA';
    ctx.fillText((p.context || '').toUpperCase(), W / 2, endY + 65);
  }

  // Source
  ctx.font = F(600, 14); ctx.fillStyle = GRAY;
  ctx.fillText(p.source || 'TOURFEED STAFF', W / 2, endY + 95);

  ctx.textAlign = 'left';
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE F: HOT TAKE (text only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildHotTake(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  var fullText = p.take || p.quote || '';
  // If text > 80 chars, use SHORT label card (readable at thumbnail)
  if (fullText.length > 40) {
    // Determine label from context
    var label = 'HOT TAKE';
    var labelColor = GREEN;
    var tag = (p.tag || '').toUpperCase();
    if (tag === 'BREAKING' || /break|arrest|withdraw/i.test(fullText)) { label = 'BREAKING'; labelColor = RED; }
    else if (tag === 'BETTING' || /odds|bet|pick|value/i.test(fullText)) { label = 'BETTING'; labelColor = GOLD; }
    else if (tag === 'RECAP' || /recap|win|champion/i.test(fullText)) { label = 'RECAP'; labelColor = GREEN; }
    else if (/masters|augusta/i.test(fullText)) { label = 'MASTERS 2026'; labelColor = GOLD; }

    // Extract short headline (first 6 words or title)
    var shortText = (p.headline || fullText).split(/\s+/).slice(0, 6).join(' ');
    if (shortText.length > 40) shortText = shortText.slice(0, 37) + '...';

    ctx.fillStyle = labelColor; ctx.fillRect(0, 0, W, 5);
    drawLogo(ctx, 50, 70, 28);

    // Big label
    ctx.font = F(900, 22);
    var lw = ctx.measureText(label).width;
    ctx.fillStyle = labelColor + '25';
    ctx.beginPath(); ctx.roundRect(50, 150, lw + 40, 50, 8); ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.fillText(label, 70, 185);

    // Short headline
    ctx.font = F(900, 56); ctx.fillStyle = WHITE;
    fitText(ctx, shortText.toUpperCase(), 50, 320, W - 100, 400, 56, 900);

    watermark(ctx, W, H);
    return c.toBuffer('image/png');
  }

  // Short text — show full quote
  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, W, 4);
  drawLogo(ctx, 40, 52, 24);

  ctx.font = F(900, 16); ctx.fillStyle = GREEN;
  ctx.fillText('HOT TAKE', 40, 110);

  ctx.fillStyle = WHITE; ctx.textAlign = 'center';
  fitText(ctx, fullText.toUpperCase(), W / 2, 300, W - 100, 450, 40, 800);

  if (p.context) {
    ctx.font = F(600, 16); ctx.fillStyle = GRAY;
    ctx.fillText((p.context || '').toUpperCase(), W / 2, H - 100);
  }

  ctx.textAlign = 'left';
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE G: PLAYER QUOTE (text only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildQuote(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');
  bg(ctx, W, H);

  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, W, 4);
  drawLogo(ctx, 40, 52, 24);

  // Big quote mark
  ctx.font = F(900, 120); ctx.fillStyle = GREEN + '30';
  ctx.fillText('\u201C', 30, 240);

  // Quote text
  ctx.fillStyle = WHITE; ctx.textAlign = 'center';
  var endY = fitText(ctx, (p.quote || '').toUpperCase(), W / 2, 300, W - 120, 400, 36, 800);

  // Green line
  ctx.strokeStyle = GREEN; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W * 0.2, endY + 20); ctx.lineTo(W * 0.8, endY + 20); ctx.stroke();

  // Player name
  ctx.font = F(800, 24); ctx.fillStyle = WHITE;
  ctx.fillText((p.player || '').toUpperCase(), W / 2, endY + 55);

  // Context
  ctx.font = F(600, 16); ctx.fillStyle = GRAY;
  ctx.fillText((p.context || '').toUpperCase(), W / 2, endY + 85);

  ctx.textAlign = 'left';
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMPLATE H: WINNER / CHAMPION (text only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildWinner(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = NAVY_D; ctx.fillRect(0, 0, W, H);
  var gg = ctx.createRadialGradient(W / 2, H * 0.5, 50, W / 2, H * 0.5, 500);
  gg.addColorStop(0, GOLD + '18');
  gg.addColorStop(1, 'transparent');
  ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, 5);
  drawLogo(ctx, 40, 52, 24);

  ctx.textAlign = 'center';

  // CHAMPION label
  ctx.font = F(700, 18); ctx.fillStyle = GOLD;
  ctx.fillText('C H A M P I O N', W / 2, 280);

  // Player name
  ctx.font = F(900, 60); ctx.fillStyle = WHITE;
  ctx.fillText(p.player || '', W / 2, 400);

  // Score
  ctx.font = F(900, 56); ctx.fillStyle = GREEN;
  ctx.fillText(p.score || '', W / 2, 490);

  // Tournament
  ctx.font = F(700, 24); ctx.fillStyle = WHITE;
  ctx.fillText((p.tournament || '').toUpperCase(), W / 2, 560);

  // Flag
  if (p.flag) {
    ctx.font = F(500, 18); ctx.fillStyle = GRAY;
    ctx.fillText(p.flag, W / 2, 600);
  }

  ctx.textAlign = 'left';
  watermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.handler = async (event) => {
  var p = event.queryStringParameters || {};
  var type = p.type || 'headline';
  var buf;

  switch (type) {
    case 'leaderboard': buf = buildLeaderboard(p); break;
    case 'pick': buf = buildPick(p); break;
    case 'stat': buf = buildStat(p); break;
    case 'article_header': buf = await buildArticleHeader(p); break;
    case 'breaking': buf = buildBreaking(p); break;
    case 'hot_take': buf = buildHotTake(p); break;
    case 'quote': buf = buildQuote(p); break;
    case 'winner': buf = buildWinner(p); break;
    // Legacy compat
    case 'headline': buf = p.tag === 'BREAKING' ? buildBreaking(p) : await buildArticleHeader(p); break;
    default: buf = await buildArticleHeader(p);
  }

  if (!buf) buf = buildBreaking({ headline: 'Image generation failed' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
