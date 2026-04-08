// TourFeed Image Generator — Vintage Golf Editorial Design
// Cream background, Playfair Display headlines, gold accents
// Matches the tourfeed.co site aesthetic

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load both fonts
const dmB64 = require('./font-data');
const pfB64 = require('./font-playfair');
const dmPath = path.join(os.tmpdir(), 'DMSans.ttf');
const pfPath = path.join(os.tmpdir(), 'PlayfairDisplay.ttf');
if (!fs.existsSync(dmPath)) fs.writeFileSync(dmPath, Buffer.from(dmB64, 'base64'));
if (!fs.existsSync(pfPath)) fs.writeFileSync(pfPath, Buffer.from(pfB64, 'base64'));
GlobalFonts.registerFromPath(dmPath, 'DM Sans');
GlobalFonts.registerFromPath(pfPath, 'Playfair Display');

// Brand colors matching the site
const CREAM = '#FAF6F0';
const CARD = '#FFFFFF';
const GREEN = '#1A472A';
const GREEN_L = '#2D5A3B';
const GOLD = '#D4A853';
const GOLD_D = '#8B7335';
const RED = '#8B2020';
const TEXT = '#2C2416';
const DIM = '#5C5244';
const MUTED = '#8C8478';
const BORDER = '#D8D0C4';

function dm(w, s) { return w + ' ' + s + 'px "DM Sans"'; }
function pf(w, s) { return w + ' ' + s + 'px "Playfair Display"'; }

function tagColors(tag) {
  var t = (tag || '').toUpperCase();
  if (t === 'RECAP' || t === 'TOURNAMENT') return { bg: GREEN, fg: '#fff' };
  if (t === 'BETTING') return { bg: GOLD_D, fg: '#fff' };
  if (t === 'BREAKING' || t === 'INJURY') return { bg: RED, fg: '#fff' };
  if (t === 'PREVIEW') return { bg: GREEN_L, fg: '#dfe8d8' };
  if (t === 'ANALYSIS') return { bg: '#4A4030', fg: '#F5EFE5' };
  if (t === 'NEWS' || t === 'TOUR NEWS') return { bg: '#3D4F42', fg: '#dfe8d8' };
  if (t.includes('MASTERS')) return { bg: GREEN, fg: GOLD };
  return { bg: GREEN, fg: '#fff' };
}

