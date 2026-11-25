// The World in One Image — Wednesday 25 November 2026
// An original, dependency-free Node program that draws a complete
// broadsheet front page, pixel by pixel, and encodes it as one
// 1024 x 1024 PNG. Standard library only. Fully deterministic:
// no Date, no Math.random, no network, no external assets.
//
// Architecture:
//   1. A small software rasterizer over an RGB framebuffer
//      (rectangles, lines, circles, ellipses, polygons, stars).
//   2. A hand-authored 5x7 bitmap font, defined as string data below,
//      with measuring, word-wrap and multi-scale text layout.
//   3. Scene illustrations built from the rasterizer primitives:
//      a falling-chart skyline for the lead, one pictogram per panel.
//   4. A from-scratch PNG writer (CRC32 + zlib deflate, fixed settings).
//
// Run:  MAKEFUN_OUTPUT_DIR=<dir> node main.ts   ->  <dir>/entry.png

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Canvas and palette — warm paper, navy masthead, gold rules, red signals
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;

const PAPER = [250, 247, 238];   // warm sheet white
const PANEL = [241, 237, 227];   // panel fill
const PANEL2 = [245, 242, 233];  // lighter panel fill
const NAVY = [15, 31, 57];       // masthead navy
const NAVY2 = [10, 21, 40];      // deep navy (scene sky, tag boxes)
const INK = [18, 20, 24];        // near-black type
const GREY = [86, 88, 94];       // secondary type
const FAINT = [178, 172, 160];   // hairlines
const RED = [178, 24, 32];       // signal / down red
const GOLD = [186, 138, 32];     // ochre accent
const BLUE = [28, 64, 128];      // wire blue accent
const TEAL = [16, 110, 100];     // health teal accent
const SAND = [214, 164, 120];    // pictogram tone

const fb = new Uint8Array(W * H * 3);

function setPx(x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
}
function blendPx(x, y, c, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = Math.round(fb[i] * (1 - a) + c[0] * a);
  fb[i + 1] = Math.round(fb[i + 1] * (1 - a) + c[1] * a);
  fb[i + 2] = Math.round(fb[i + 2] * (1 - a) + c[2] * a);
}
function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
}
function strokeRect(x, y, w, h, t, c) {
  fillRect(x, y, w, t, c); fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c); fillRect(x + w - t, y, t, h, c);
}
function drawLine(x0, y0, x1, y1, t, c) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = Math.max(0, (t - 1) / 2);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + (dx * s) / steps, y = y0 + (dy * s) / steps;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) setPx(x + ox, y + oy, c);
  }
}
function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) setPx(cx + x, cy + y, c);
}
function ringCircle(cx, cy, r, t, c) {
  for (let y = -r - t; y <= r + t; y++) for (let x = -r - t; x <= r + t; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d >= r - t / 2 && d <= r + t / 2) setPx(cx + x, cy + y, c);
  }
}
function fillEllipse(cx, cy, rx, ry, c) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPx(cx + x, cy + y, c);
}
function fillPoly(pts, c) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const n = pts.length;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) setPx(x, y, c);
  }
}
function fillStar(cx, cy, rOuter, rInner, c, rot) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (rot || 0) + (i * Math.PI) / 5 - Math.PI / 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  fillPoly(pts, c);
}

// ---------------------------------------------------------------------------
// Hand-authored 5x7 bitmap font. Each glyph is 7 rows of 5 pixels,
// '#' for ink. Text is always laid out in upper case.
// ---------------------------------------------------------------------------

const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".#...", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."],
  "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["##..#", "##.#.", "....#", "...#.", "..#..", ".#...", "#.##."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "(": ["...##", "..#..", ".#...", ".#...", ".#...", "..#..", "...##"],
  ")": [".##..", "..#..", "...#.", "...#.", "...#.", "..#..", ".##.."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function glyph(ch) {
  return FONT[ch] || FONT["?"];
}
function textWidth(str, scale) {
  if (str.length === 0) return 0;
  return str.length * 6 * scale - scale;
}
function drawText(x, y, str, scale, c) {
  const s = String(str).toUpperCase();
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (g[row][col] === "#")
          fillRect(cx + col * scale, y + row * scale, scale, scale, c);
    cx += 6 * scale;
  }
  return cx - scale;
}
function drawTextCentered(cx, y, str, scale, c) {
  return drawText(cx - textWidth(str, scale) / 2, y, str, scale, c);
}
function drawTextRight(xRight, y, str, scale, c) {
  return drawText(xRight - textWidth(str, scale), y, str, scale, c);
}
function wrapLines(str, scale, maxWidth) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxWidth || cur === "") cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
// Draws wrapped text; returns the y just below the last line.
function drawPara(x, y, str, scale, c, maxWidth, lineGap) {
  const lines = wrapLines(str, scale, maxWidth);
  const lh = 7 * scale + (lineGap || 0);
  lines.forEach((ln, i) => drawText(x, y + i * lh, ln, scale, c));
  return y + lines.length * lh;
}

