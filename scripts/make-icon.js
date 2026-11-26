'use strict';
// Generates icon.png (128x128) and images/screenshot.png (1400x900) for ISO 20022 Payment Viewer.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function writePng(filePath, W, H, px) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeCanvas(W, H) {
  const px = Buffer.alloc(W * H * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const k = a / 255;
    px[i] = Math.round(px[i] * (1 - k) + r * k);
    px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k);
    px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k);
    px[i + 3] = Math.max(px[i + 3], a);
  };
  const rect = (x0, y0, w, h, col, r = 3, a = 255) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x0 + w - 1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y0 + h - 1 - r));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r) set(x, y, col, d > r - 1 ? Math.round(a * (r - d)) : a);
    }
  };
  return { px, set, rect };
}

// 1. Icon (128x128): Deep indigo-slate ISO 20022 XML payment ledger badge
{
  const W = 128, H = 128, R = 22;
  const { px, set, rect } = makeCanvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.max(R - x, 0, x - (W - 1 - R)), dy = Math.max(R - y, 0, y - (H - 1 - R));
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= R) set(x, y, mix(hex('#172554'), hex('#0F172A'), y / H), d > R - 1 ? Math.round(255 * (R - d)) : 255);
  }
  // GrpHdr banner
  rect(14, 15, 100, 16, hex('#2563EB'), 4);
  rect(20, 20, 40, 6, hex('#DBEAFE'), 2);
  rect(84, 20, 24, 6, hex('#34D399'), 2);
  // Payment rows (Debtor -> Creditor IBAN + Amount)
  rect(14, 38, 100, 18, hex('#1E293B'), 4);
  rect(20, 44, 18, 6, hex('#38BDF8'), 2);
  rect(42, 44, 38, 6, hex('#CBD5E1'), 2);
  rect(86, 44, 22, 6, hex('#10B981'), 2);

  rect(14, 61, 100, 18, hex('#1E293B'), 4);
  rect(20, 67, 18, 6, hex('#818CF8'), 2);
  rect(42, 67, 34, 6, hex('#CBD5E1'), 2);
  rect(86, 67, 22, 6, hex('#10B981'), 2);

  rect(14, 84, 100, 18, hex('#1E293B'), 4);
  rect(20, 90, 18, 6, hex('#38BDF8'), 2);
  rect(42, 90, 40, 6, hex('#CBD5E1'), 2);
  rect(86, 90, 22, 6, hex('#10B981'), 2);

  // CtrlSum verification bar
  rect(14, 107, 100, 9, hex('#059669'), 3);
  writePng(path.join(__dirname, '..', 'icon.png'), W, H, px);
}

// 2. Screenshot preview (1400x900)
{
  const W = 1400, H = 900;
  const { px, rect } = makeCanvas(W, H);
  rect(0, 0, W, H, hex('#1E1E1E'), 0);
  rect(0, 0, W, 44, hex('#252526'), 0);
  rect(16, 12, 260, 20, hex('#3B82F6'), 4);
  rect(290, 14, 240, 16, hex('#475569'), 3);
  // Summary chips
  for (let i = 0; i < 4; i++) rect(16 + i * 170, 58, 155, 24, i === 3 ? hex('#15803D') : hex('#334155'), 10);
  // Toolbar
  rect(16, 94, 340, 28, hex('#2D2D30'), 3);
  rect(368, 94, 145, 28, hex('#2D2D30'), 3);
  rect(525, 94, 145, 28, hex('#2D2D30'), 3);
  rect(682, 94, 80, 28, hex('#0E639C'), 3);
  rect(780, 94, 180, 28, hex('#2563EB'), 3);
  rect(972, 94, 180, 28, hex('#2563EB'), 3);
  // Left payment table pane
  rect(16, 140, 880, 720, hex('#151B28'), 4);
  rect(16, 140, 880, 34, hex('#1E293B'), 2);
  for (let r = 0; r < 14; r++) {
    const y = 184 + r * 46;
    rect(24, y, 864, 38, r === 1 ? hex('#1E3A5F') : (r % 2 === 0 ? hex('#1A2233') : hex('#151B28')), 2);
    rect(34, y + 13, 30, 12, hex('#94A3B8'), 2);
    rect(78, y + 13, 130, 12, hex('#60A5FA'), 2);
    rect(224, y + 13, 46, 12, r % 3 === 0 ? hex('#F59E0B') : hex('#10B981'), 2);
    rect(286, y + 13, 100, 12, hex('#34D399'), 2);
    rect(404, y + 13, 160, 12, hex('#CBD5E1'), 2);
    rect(580, y + 13, 180, 12, hex('#E2E8F0'), 2);
    rect(776, y + 13, 96, 12, hex('#94A3B8'), 2);
  }
  // Right transaction detail inspector pane
  rect(912, 140, 472, 720, hex('#151B28'), 4);
  rect(912, 140, 472, 34, hex('#1E293B'), 2);
  for (let r = 0; r < 15; r++) {
    const y = 188 + r * 42;
    rect(928, y, 115, 14, hex('#60A5FA'), 2);
    rect(1058, y, 300, 14, r === 13 ? hex('#10B981') : hex('#E2E8F0'), 2);
  }
  fs.mkdirSync(path.join(__dirname, '..', 'images'), { recursive: true });
  writePng(path.join(__dirname, '..', 'images', 'screenshot.png'), W, H, px);
}
console.log('Generated icon.png and images/screenshot.png');
