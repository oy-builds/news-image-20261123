// The World Today — 23 November 2026.
// A make.fun news-image entry: draws one newspaper-style front page that sums
// up the day's world news, entirely in code (own rasteriser, own 5x7 pixel
// font, own PNG encoder, Node standard library only), and writes it to
// /output/entry.png (MAKEFUN_OUTPUT_DIR stands in for /output locally).
// The render is pure computation on fixed inputs, so every run writes
// byte-identical bytes.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- canvas

type Rgb = [number, number, number];

const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

function setPx(x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: Rgb): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
}

function frame(x: number, y: number, w: number, h: number, t: number, c: Rgb): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

function circle(cx: number, cy: number, r: number, c: Rgb): void {
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) setPx(xx, yy, c);
    }
  }
}

function tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: Rgb): void {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x1, x2, x3)));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y1, y2, y3)));
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  if (d === 0) return;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const a = ((y2 - y3) * (xx - x3) + (x3 - x2) * (yy - y3)) / d;
      const b = ((y3 - y1) * (xx - x3) + (x1 - x3) * (yy - y3)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) setPx(xx, yy, c);
    }
  }
}

function line(x1: number, y1: number, x2: number, y2: number, t: number, c: Rgb): void {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  const r = Math.max(1, Math.round(t / 2));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + ((x2 - x1) * i) / steps);
    const y = Math.round(y1 + ((y2 - y1) * i) / steps);
    circle(x, y, r, c);
  }
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows of 5 pixels, '#' = ink. Written out by hand for this
// entry; text is drawn in capitals, newspaper style.

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01111', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : text.length * 6 * scale - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: Rgb, align: 'left' | 'center' | 'right' = 'left'): void {
  let startX = x;
  if (align === 'center') startX = Math.round(x - textWidth(text, scale) / 2);
  if (align === 'right') startX = x - textWidth(text, scale);
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i].toUpperCase()] ?? FONT[' '];
    const gx = startX + i * 6 * scale;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') rect(gx + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}

function drawLines(lines: string[], x: number, y: number, scale: number, lineHeight: number, c: Rgb): void {
  lines.forEach((ln, i) => drawText(ln, x, y + i * lineHeight, scale, c));
}

// ---------------------------------------------------------------- the page

const PAPER: Rgb = [246, 241, 227];
const INK: Rgb = [20, 22, 26];
const RED: Rgb = [179, 53, 43];
const NAVY: Rgb = [29, 42, 68];
const GREY: Rgb = [107, 111, 118];
const SMOKE: Rgb = [154, 160, 166];
const PALE_SKY: Rgb = [203, 213, 219];
const WALL: Rgb = [188, 183, 170];
const DARK_WALL: Rgb = [138, 133, 120];
const ORANGE: Rgb = [224, 123, 42];
const FLAME_Y: Rgb = [242, 194, 48];
const WHITE: Rgb = [250, 248, 240];
const GOLD: Rgb = [201, 162, 39];
const GREEN: Rgb = [62, 122, 66];
const BLUE: Rgb = [46, 94, 170];

rect(0, 0, W, H, PAPER);
frame(14, 14, W - 28, H - 28, 3, INK);

// Masthead
drawText('THE WORLD TODAY', W / 2, 40, 10, INK, 'center');
drawText('MONDAY, 23 NOVEMBER 2026', W / 2, 124, 3, RED, 'center');
rect(40, 156, W - 80, 5, INK);
rect(40, 165, W - 80, 2, INK);
drawText("THE DAY'S WORLD NEWS, DRAWN IN ONE IMAGE", W / 2, 176, 2, GREY, 'center');

// ---------------------------------------------------------------- lead story
// Ukraine: death toll in the Dymer apartment-block strike reaches 11.

drawText('UKRAINE - KYIV REGION', 40, 202, 3, RED);
drawText('STRIKE ON DYMER', 40, 232, 6, INK);
drawText('FLATS KILLS 11', 40, 282, 6, INK);

// Lead illustration: a five-storey block, one end collapsed, rescue crane.
rect(40, 340, 600, 180, PALE_SKY);
frame(40, 340, 600, 180, 2, INK);
rect(40, 492, 600, 28, DARK_WALL); // ground
rect(70, 384, 260, 108, WALL); // standing part of the block
for (let f = 0; f < 5; f++) rect(70, 384 + f * 22, 260, 2, DARK_WALL); // floor lines
for (let f = 0; f < 5; f++) {
  for (let win = 0; win < 6; win++) {
    const lit = (f * 6 + win) % 4 === 0;
    rect(86 + win * 42, 392 + f * 22, 20, 12, lit ? FLAME_Y : NAVY);
  }
}
tri(330, 420, 520, 492, 330, 492, DARK_WALL); // collapsed slope
tri(356, 448, 470, 492, 356, 492, GREY); // rubble layer
tri(392, 470, 452, 492, 392, 492, SMOKE);
line(300, 400, 372, 452, 5, GREY); // fallen slab
circle(430, 374, 24, SMOKE); // smoke
circle(480, 362, 17, SMOKE);
circle(392, 364, 14, [176, 182, 188]);
line(566, 492, 566, 378, 5, INK); // crane mast
line(566, 378, 452, 378, 4, INK); // crane jib
line(470, 378, 470, 424, 2, INK); // cable
rect(458, 424, 24, 12, ORANGE); // lifted load
circle(352, 486, 6, ORANGE); // rescue lights
circle(528, 488, 6, FLAME_Y);