// ---------------------------------------------------------------------------
// PNG writer — CRC32 table, IHDR/IDAT/IEND, filter byte 0 per scanline,
// zlib deflate at a fixed level so every run writes the same bytes.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 3, dst = row + 1 + x * 3;
      raw[dst] = fb[src]; raw[dst + 1] = fb[src + 1]; raw[dst + 2] = fb[src + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Illustrations
// ---------------------------------------------------------------------------

// Lead scene: an Asian skyline at night under a plunging red index line —
// Wednesday morning's market rout. Drawn inside box (x, y, w, h).
function drawLeadScene(x, y, w, h) {
  fillRect(x, y, w, h, NAVY2);                               // night sky
  for (let gx = x + 28; gx < x + w - 8; gx += 28)            // chart grid
    for (let gy = y + 10; gy < y + h - 40; gy++)
      if (gy % 2 === 0) blendPx(gx, gy, [120, 140, 180], 0.25);
  for (let gy = y + 30; gy < y + h - 44; gy += 28)
    for (let gx = x + 8; gx < x + w - 8; gx++)
      if (gx % 2 === 0) blendPx(gx, gy, [120, 140, 180], 0.25);
  const base = y + h - 34;
  const towers = [                                           // [dx, width, height]
    [6, 30, 74], [42, 22, 118], [70, 34, 62], [110, 20, 138],
    [136, 30, 92], [172, 22, 122], [200, 34, 70], [240, 20, 108],
    [266, 28, 84], [300, 22, 128],
  ];
  for (const [dx, tw, th] of towers) {
    fillRect(x + dx, base - th, tw, th, [6, 12, 24]);
    for (let wy = base - th + 8; wy < base - 6; wy += 12)    // lit windows
      for (let wx = x + dx + 4; wx < x + dx + tw - 4; wx += 8)
        if ((wx * 5 + wy * 11) % 4 !== 0) fillRect(wx, wy, 3, 5, [240, 196, 92]);
  }
  fillRect(x, base, w, 3, GOLD);                             // waterfront line
  // The plunge: a jagged red line falling across the whole scene
  const pts = [
    [x + 14, y + 26], [x + 62, y + 40], [x + 104, y + 34], [x + 148, y + 66],
    [x + 192, y + 60], [x + 232, y + 102], [x + 272, y + 96], [x + 312, y + 142],
  ];
  for (let i = 0; i + 1 < pts.length; i++)
    drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 5, RED);
  for (const p of pts) fillCircle(p[0], p[1], 5, RED);
  const ex = pts[pts.length - 1][0], ey = pts[pts.length - 1][1];
  fillPoly([[ex - 4, ey - 14], [ex + 16, ey + 2], [ex - 12, ey + 8]], RED); // arrowhead
  fillRect(x + 12, y + h - 78, 176, 46, NAVY2);              // figure callout plate
  strokeRect(x + 12, y + h - 78, 176, 46, 1, RED);
  drawText(x + 26, y + h - 70, "-5.3%", 5, RED);
  drawTextRight(x + w - 12, y + h - 24, "SEOUL - THE KOSPI LED THE FALL", 1, [226, 230, 238]);
}

