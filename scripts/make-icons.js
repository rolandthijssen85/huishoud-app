// Maakt de app-iconen (groen vlak met een wit huisje) zonder extra pakketten.
// Gebruik: node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const green = [47, 125, 91], white = [255, 255, 255];
  const s = size / 100; // tekenen op een raster van 100x100
  const inHouse = (x, y) => {
    // dak: driehoek van (20,50) naar (50,22) naar (80,50)
    const roof = y >= 22 && y <= 50 && Math.abs(x - 50) <= (y - 22) * (30 / 28);
    const body = x >= 30 && x <= 70 && y >= 48 && y <= 78;
    const door = x >= 44 && x <= 56 && y >= 60 && y <= 78;
    return (roof || body) && !door;
  };
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      const c = inHouse((px + 0.5) / s, (py + 0.5) / s) ? white : green;
      row.set(c, 1 + px * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), icon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), icon(512));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), icon(180));
console.log('Iconen gemaakt in', dir);
