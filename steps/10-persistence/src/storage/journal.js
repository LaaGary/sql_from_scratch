/**
 * Journal and Crash Recovery
 *
 * Consider this: COMMIT must write 5 pages, but the power fails while writing page 3.
 * The file is now half new data and half old data - the database is corrupt.
 *
 * The fix is "write the journal first, then modify the database":
 *
 *   1. write the pages to change (page number + contents) to xxx.journal and fsync
 *   2. write a COMMIT end marker and fsync
 *   3. write the same pages into the real database file
 *   4. delete the journal
 *
 * If it crashes midway:
 *   - no COMMIT marker in the journal -> treat the transaction as not having happened and discard the journal
 *   - COMMIT marker present      -> roll forward all pages to bring the data back to a consistent state
 *
 * Each page carries a CRC32 checksum to avoid reading corrupted data.
 * This is the teaching version; a real database handles more details (LSN, checkpoint, WAL file management).
 */
import fs from "node:fs";

const MAGIC = "JRNL1\n";
const END_PAGE = 0xffffffff;

/** CRC32 lookup table. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Get the journal path for a database file. */
export function journalPath(dbPath) {
  return dbPath + ".journal";
}

/**
 * Write dirty pages to the journal file.
 * @param {string} dbPath
 * @param {Map<number, Buffer>} pages page number -> page contents
 */
export function writeJournal(dbPath, pages, pageSize) {
  const records = [];
  for (const [pageNumber, buffer] of pages) {
    if (buffer.length !== pageSize) {
      throw new Error("Incorrect page size: " + pageNumber);
    }
    const header = Buffer.alloc(12);
    header.writeUInt32LE(pageNumber, 0);
    header.writeUInt32LE(buffer.length, 4);
    header.writeUInt32LE(crc32(buffer), 8);
    records.push(header, buffer);
  }

  const endData = Buffer.from("COMMIT");
  const endHeader = Buffer.alloc(12);
  endHeader.writeUInt32LE(END_PAGE, 0);
  endHeader.writeUInt32LE(endData.length, 4);
  endHeader.writeUInt32LE(crc32(endData), 8);

  const content = Buffer.concat([Buffer.from(MAGIC, "ascii"), ...records, endHeader, endData]);
  const file = fs.openSync(journalPath(dbPath), "w");
  try {
    fs.writeSync(file, content);
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
}

/**
 * If a valid journal exists, replay its pages into the database file, then delete the journal.
 * @returns {boolean} whether a replay happened
 */
export function recoverJournal(dbPath, pageSize) {
  const path = journalPath(dbPath);
  if (!fs.existsSync(path)) return false;

  const content = fs.readFileSync(path);
  if (content.length < MAGIC.length || content.subarray(0, MAGIC.length).toString("ascii") !== MAGIC) {
    fs.unlinkSync(path);
    return false;
  }

  const pages = [];
  let offset = MAGIC.length;
  let committed = false;

  while (offset + 12 <= content.length) {
    const pageNumber = content.readUInt32LE(offset);
    const length = content.readUInt32LE(offset + 4);
    const checksum = content.readUInt32LE(offset + 8);
    offset += 12;
    if (pageNumber === END_PAGE) {
      const endData = content.subarray(offset, offset + length);
      committed = offset + length <= content.length && crc32(endData) === checksum;
      break;
    }
    if (offset + length > content.length) break; // incomplete record
    const data = content.subarray(offset, offset + length);
    if (crc32(data) !== checksum) break; // corrupted contents
    pages.push({ pageNumber, data });
    offset += length;
  }

  if (!committed) {
    // No COMMIT: the transaction never completed; discard the journal and keep the old state.
    fs.unlinkSync(path);
    return false;
  }

  const file = fs.openSync(dbPath, "r+");
  try {
    for (const { pageNumber, data } of pages) {
      fs.writeSync(file, data, 0, data.length, pageNumber * pageSize);
    }
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
  fs.unlinkSync(path);
  return true;
}