// Pictogram: a drone over rooftops — the Ukraine strikes.
function iconDrone(x, y) {
  fillRect(x + 4, y + 38, 14, 10, GREY); fillRect(x + 24, y + 34, 18, 14, GREY);
  fillRect(x + 46, y + 40, 10, 8, GREY);
  drawLine(x + 16, y + 22, x + 40, y + 22, 3, INK);          // drone body bar
  fillCircle(x + 28, y + 22, 4, INK);
  drawLine(x + 16, y + 22, x + 8, y + 12, 2, INK);
  drawLine(x + 40, y + 22, x + 48, y + 12, 2, INK);
  ringCircle(x + 6, y + 10, 6, 2, INK); ringCircle(x + 50, y + 10, 6, 2, INK);
  drawLine(x + 28, y + 26, x + 28, y + 32, 2, RED);
  fillStar(x + 28, y + 36, 5, 2, RED, 0);
}
// Pictogram: a shield with a keyhole — the CIA breach.
function iconShield(x, y) {
  fillPoly([[x + 28, y], [x + 50, y + 8], [x + 50, y + 26], [x + 42, y + 42],
            [x + 28, y + 50], [x + 14, y + 42], [x + 6, y + 26], [x + 6, y + 8]], BLUE);
  fillCircle(x + 28, y + 20, 6, PAPER);
  fillRect(x + 25, y + 22, 6, 12, PAPER);
  drawLine(x + 12, y + 44, x + 20, y + 36, 2, RED);          // crack
  drawLine(x + 20, y + 36, x + 17, y + 30, 2, RED);
}
// Pictogram: a hospital block with a cross — Congo Ebola.
function iconHospital(x, y) {
  fillRect(x + 8, y + 8, 30, 40, GREY);
  fillRect(x + 18, y + 0, 10, 8, GREY);
  fillRect(x + 20, y + 14, 6, 18, RED); fillRect(x + 14, y + 20, 18, 6, RED);
  for (let i = 0; i < 3; i++) fillRect(x + 12 + i * 9, y + 38, 5, 5, [240, 196, 92]);
  fillPoly([[x + 38, y + 48], [x + 48, y + 34], [x + 58, y + 48]], TEAL); // tent
  drawLine(x + 48, y + 34, x + 48, y + 48, 2, TEAL);
}
// Pictogram: a port crane with containers — the tariff probe.
function iconCrane(x, y) {
  drawLine(x + 10, y + 48, x + 10, y + 4, 4, INK);           // mast
  drawLine(x + 10, y + 6, x + 54, y + 6, 4, GOLD);           // jib
  drawLine(x + 10, y + 16, x + 40, y + 6, 2, INK);           // brace
  drawLine(x + 44, y + 6, x + 44, y + 18, 2, INK);           // cable
  fillRect(x + 36, y + 18, 16, 10, RED);                     // hanging container
  fillRect(x + 4, y + 36, 20, 12, BLUE);                     // stacked containers
  fillRect(x + 26, y + 36, 20, 12, TEAL);
  fillRect(x + 15, y + 26, 20, 10, GOLD);
}
// Pictogram: a columned hall under a star — Shanghai politics.
function iconHall(x, y) {
  fillStar(x + 28, y + 5, 6, 3, RED, 0);
  fillPoly([[x + 4, y + 22], [x + 28, y + 12], [x + 52, y + 22]], INK); // pediment
  fillRect(x + 6, y + 24, 44, 3, INK);
  for (let i = 0; i < 4; i++) fillRect(x + 9 + i * 12, y + 29, 5, 14, GREY);
  fillRect(x + 4, y + 45, 48, 4, INK);
}
// Pictogram: a tanker on waves — Hormuz oil.
function iconTanker(x, y) {
  fillPoly([[x + 2, y + 26], [x + 54, y + 26], [x + 48, y + 36], [x + 10, y + 36]], INK); // hull
  fillRect(x + 10, y + 18, 26, 8, RED);                      // deck tanks
  fillRect(x + 40, y + 12, 8, 14, GREY);                     // bridge
  fillRect(x + 14, y + 12, 4, 6, GOLD);
  for (let i = 0; i < 4; i++) {                              // waves
    drawLine(x + 2 + i * 14, y + 44, x + 8 + i * 14, y + 41, 2, BLUE);
    drawLine(x + 8 + i * 14, y + 41, x + 14 + i * 14, y + 44, 2, BLUE);
  }
}

// ---------------------------------------------------------------------------
// Page composition — a broadsheet "morning ledger": navy masthead with
// gold rules, one lead story with a drawn scene, a black markets band,
// six story panels and a two-line wire ticker.
// ---------------------------------------------------------------------------

function panel(x, y, w, h, accent, kicker, headline, body, icon) {
  fillRect(x, y, w, h, PANEL2);
  fillRect(x, y, w, 4, accent);
  strokeRect(x, y, w, h, 1, FAINT);
  drawText(x + 14, y + 12, kicker, 1, accent);
  icon(x + w - 64, y + 10);
  drawPara(x + 14, y + 27, headline, 2, INK, 208, 4);
  drawPara(x + 14, y + 74, body, 2, GREY, 272, 2);
}

