'use strict';

// Dependency-free PNG icon generator for Autoveda's app + tray icons.
// Draws a rounded-square "play" mark (automation: press once, it runs) and writes:
//   assets/icon.png  (1024x1024)  -> electron-builder derives .ico/.icns/.png
//   assets/tray.png  (32x32)      -> system-tray icon
//
// Placeholder branding for M0; replace assets/*.png anytime and re-run `npm run gen:icons`.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- geometry, in normalized [0,1] space ---
function sign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function inRoundRect(x, y, margin, rad) {
  const x0 = margin,
    y0 = margin,
    x1 = 1 - margin,
    y1 = 1 - margin;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  const dx = x - cx,
    dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function inTriangle(px, py) {
  // right-pointing "play" triangle
  const ax = 0.4,
    ay = 0.3,
    bx = 0.4,
    by = 0.7,
    cx = 0.72,
    cy = 0.5;
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function drawColor(u, v) {
  if (!inRoundRect(u, v, 0.06, 0.22)) return [0, 0, 0, 0];
  if (inTriangle(u, v)) return [255, 255, 255, 255];
  // vertical indigo gradient
  const t = v;
  return [
    Math.round(129 + (79 - 129) * t),
    Math.round(140 + (70 - 140) * t),
    Math.round(248 + (229 - 248) * t),
    255,
  ];
}

// Supersample for clean anti-aliased edges.
function renderRGBA(size, ss) {
  const buf = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const c = drawColor(u, v);
          // premultiply by alpha so transparent edges blend correctly
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const off = (y * size + x) * 4;
      if (a > 0) {
        buf[off] = Math.round(r / a);
        buf[off + 1] = Math.round(g / a);
        buf[off + 2] = Math.round(b / a);
      }
      buf[off + 3] = Math.round(a / n);
    }
  }
  return buf;
}

// --- minimal PNG encoder (RGBA, 8-bit, no palette) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
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
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const rowSize = size * 4;
  const raw = Buffer.alloc((rowSize + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowSize + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowSize + 1) + 1, y * rowSize, y * rowSize + rowSize);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcon(file, size, ss) {
  const png = encodePng(size, renderRGBA(size, ss));
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size}, ${png.length} bytes)`);
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
writeIcon(path.join(assetsDir, 'icon.png'), 1024, 3);
writeIcon(path.join(assetsDir, 'tray.png'), 32, 8);
