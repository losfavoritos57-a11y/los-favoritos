// Dibuja los íconos de la app (cancha verde con círculo central) sin librerías.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const VERDE = [30, 106, 61], VERDE2 = [24, 90, 51], CAL = [244, 250, 245], AMARILLA = [242, 194, 48];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3, p = px(x, y);
      raw[i] = p[0]; raw[i + 1] = p[1]; raw[i + 2] = p[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// escala: qué tanto del ícono ocupa el dibujo (los maskable necesitan margen)
function dibujo(size, escala) {
  const SS = 4;
  return (x, y) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = ((x + (sx + 0.5) / SS) / size - 0.5) / escala, v = ((y + (sy + 0.5) / SS) / size - 0.5) / escala;
      const franja = Math.floor((u + 10) * 6) % 2 === 0;
      let c = franja ? VERDE : VERDE2;
      const r = Math.hypot(u, v), grosor = 0.028;
      if (Math.abs(r - 0.27) < grosor) c = CAL;
      if (Math.abs(u) < grosor && Math.abs(v) < 0.62) c = CAL;
      if (r < 0.085) c = AMARILLA;
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    return acc.map(n => Math.round(n / (SS * SS)));
  };
}

mkdirSync('icons', { recursive: true });
for (const [nombre, size, escala] of [['icon-192', 192, 1], ['icon-512', 512, 1], ['icon-maskable-512', 512, 0.78], ['apple-touch-icon', 180, 1]]) {
  writeFileSync(`icons/${nombre}.png`, png(size, dibujo(size, escala)));
  console.log('listo', nombre);
}