// Auto-fit text — returns final Y position
function fitText(ctx, text, x, y, maxW, maxH, startSz, weight, font) {
  var sz = startSz;
  while (sz > 14) {
    ctx.font = font === 'pf' ? pf(weight, sz) : dm(weight, sz);
    var lh = Math.round(sz * 1.3);
    var lines = [], line = '';
    for (var w of (text || '').split(' ')) {
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
  ctx.font = font === 'pf' ? pf(weight, 14) : dm(weight, 14);
  var ln = '', cy = y;
  for (var w2 of (text || '').split(' ')) {
    var t2 = ln + (ln ? ' ' : '') + w2;
    if (ctx.measureText(t2).width > maxW && ln) { ctx.fillText(ln, x, cy); cy += 18; ln = w2; }
    else ln = t2;
  }
  if (ln) { ctx.fillText(ln, x, cy); cy += 18; }
  return cy;
}

function drawLogo(ctx, x, y, sz) {
  // Wordmark only (golf bag icon is in Canva, not code-generated)
  ctx.font = dm('900', sz);
  ctx.textAlign = 'left';
  ctx.fillStyle = GREEN;
  ctx.fillText('TOUR', x, y);
  var tw = ctx.measureText('TOUR').width;
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + tw + 2, y);
}

function drawWatermark(ctx, W, H) {
  ctx.globalAlpha = 0.35;
  ctx.font = dm('900', 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = GREEN;
  var tw = ctx.measureText('TOUR').width;
  var fw = ctx.measureText('FEED').width;
  ctx.fillText('TOUR', W - 30 - fw - 2, H - 24);
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', W - 30, H - 24);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawTag(ctx, tag, x, y) {
  var tc = tagColors(tag);
  var tagText = (tag || 'NEWS').toUpperCase();
  ctx.font = dm('700', 10);
  var tw = ctx.measureText(tagText).width;
  ctx.fillStyle = tc.bg;
  ctx.beginPath();
  ctx.roundRect(x, y, tw + 14, 20, 3);
  ctx.fill();
  ctx.fillStyle = tc.fg;
  ctx.fillText(tagText, x + 7, y + 14);
}

// ━━━ ARTICLE HEADER (1200x630) ━━━
function buildArticleHeader(p) {
  var W = 1200, H = 630;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  // Cream background
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);

  // Subtle border
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Top green bar
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  // Logo
  drawLogo(ctx, 50, 52, 22);

  // Tag badge
  drawTag(ctx, p.tag, 50, 80);

  // Headline — Playfair Display
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'left';
  var endY = fitText(ctx, p.headline || '', 50, 155, W - 100, 320, 40, '800', 'pf');

  // Gold line under headline
  ctx.fillStyle = GOLD;
  ctx.fillRect(50, endY + 16, 120, 3);

  // Bottom left: tourfeed.co
  ctx.font = dm('600', 11);
  ctx.fillStyle = MUTED;
  ctx.fillText('tourfeed.co', 50, H - 30);

  // Watermark
  drawWatermark(ctx, W, H);

  return c.toBuffer('image/png');
}

// ━━━ TWEET IMAGE (1080x1080) ━━━
function buildTweet(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  // Cream background
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);

  // Subtle border
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Top green bar
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 5);

  // Logo
  drawLogo(ctx, 60, 70, 26);

  // Tag badge — large and prominent
  var tag = p.tag || 'NEWS';
  if (/masters|augusta/i.test((p.headline || '') + ' ' + (p.quote || ''))) tag = 'MASTERS 2026';
  if (/break|withdraw|arrest/i.test(p.headline || '')) tag = 'BREAKING';
  if (/bet|odds|pick|value/i.test(p.headline || '')) tag = 'BETTING';
  if (/recap|win|champion/i.test(p.headline || '')) tag = 'RECAP';

  var tc = tagColors(tag);
  var tagText = tag.toUpperCase();
  ctx.font = dm('800', 14);
  var tagW = ctx.measureText(tagText).width;
  ctx.fillStyle = tc.bg;
  ctx.beginPath();
  ctx.roundRect(60, 120, tagW + 24, 30, 4);
  ctx.fill();
  ctx.fillStyle = tc.fg;
  ctx.fillText(tagText, 72, 141);

  // Short headline — MAX 5 words, never more than 35 chars
  var fullText = p.headline || p.quote || p.take || '';
  var shortText = fullText.split(/\s+/).slice(0, 5).join(' ');
  if (shortText.length > 35) shortText = shortText.split(/\s+/).slice(0, 4).join(' ');
  if (shortText.length > 35) shortText = shortText.slice(0, 32) + '...';

  // Headline in Playfair Display
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'left';
  var endY = fitText(ctx, shortText, 60, 260, W - 120, 400, 52, '800', 'pf');

  // Gold line
  ctx.fillStyle = GOLD;
  ctx.fillRect(60, endY + 24, 140, 3);

  // Bottom: tourfeed.co
  ctx.font = dm('600', 12);
  ctx.fillStyle = MUTED;
  ctx.fillText('tourfeed.co', 60, H - 40);

  // Watermark
  drawWatermark(ctx, W, H);

  return c.toBuffer('image/png');
}

