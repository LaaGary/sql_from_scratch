/**
 * Page Format
 *
 * A database file is not one big JSON blob but fixed-size blocks called pages (4096 bytes here).
 * Fixed-size pages have advantages:
 *   - reads and writes touch only the needed page instead of rewriting the whole file
 *   - caching, transactions, and crash recovery are easier to implement
 *
 * This file only packs data into pages and extracts it back; it never does file I/O,
 * which makes it ideal for unit tests.
 *
 * Page types:
 *   0  file header (magic, version, pageCount, catalog location...)
 *   2  catalog (JSON of table schemas, possibly spanning pages)
 *   3  heap (rows of one table, slotted page)
 *
 * Heap page layout:
 *
 *   +0   type (1 byte) = 3
 *   +4   next page number (u32, 0 means no next page)
 *   +8   slot count (u16)
 *   +10  free offset (u16): bytes used from the end of the page inward
 *   +12  slot array, each slot is 4 bytes: offset (u16) + length (u16)
 *   ...  free space
 *   end   cell data (one JSON row per line), growing backwards
 */

export const PAGE_SIZE = 4096;
export const PAGE_HEADER_SIZE = 12;

export const PAGE_TYPE_CATALOG = 2;
export const PAGE_TYPE_HEAP = 3;

/** How many payload bytes fit in a catalog or free-list page. */
export const DATA_CHUNK_SIZE = PAGE_SIZE - PAGE_HEADER_SIZE;

/** Create an empty heap page. */
export function createHeapPage() {
  const page = Buffer.alloc(PAGE_SIZE);
  page.writeUInt8(PAGE_TYPE_HEAP, 0);
  return page;
}

export function pageType(page) {
  return page.readUInt8(0);
}

export function pageNext(page) {
  return page.readUInt32LE(4);
}

export function setPageNext(page, nextPage) {
  page.writeUInt32LE(nextPage, 4);
}

export function heapSlotCount(page) {
  return page.readUInt16LE(8);
}

export function heapFreeOffset(page) {
  return page.readUInt16LE(10);
}

/** How many bytes remain on this page for cells. */
export function heapFreeBytes(page) {
  return PAGE_SIZE - PAGE_HEADER_SIZE - heapSlotCount(page) * 4 - heapFreeOffset(page);
}

/**
 * Put a cell (a serialized row) into a heap page.
 * Returns false when there is not enough space; the caller must use another page.
 */
export function appendHeapCell(page, cell) {
  if (heapFreeBytes(page) < cell.length + 4) return false;

  const slotCount = heapSlotCount(page);
  const freeOffset = heapFreeOffset(page);
  const cellOffset = PAGE_SIZE - freeOffset - cell.length;

  cell.copy(page, cellOffset);

  const slotOffset = PAGE_HEADER_SIZE + slotCount * 4;
  page.writeUInt16LE(cellOffset, slotOffset);
  page.writeUInt16LE(cell.length, slotOffset + 2);
  page.writeUInt16LE(slotCount + 1, 8);
  page.writeUInt16LE(freeOffset + cell.length, 10);
  return true;
}

/** Read all cells from a heap page (in insertion order). */
export function heapCells(page) {
  const count = heapSlotCount(page);
  const cells = [];
  for (let i = 0; i < count; i++) {
    const slotOffset = PAGE_HEADER_SIZE + i * 4;
    const offset = page.readUInt16LE(slotOffset);
    const length = page.readUInt16LE(slotOffset + 2);
    if (length > 0) cells.push(page.subarray(offset, offset + length));
  }
  return cells;
}

/** Create a data page for the catalog / free list. */
export function createDataPage(type) {
  const page = Buffer.alloc(PAGE_SIZE);
  page.writeUInt8(type, 0);
  return page;
}

export function writeDataChunk(page, chunk) {
  chunk.copy(page, PAGE_HEADER_SIZE);
  page.writeUInt16LE(chunk.length, 8);
}

export function readDataChunk(page) {
  const length = page.readUInt16LE(8);
  return page.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + length);
}

// ---------------------------------------------------------------------------
// File header (page 0)
// ---------------------------------------------------------------------------

export const MAGIC = "SQLDB01\n";
export const FORMAT_VERSION = 1;

/**
 * Create the header page.
 * @param {{pageCount:number, catalogRoot:number, catalogLength:number, freeListRoot:number}} info
 */
export function createHeaderPage(info) {
  const page = Buffer.alloc(PAGE_SIZE);
  page.write(MAGIC, 0, "ascii");
  page.writeUInt32LE(FORMAT_VERSION, 8);
  page.writeUInt32LE(PAGE_SIZE, 12);
  page.writeUInt32LE(info.pageCount, 16);
  page.writeUInt32LE(info.catalogRoot, 20);
  page.writeUInt32LE(info.catalogLength, 24);
  page.writeUInt32LE(info.freeListRoot, 28);
  return page;
}

/**
 * Parse the header page; returns null if the file is not ours.
 */
export function parseHeaderPage(page) {
  const magic = page.subarray(0, 8).toString("ascii");
  if (magic !== MAGIC) return null;
  const version = page.readUInt32LE(8);
  if (version !== FORMAT_VERSION) {
    throw new Error("Unsupported database format version: " + version);
  }
  const pageSize = page.readUInt32LE(12);
  if (pageSize !== PAGE_SIZE) {
    throw new Error("Page size mismatch: " + pageSize);
  }
  return {
    pageCount: page.readUInt32LE(16),
    catalogRoot: page.readUInt32LE(20),
    catalogLength: page.readUInt32LE(24),
    freeListRoot: page.readUInt32LE(28),
  };
}