function compose() {
  fillRect(0, 0, W, H, PAPER);
  strokeRect(20, 20, W - 40, H - 40, 3, NAVY);
  strokeRect(27, 27, W - 54, H - 54, 1, NAVY);

  // Masthead
  fillRect(36, 36, W - 72, 106, NAVY);
  fillRect(36, 138, W - 72, 4, GOLD);
  drawTextCentered(W / 2, 52, "THE WORLD IN ONE IMAGE", 6, PAPER);
  fillRect(52, 100, 110, 24, NAVY2);
  drawText(66, 105, "MORNING", 2, GOLD);
  fillRect(W - 162, 100, 110, 24, NAVY2);
  drawText(W - 148, 105, "EDITION", 2, GOLD);
  drawTextCentered(W / 2, 103, "WEDNESDAY 25 NOVEMBER 2026", 3, PAPER);
  drawText(48, 152, "SOURCES: REUTERS - AP - BBC - CNN", 1, GREY);
  drawTextRight(W - 48, 152, "ONE PAGE - THE WHOLE DAY - NO PHOTOGRAPHS", 1, GREY);
  fillRect(48, 166, W - 96, 2, INK);

  // Lead story
  drawText(48, 180, "LEAD - MARKETS - WEDNESDAY MORNING IN ASIA", 2, RED);
  drawPara(48, 202, "ASIA STOCKS TUMBLE AS TARIFF THREATS LAND", 5, INK, 556, 8);
  drawPara(48, 344,
    "Shares slid across Asia on Wednesday as Washington readied new " +
    "tariffs and the AI rebound ran out of steam. Seoul sank 5.3% and " +
    "Taipei 5.1%. Nvidia fell 5.9% as the rally over Jensen Huang's " +
    "return faded.",
    2, GREY, 556, 4);
  drawLeadScene(628, 180, 348, 252);
  drawText(628, 440, "THE PLUNGE, DRAWN FROM THE WIRE FIGURES", 1, GREY);
  fillRect(48, 440, 556, 2, FAINT);

  // Markets band
  fillRect(48, 460, W - 96, 76, INK);
  drawText(64, 472, "MARKETS", 2, [240, 170, 90]);
  drawText(176, 472, "KOSPI -5.3% - TAIWAN -5.1% - NIKKEI -2.9% - MSCI APAC -2.3%", 2, PAPER);
  drawText(64, 500, "NVIDIA -5.9% - BRENT $90.97 - WTI $81.58 - BTC $59,258 - DOLLAR IDX 103.85", 2, PAPER);
  drawText(64, 522, "CLOSING FIGURES AS REPORTED WEDNESDAY MORNING", 1, [150, 152, 158]);

  // Six more stories
  drawText(48, 552, "THE DAY IN SIX MORE STORIES", 2, NAVY);
  fillRect(48, 572, W - 96, 1, FAINT);
  const pw = 300, ph = 168, gap = 14;
  const x0 = 48, y1 = 580, y2 = 760;
  panel(x0, y1, pw, ph, RED, "ODESA + KYIV - UKRAINE",
    "NIGHT STRIKES HIT ODESA AND KYIV",
    "A Russian strike killed two in the Odesa region. Drones set a Kyiv tower block ablaze, wounding two.",
    iconDrone);
  panel(x0 + pw + gap, y1, pw, ph, BLUE, "LANGLEY - UNITED STATES",
    "CYBERATTACK HITS CIA SYSTEM",
    "A cyberattack breached an unclassified CIA system, an AP source said. CNN said the ODNI was hit too.",
    iconShield);
  panel(x0 + 2 * (pw + gap), y1, pw, ph, TEAL, "ITURI - DR CONGO",
    "WHO QUITS CONGO EBOLA HOSPITAL",
    "WHO teams quit a hospital in Akwe, Ituri after 3 days amid fighting. Ebola toll: 5,775 dead.",
    iconHospital);
  panel(x0, y2, pw, ph, GOLD, "WASHINGTON - TRADE",
    "US READIES NEW TARIFF FINDINGS",
    "Washington is set to publish its Section 301 probe into excess capacity in 16 partners. Duties loom.",
    iconCrane);
  panel(x0 + pw + gap, y2, pw, ph, RED, "SHANGHAI - CHINA",
    "SHANGHAI BACKS BEIJING",
    "Shanghai's leaders rallied behind Beijing a day after Politburo member Chen Jining was put under probe.",
    iconHall);
  panel(x0 + 2 * (pw + gap), y2, pw, ph, BLUE, "HORMUZ - ENERGY",
    "OIL SLIPS: GLUT BEATS HORMUZ FEAR",
    "Brent eased to $90.97: a supply glut outweighed ship attacks near Hormuz. OPEC+ meets 29 Nov.",
    iconTanker);

  // Wire ticker
  fillRect(48, 934, W - 96, 1, FAINT);
  drawText(48, 942, "US DATA DAY: CORE PCE + Q3 GDP DUE - 97% ODDS PRICED ON A DECEMBER FED HIKE", 2, INK);
  drawText(48, 964, "ARMY TO BLOW UP IOWA CHEMICAL STOCKPILE - HUAWEI GUILTY IN US SECRETS TRIAL", 2, INK);
  drawTextCentered(W / 2, 984, "DRAWN BY A PROGRAM - NO PHOTOGRAPHS - WEDNESDAY 25 NOVEMBER 2026", 1, GREY);
}

compose();
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, "entry.png"), png);
console.log("wrote", join(outDir, "entry.png"), png.length, "bytes");