// ━━━ LEADERBOARD CARD (1080x1080) ━━━
function buildLeaderboard(p) {
  var players = [];
  try { players = JSON.parse(p.players || '[]'); } catch(e) {}
  if (!players.length) return buildTweet({ headline: p.tournament || 'Leaderboard', tag: 'RECAP' });

  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  drawLogo(ctx, 50, 52, 22);

  // Tournament name
  ctx.font = pf('800', 32);
  ctx.fillStyle = TEXT;
  ctx.fillText(p.tournament || 'Tournament', 50, 110);
  ctx.font = dm('500', 14);
  ctx.fillStyle = MUTED;
  ctx.fillText((p.status || '') + (p.course ? ' \u2022 ' + p.course : ''), 50, 135);

  // Column headers
  ctx.fillStyle = '#F0EAE0';
  ctx.fillRect(40, 160, W - 80, 30);
  ctx.font = dm('700', 10);
  ctx.fillStyle = MUTED;
  ctx.fillText('POS', 55, 180);
  ctx.fillText('PLAYER', 100, 180);
  ctx.textAlign = 'center';
  ctx.fillText('TODAY', 800, 180);
  ctx.textAlign = 'right';
  ctx.fillText('TOTAL', 1010, 180);
  ctx.textAlign = 'left';

  players.slice(0, 10).forEach(function(pl, i) {
    var y = 205 + i * 68;
    if (i === 0) {
      ctx.fillStyle = GREEN + '08';
      ctx.fillRect(40, y - 5, W - 80, 62);
    }
    ctx.font = dm('700', 18);
    ctx.fillStyle = i === 0 ? GOLD_D : MUTED;
    ctx.fillText(String(pl.pos || i + 1), 55, y + 28);
    ctx.font = dm(i === 0 ? '800' : '600', 18);
    ctx.fillStyle = TEXT;
    ctx.fillText(pl.name || '', 100, y + 28);
    if (pl.flag) { ctx.font = dm('400', 11); ctx.fillStyle = MUTED; ctx.fillText(pl.flag, 100, y + 46); }

    var sc = !pl.today ? MUTED : (pl.today + '').startsWith('+') ? RED : (pl.today + '') === 'E' ? MUTED : GREEN;
    ctx.font = dm('700', 16); ctx.fillStyle = sc; ctx.textAlign = 'center';
    ctx.fillText(pl.today || '', 800, y + 28);

    var tc2 = !pl.total ? MUTED : (pl.total + '').startsWith('+') ? RED : (pl.total + '') === 'E' ? MUTED : GREEN;
    ctx.font = dm('900', 20); ctx.fillStyle = tc2; ctx.textAlign = 'right';
    ctx.fillText(pl.total || '', 1010, y + 28);
    ctx.textAlign = 'left';

    if (i < players.length - 1 && i < 9) {
      ctx.fillStyle = BORDER;
      ctx.fillRect(50, y + 58, W - 100, 1);
    }
  });

  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ BETTING PICK CARD (1080x1080) ━━━
function buildPick(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  drawLogo(ctx, 50, 52, 22);

  var label = (p.label || 'BEST BET').toUpperCase();
  var lc = label === 'LONGSHOT' ? GOLD_D : label.includes('VALUE') ? GREEN_L : label === 'FADE' ? RED : GREEN;

  // Label badge
  ctx.font = dm('800', 14);
  var lw = ctx.measureText(label).width;
  ctx.fillStyle = lc;
  ctx.beginPath(); ctx.roundRect(50, 100, lw + 24, 30, 4); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, 62, 121);

  // Player name
  ctx.font = pf('900', 44);
  ctx.fillStyle = TEXT;
  ctx.fillText(p.player || '', 50, 220);

  // Odds
  ctx.font = dm('900', 60);
  ctx.fillStyle = GREEN;
  ctx.fillText(p.odds || '', 50, 300);

  // Reasoning
  if (p.reasoning) {
    ctx.fillStyle = DIM;
    fitText(ctx, p.reasoning, 50, 360, W - 100, 200, 16, '500', 'dm');
  }

  // Confidence dots
  if (p.confidence) {
    ctx.font = dm('700', 11); ctx.fillStyle = MUTED; ctx.fillText('CONFIDENCE', 50, 610);
    var conf = parseInt(p.confidence) || 0;
    for (var i = 0; i < 10; i++) {
      ctx.beginPath(); ctx.arc(65 + i * 28, 640, 9, 0, Math.PI * 2);
      ctx.fillStyle = i < conf ? GREEN : BORDER; ctx.fill();
    }
  }

  // Gold line
  ctx.fillStyle = GOLD;
  ctx.fillRect(50, H - 100, 120, 3);

  ctx.font = dm('600', 12); ctx.fillStyle = MUTED;
  ctx.fillText((p.tournament || '').toUpperCase(), 50, H - 60);

  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ BREAKING NEWS (1080x1080) ━━━
function buildBreaking(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Red top bar
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, 5);

  drawLogo(ctx, 50, 52, 22);

  // BREAKING badge
  ctx.font = dm('900', 16);
  var bw = ctx.measureText('BREAKING').width;
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.roundRect(50, 100, bw + 24, 32, 4); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText('BREAKING', 62, 123);

  // Headline
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'left';
  var endY = fitText(ctx, (p.headline || '').toUpperCase(), 50, 240, W - 100, 400, 44, '800', 'pf');

  // Gold line
  ctx.fillStyle = GOLD;
  ctx.fillRect(50, endY + 24, 140, 3);

  if (p.context) {
    ctx.font = dm('600', 16); ctx.fillStyle = DIM;
    ctx.fillText((p.context || '').toUpperCase(), 50, endY + 55);
  }

  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ WINNER / CHAMPION (1080x1080) ━━━
function buildWinner(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, W, 5);

  drawLogo(ctx, 50, 52, 22);

  ctx.textAlign = 'center';
  ctx.font = dm('700', 14); ctx.fillStyle = GOLD_D;
  ctx.fillText('C H A M P I O N', W / 2, 300);

  ctx.font = pf('900', 52); ctx.fillStyle = TEXT;
  ctx.fillText(p.player || '', W / 2, 400);

  ctx.font = dm('900', 48); ctx.fillStyle = GREEN;
  ctx.fillText(p.score || '', W / 2, 475);

  ctx.font = dm('700', 18); ctx.fillStyle = DIM;
  ctx.fillText((p.tournament || '').toUpperCase(), W / 2, 530);

  ctx.fillStyle = GOLD;
  ctx.fillRect(W / 2 - 60, 555, 120, 3);

  ctx.textAlign = 'left';
  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ STAT CARD (1080x1080) ━━━
function buildStat(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  drawLogo(ctx, 50, 52, 22);

  ctx.textAlign = 'center';
  ctx.font = pf('900', 110); ctx.fillStyle = TEXT;
  ctx.fillText(p.number || '', W / 2, 420);

  ctx.font = dm('700', 22); ctx.fillStyle = GOLD_D;
  ctx.fillText((p.label || '').toUpperCase(), W / 2, 470);

  ctx.font = pf('700', 24); ctx.fillStyle = TEXT;
  ctx.fillText(p.player || '', W / 2, 540);

  ctx.font = dm('500', 14); ctx.fillStyle = MUTED;
  ctx.fillText(p.context || '', W / 2, 575);

  ctx.fillStyle = GOLD;
  ctx.fillRect(W / 2 - 60, 600, 120, 3);

  ctx.textAlign = 'left';
  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ QUOTE (1080x1080) ━━━
function buildQuote(p) {
  var W = 1080, H = 1080;
  var c = createCanvas(W, H), ctx = c.getContext('2d');

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 4);

  drawLogo(ctx, 50, 52, 22);

  // Quote mark
  ctx.font = pf('800', 100); ctx.fillStyle = GOLD + '40';
  ctx.fillText('\u201C', 40, 230);

  // Quote text — max 6 words for tweet images
  var quoteText = p.quote || '';
  if (quoteText.length > 45) quoteText = quoteText.split(/\s+/).slice(0, 6).join(' ');

  ctx.fillStyle = TEXT;
  var endY = fitText(ctx, quoteText, 60, 290, W - 120, 350, 40, '700', 'pf');

  // Gold line
  ctx.fillStyle = GOLD;
  ctx.fillRect(60, endY + 20, 120, 3);

  // Attribution
  if (p.player) {
    ctx.font = dm('800', 18); ctx.fillStyle = TEXT;
    ctx.fillText((p.player || '').toUpperCase(), 60, endY + 55);
  }
  if (p.context) {
    ctx.font = dm('500', 13); ctx.fillStyle = MUTED;
    ctx.fillText(p.context || '', 60, endY + 78);
  }

  drawWatermark(ctx, W, H);
  return c.toBuffer('image/png');
}

// ━━━ HANDLER ━━━
exports.handler = async (event) => {
  var p = event.queryStringParameters || {};
  var type = p.type || 'headline';
  var buf;

  switch (type) {
    case 'leaderboard': buf = buildLeaderboard(p); break;
    case 'pick': buf = buildPick(p); break;
    case 'stat': buf = buildStat(p); break;
    case 'article_header': buf = buildArticleHeader(p); break;
    case 'headline': buf = buildArticleHeader(p); break;
    case 'breaking': buf = buildBreaking(p); break;
    case 'hot_take': buf = buildTweet(p); break;
    case 'quote': buf = buildQuote(p); break;
    case 'winner': buf = buildWinner(p); break;
    default: buf = buildArticleHeader(p);
  }

  if (!buf) buf = buildTweet({ headline: 'TourFeed', tag: 'NEWS' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