drawLines(
  [
    'RESCUERS SEARCH THE RUBBLE OF A',
    'FIVE-STOREY BLOCK HIT IN AN',
    'OVERNIGHT RUSSIAN STRIKE. THREE',
    'MORE DIE AT A VYSHNEVE',
    'SUPERMARKET. THE KYIV REGION',
    'DECLARES A DAY OF MOURNING.',
  ],
  40, 534, 3, 29, INK,
);

// ---------------------------------------------------------------- Indonesia
// Officials confirm 24 dead in the Banten confectionery factory fire.

drawText('INDONESIA - BANTEN', 664, 202, 2, RED);
drawText('FACTORY FIRE:', 664, 226, 4, INK);
drawText('24 DEAD', 664, 262, 4, INK);
drawText('CONFIRMED', 664, 298, 4, INK);

// Factory illustration: sawtooth roof, chimney, flames along the base.
rect(664, 340, 320, 180, PALE_SKY);
frame(664, 340, 320, 180, 2, INK);
rect(664, 492, 320, 28, DARK_WALL);
rect(692, 428, 208, 64, WALL);
tri(692, 428, 726, 404, 760, 428, DARK_WALL);
tri(760, 428, 794, 404, 828, 428, DARK_WALL);
tri(828, 428, 862, 404, 900, 428, DARK_WALL);
rect(908, 380, 24, 112, DARK_WALL); // chimney
circle(920, 364, 17, SMOKE);
circle(944, 358, 12, SMOKE);
for (let f = 0; f < 4; f++) rect(706 + f * 48, 446, 26, 18, NAVY); // windows
tri(716, 492, 742, 436, 768, 492, RED); // flames
tri(756, 492, 786, 424, 816, 492, ORANGE);
tri(800, 492, 824, 444, 848, 492, RED);
tri(762, 492, 784, 452, 806, 492, FLAME_Y);

drawLines(
  [
    'OFFICIALS CONFIRM 24 DEAD',
    'IN THE WEEKEND BLAZE AT A',
    'CANDY FACTORY IN CIKANDE,',
    'BANTEN. ABOUT 30 PEOPLE',
    'STILL MISSING AS RESCUERS',
    'SEARCH THE RUINED PLANT.',
  ],
  664, 534, 2, 24, INK,
);

// ---------------------------------------------------------------- markets
// The AI sell-off rattles world markets.

rect(40, 716, W - 80, 120, NAVY);
drawText('AI SELL-OFF RATTLES MARKETS', 56, 732, 4, WHITE);
const chart: Array<[number, number]> = [
  [748, 742], [788, 750], [826, 746], [862, 766], [898, 762], [934, 786], [968, 792],
];
for (let i = 0; i + 1 < chart.length; i++) line(chart[i][0], chart[i][1], chart[i + 1][0], chart[i + 1][1], 4, RED);
for (const [cx, cy] of chart) circle(cx, cy, 5, FLAME_Y);
drawText('NIKKEI 225 -5.06% - S&P 500 -3.7% - GOLD +2.72%', 56, 788, 3, FLAME_Y);
drawText('FEARS AI SHARES ARE OVERPRICED SPREAD FROM WALL STREET TO ASIA', 56, 812, 2, WHITE);

// ---------------------------------------------------------------- bottom row
rect(40, 850, W - 80, 2, INK);

// Belgium: airspace shut by the anti-austerity strike.
rect(40, 860, 12, 12, RED);
drawText('BELGIUM', 62, 858, 2, RED);
drawText('SKIES FALL SILENT ON', 40, 878, 3, INK);
drawText('STRIKE DAY', 40, 906, 3, INK);
drawLines(
  ['ATC WALKOUT CANCELS NEARLY ALL', 'FLIGHTS; 59,500 HIT AT BRUSSELS'],
  40, 932, 2, 15, INK,
);

rect(506, 858, 2, 100, GREY);

// Hungary: the prime minister will travel to Ukraine.
rect(524, 860, 12, 12, GREEN);
drawText('HUNGARY', 546, 858, 2, GREEN);
drawText("PM MAGYAR TO VISIT", 524, 878, 3, INK);
drawText("UKRAINE 'SOON'", 524, 906, 3, INK);
drawLines(
  ['ZAKARPATTIA TRIP BACKS HUNGARIAN', 'MINORITY; EU TALKS KEPT APART'],
  524, 932, 2, 15, INK,
);
// Two small flags: Hungary (red-white-green) and Ukraine (blue-yellow).
rect(880, 878, 44, 10, RED);
rect(880, 888, 44, 10, WHITE);
rect(880, 898, 44, 10, GREEN);
frame(880, 878, 44, 30, 1, INK);
rect(932, 878, 44, 15, BLUE);
rect(932, 893, 44, 15, FLAME_Y);
frame(932, 878, 44, 30, 1, INK);

// ---------------------------------------------------------------- footer
rect(40, 968, W - 80, 2, INK);
drawText("ALSO: EUROPE BLOCKS RUSSIA'S SPORT RETURN - SOURCES: REUTERS - AFP - AP", W / 2, 978, 2, GREY, 'center');

// ---------------------------------------------------------------- write out

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePng(W, H, px));
