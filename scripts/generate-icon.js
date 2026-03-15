// Generate a proper ICO/PNG icon for Pai
// Uses the π mascot design as the app icon
const fs = require('fs');
const path = require('path');

// Create a 256x256 PNG with the Pai π logo
// PNG format: header + IHDR + IDAT (uncompressed) + IEND
// For simplicity, we'll create an SVG and note that for production you'd use sharp/canvas

const size = 256;
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a4a"/>
      <stop offset="100%" stop-color="#0e0e2a"/>
    </linearGradient>
    <linearGradient id="pi" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>

  <!-- Background circle -->
  <circle cx="128" cy="128" r="120" fill="url(#bg)" stroke="#6366f1" stroke-width="4"/>

  <!-- Glow -->
  <circle cx="128" cy="128" r="80" fill="#6366f1" opacity="0.08"/>

  <!-- Pi crossbar (head) -->
  <rect x="52" y="72" width="152" height="56" rx="28" fill="url(#pi)"/>

  <!-- Left leg -->
  <rect x="82" y="100" width="20" height="100" rx="10" fill="url(#pi)"/>

  <!-- Right leg (curved) -->
  <path d="M 152 100 C 152 140, 160 170, 166 200" stroke="url(#pi)" stroke-width="20" stroke-linecap="round" fill="none"/>

  <!-- Left eye -->
  <ellipse cx="100" cy="98" rx="14" ry="13" fill="#0e0e2a"/>
  <circle cx="100" cy="98" r="8" fill="#c7d2fe"/>
  <circle cx="103" cy="95" r="3" fill="white" opacity="0.6"/>

  <!-- Right eye -->
  <ellipse cx="156" cy="98" rx="14" ry="13" fill="#0e0e2a"/>
  <circle cx="156" cy="98" r="8" fill="#c7d2fe"/>
  <circle cx="159" cy="95" r="3" fill="white" opacity="0.6"/>

  <!-- Smile -->
  <path d="M 112 115 Q 128 130 144 115" stroke="#c7d2fe" stroke-width="4" stroke-linecap="round" fill="none"/>

  <!-- Headset band -->
  <path d="M 56 88 C 56 40, 200 40, 200 88" stroke="#4f46e5" stroke-width="6" fill="none" stroke-linecap="round"/>

  <!-- Left earpiece -->
  <rect x="44" y="80" width="14" height="22" rx="7" fill="#4f46e5"/>

  <!-- Right earpiece -->
  <rect x="198" y="80" width="14" height="22" rx="7" fill="#4f46e5"/>

  <!-- Mic -->
  <path d="M 51 102 C 44 112, 60 120, 76 116" stroke="#4f46e5" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="76" cy="116" r="5" fill="#818cf8"/>

  <!-- Antenna glow -->
  <circle cx="128" cy="44" r="6" fill="#818cf8" opacity="0.8"/>
</svg>`;

// Save SVG
const iconDir = path.join(__dirname, '..', 'electron');
fs.writeFileSync(path.join(iconDir, 'icon.svg'), svgIcon);

// Also create a simple HTML to view it
console.log('SVG icon saved to electron/icon.svg');
console.log('Converting to PNG...');

// For the actual icon, we need a PNG. Let's create one via a data URI approach
// We'll save as SVG and use it directly — Electron on Windows needs ICO or PNG

// Create a minimal valid 32x32 PNG with the π shape using raw pixel data
// This is a programmatic approach without external deps

function createPng(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT — raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      rawData[di] = pixels[si];
      rawData[di + 1] = pixels[si + 1];
      rawData[di + 2] = pixels[si + 2];
      rawData[di + 3] = pixels[si + 3];
    }
  }

  // Compress with zlib
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draw a 64x64 icon programmatically
const W = 64;
const pixels = new Uint8Array(W * W * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= W) return;
  x = Math.round(x); y = Math.round(y);
  const i = (y * W + x) * 4;
  // Alpha blend
  const srcA = a / 255;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA > 0) {
    pixels[i] = Math.round((r * srcA + pixels[i] * dstA * (1 - srcA)) / outA);
    pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
    pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
    pixels[i + 3] = Math.round(outA * 255);
  }
}

function fillCircle(cx, cy, r, red, green, blue, alpha = 255) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        const aa = d > r - 1 ? Math.round(alpha * (r - d)) : alpha;
        setPixel(x, y, red, green, blue, Math.max(0, Math.min(255, aa)));
      }
    }
  }
}

function fillRect(x1, y1, w, h, r, g, b, a = 255, radius = 0) {
  for (let y = Math.floor(y1); y < Math.ceil(y1 + h); y++) {
    for (let x = Math.floor(x1); x < Math.ceil(x1 + w); x++) {
      if (radius > 0) {
        // Check corners
        const corners = [
          [x1 + radius, y1 + radius],
          [x1 + w - radius, y1 + radius],
          [x1 + radius, y1 + h - radius],
          [x1 + w - radius, y1 + h - radius],
        ];
        let inside = true;
        for (const [cx, cy] of corners) {
          if ((x < x1 + radius || x > x1 + w - radius) && (y < y1 + radius || y > y1 + h - radius)) {
            const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (d > radius) { inside = false; break; }
          }
        }
        if (!inside) continue;
      }
      setPixel(x, y, r, g, b, a);
    }
  }
}

// Background circle
fillCircle(32, 32, 30, 20, 20, 60, 255);
fillCircle(32, 32, 29, 14, 14, 42, 255);

// Glow
fillCircle(32, 32, 20, 99, 102, 241, 25);

// Pi crossbar
fillRect(12, 18, 40, 14, 99, 102, 241, 255, 7);

// Left leg
fillRect(20, 25, 6, 26, 99, 102, 241, 255, 3);

// Right leg
fillRect(36, 25, 6, 26, 79, 70, 229, 255, 3);

// Left eye
fillCircle(26, 24, 4, 14, 14, 42, 255);
fillCircle(26, 24, 2.5, 165, 180, 252, 255);
fillCircle(27, 23, 1, 255, 255, 255, 120);

// Right eye
fillCircle(38, 24, 4, 14, 14, 42, 255);
fillCircle(38, 24, 2.5, 165, 180, 252, 255);
fillCircle(39, 23, 1, 255, 255, 255, 120);

// Headset band
for (let x = 14; x <= 50; x++) {
  const t = (x - 14) / 36;
  const y = 18 - Math.sin(t * Math.PI) * 8;
  fillCircle(x, y, 1.5, 79, 70, 229, 255);
}

// Earpieces
fillRect(11, 19, 4, 6, 79, 70, 229, 255, 2);
fillRect(49, 19, 4, 6, 79, 70, 229, 255, 2);

const png = createPng(W, W, pixels);
fs.writeFileSync(path.join(iconDir, 'icon.png'), png);
console.log(`PNG icon saved to electron/icon.png (${W}x${W}, ${png.length} bytes)`);
