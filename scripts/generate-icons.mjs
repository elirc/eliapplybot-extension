// Reproducible PNG versions of public/icons/icon.svg; no image dependencies.
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../public/icons/", import.meta.url));
await mkdir(directory, { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) * 128 / size, py = (y + (sy + .5) / 4) * 128 / size;
      const dx = Math.max(24 - px, 0, px - 104), dy = Math.max(24 - py, 0, py - 104);
      if (dx * dx + dy * dy > 24 * 24) continue;
      const glyph = (px >= 38 && px < 52 && py >= 34 && py < 94) || (px >= 52 && ((px < 90 && ((py >= 34 && py < 46) || (py >= 82 && py < 94))) || (px < 79 && py >= 58 && py < 70)));
      const rgba = glyph ? [99, 230, 190, 255] : [20, 42, 57, 255];
      rgba.forEach((value, i) => color[i] += value / 16);
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    color.forEach((value, i) => rows[offset + i] = Math.round(i < 3 && color[3] ? value * 255 / color[3] : value));
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`${directory}/icon${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}
console.log("Generated 16, 32, 48 and 128 px extension icons.");
