import fs from "node:fs/promises";
import path from "node:path";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0;
});
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
/** Bounded text-only support ZIP. STORE avoids compression work on the recording computer. */
export async function writeSupportZip(folder: string, files: string[], destination: string) {
  const handle = await fs.open(destination, "wx", 0o600);
  const now = new Date(), time = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, now.getUTCFullYear()) - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();
  const central: Buffer[] = []; let offset = 0, count = 0;
  try {
    for (const file of files) {
      const relative = path.relative(folder, file).replaceAll("\\", "/");
      if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Support archive path escaped its folder.");
      const name = Buffer.from(relative), data = await fs.readFile(file);
      if (data.length > 2 * 1024 * 1024 || offset + data.length > 32 * 1024 * 1024 || count >= 1000) throw new Error("Support archive exceeded its safe size limit.");
      const checksum = crc32(data), local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
      directory.writeUInt16LE(time, 12); directory.writeUInt16LE(date, 14);
      directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
      central.push(directory, name); await handle.writeFile(Buffer.concat([local, name, data])); offset += local.length + name.length + data.length; count++;
    }
    const start = offset, directory = Buffer.concat(central); await handle.writeFile(directory);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(start, 16);
    await handle.writeFile(end); await handle.sync();
  } finally { await handle.close(); }
}
