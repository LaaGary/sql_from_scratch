/**
 * DiskStore: persist the database to disk
 *
 * It has two parts:
 *
 *   Pager  handles "the 4096 bytes of page n" - opening the file, reading/writing pages, allocating new pages
 *   DiskStore handles "how data becomes pages" - catalog, heap, commit
 *
 * File layout (page 0 is the header):
 *
 *   page 0        header: magic, version, pageCount, catalog location
 *   catalog pages JSON of table schemas (may span pages, chained via next)
 *   heap pages    rows of each table (slotted pages, chained via next)
 *
 * Free pages are not written to the file; they are computed on open:
 * all pages in the file minus header / catalog / heap leaves the empty ones.
 * This avoids maintaining a separate free list and removes one more thing that can get corrupted.
 */
import fs from "node:fs";
import {
  PAGE_SIZE, PAGE_HEADER_SIZE, PAGE_TYPE_CATALOG,
  appendHeapCell, createDataPage, createHeaderPage, createHeapPage,
  heapCells, pageNext, parseHeaderPage, readDataChunk, setPageNext, writeDataChunk,
} from "./page.js";
import { recoverJournal, writeJournal } from "./journal.js";

// ---------------------------------------------------------------------------
// Pager: page-level file I/O
// ---------------------------------------------------------------------------

export class Pager {
  /** @param {string} path */
  constructor(path) {
    this.path = path;
    this.fd = null;
    /** @type {Map<number, Buffer>} */
    this.cache = new Map();
    /** @type {Map<number, Buffer>} pages modified by this transaction */
    this.dirty = new Map();
    this.pageCount = 0;
  }

  open() {
    const exists = fs.existsSync(this.path);
    this.fd = fs.openSync(this.path, exists ? "r+" : "w+");
    this.pageCount = exists ? Math.ceil(fs.statSync(this.path).size / PAGE_SIZE) : 0;
  }

  readPage(pageNumber) {
    if (this.cache.has(pageNumber)) return this.cache.get(pageNumber);
    if (pageNumber >= this.pageCount) return Buffer.alloc(PAGE_SIZE);
    const buffer = Buffer.alloc(PAGE_SIZE);
    fs.readSync(this.fd, buffer, 0, PAGE_SIZE, pageNumber * PAGE_SIZE);
    this.cache.set(pageNumber, buffer);
    return buffer;
  }

  writePage(pageNumber, buffer) {
    if (buffer.length !== PAGE_SIZE) {
      throw new Error("Page size must be " + PAGE_SIZE + " bytes");
    }
    this.cache.set(pageNumber, buffer);
    this.dirty.set(pageNumber, buffer);
    if (pageNumber >= this.pageCount) this.pageCount = pageNumber + 1;
  }

  /** Allocate a new page number (does not write contents). */
  allocatePage() {
    const pageNumber = this.pageCount;
    this.pageCount += 1;
    return pageNumber;
  }

  /** Write dirty pages to the file and fsync. */
  flush() {
    for (const [pageNumber, buffer] of this.dirty) {
      fs.writeSync(this.fd, buffer, 0, PAGE_SIZE, pageNumber * PAGE_SIZE);
    }
    fs.fsyncSync(this.fd);
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

// ---------------------------------------------------------------------------
// DiskStore
// ---------------------------------------------------------------------------

export class DiskStore {
  /** @param {string} path database file path */
  constructor(path) {
    if (!path) throw new Error("DiskStore requires a file path");
    this.path = path;
    this.persistent = true;
    this.pager = new Pager(path);
    this.catalog = { version: 1, tables: [] };
    this.catalogPages = [];
    this.freePages = [];
    this.hasData = false;
    this.opened = false;
  }

  /** Open the file, replay the journal if needed, and read the catalog. */
  ensureOpen() {
    if (this.opened) return;

    // Did we crash mid-commit last time? Replay the journal before opening.
    recoverJournal(this.path, PAGE_SIZE);

    this.pager.open();

    if (this.pager.pageCount > 0) {
      const header = parseHeaderPage(this.pager.readPage(0));
      if (header) {
        this.catalogPages = this.readChain(header.catalogRoot);
        const chunks = this.catalogPages.map((pageNumber) => readDataChunk(this.pager.readPage(pageNumber)));
        const payload = Buffer.concat(chunks).toString("utf8");
        this.catalog = JSON.parse(payload);
        this.hasData = true;
        this.freePages = this.computeFreePages();
      }
    }

    this.opened = true;
  }

  /** Read a chain of pages by following next pointers. */
  readChain(rootPage) {
    const pages = [];
    const seen = new Set();
    let pageNumber = rootPage;
    while (pageNumber !== 0) {
      if (seen.has(pageNumber)) throw new Error("Corrupt page chain (cycle detected)");
      seen.add(pageNumber);
      pages.push(pageNumber);
      pageNumber = pageNext(this.pager.readPage(pageNumber));
    }
    return pages;
  }

  /** All pages minus header, catalog, and heap are the free pages. */
  computeFreePages() {
    const used = new Set([0, ...this.catalogPages]);
    for (const table of this.catalog.tables) {
      for (const pageNumber of table.pages) used.add(pageNumber);
    }
    const free = [];
    for (let pageNumber = 1; pageNumber < this.pager.pageCount; pageNumber++) {
      if (!used.has(pageNumber)) free.push(pageNumber);
    }
    return free;
  }

  /** Read all rows of a table. */
  readRows(rootPage) {
    const rows = [];
    let pageNumber = rootPage;
    while (pageNumber !== 0) {
      const page = this.pager.readPage(pageNumber);
      for (const cell of heapCells(page)) {
        rows.push(JSON.parse(cell.toString("utf8")));
      }
      pageNumber = pageNext(page);
    }
    return rows;
  }

  /**
   * Read the whole database. Returns null for a new file.
   * @returns {{version:number, tables:object[]}|null}
   */
  load() {
    this.ensureOpen();
    if (!this.hasData) return null;
    return {
      version: 1,
      tables: this.catalog.tables.map((entry) => ({
        schema: entry.schema,
        nextRowid: entry.nextRowid,
        rows: this.readRows(entry.rootPage),
      })),
    };
  }

  /**
   * Write the entire snapshot to the file.
   *
   * The teaching version rewrites the pages of every table on each commit:
   * simple and hard to get wrong, at the cost of being slow with large data. A real database only rewrites touched pages.
   */
  save(snapshot) {
    this.ensureOpen();

    // Reserve page 0 for the header.
    if (this.pager.pageCount === 0) this.pager.pageCount = 1;

    const oldPages = new Set();
    for (const table of this.catalog.tables) {
      for (const pageNumber of table.pages) oldPages.add(pageNumber);
    }
    for (const pageNumber of this.catalogPages) oldPages.add(pageNumber);

    const freePool = new Set(this.freePages);
    const reused = new Set();
    const allocate = () => {
      if (freePool.size > 0) {
        const pageNumber = freePool.values().next().value;
        freePool.delete(pageNumber);
        reused.add(pageNumber);
        return pageNumber;
      }
      return this.pager.allocatePage();
    };

    // 1. Write each table as a chain of heap pages
    const tables = [];
    for (const table of snapshot.tables) {
      const pages = [];
      let current = null;
      for (const row of table.rows ?? []) {
        const cell = Buffer.from(JSON.stringify(row), "utf8");
        if (!current || !appendHeapCell(current, cell)) {
          current = createHeapPage();
          pages.push(current);
          if (!appendHeapCell(current, cell)) {
            throw new Error("A single row is too large to fit in one page");
          }
        }
      }
      if (pages.length === 0) pages.push(createHeapPage());

      const pageNumbers = pages.map(() => allocate());
      pages.forEach((page, index) => {
        setPageNext(page, index + 1 < pages.length ? pageNumbers[index + 1] : 0);
        this.pager.writePage(pageNumbers[index], page);
      });

      tables.push({
        name: table.schema.name,
        schema: table.schema,
        rootPage: pageNumbers[0],
        pages: pageNumbers,
        nextRowid: table.nextRowid,
        rowCount: (table.rows ?? []).length,
      });
    }

    // 2. Write the catalog JSON as a (possibly multi-page) page chain
    const catalogPayload = Buffer.from(JSON.stringify({ version: 1, tables }), "utf8");
    const chunks = [];
    const chunkSize = PAGE_SIZE - PAGE_HEADER_SIZE;
    for (let offset = 0; offset < catalogPayload.length; offset += chunkSize) {
      chunks.push(catalogPayload.subarray(offset, offset + chunkSize));
    }
    if (chunks.length === 0) chunks.push(Buffer.alloc(0));

    const catalogNumbers = chunks.map(() => allocate());
    chunks.forEach((chunk, index) => {
      const page = createDataPage(PAGE_TYPE_CATALOG);
      writeDataChunk(page, chunk);
      setPageNext(page, index + 1 < chunks.length ? catalogNumbers[index + 1] : 0);
      this.pager.writePage(catalogNumbers[index], page);
    });

    // 3. Header page
    const header = createHeaderPage({
      pageCount: this.pager.pageCount,
      catalogRoot: catalogNumbers[0] ?? 0,
      catalogLength: catalogPayload.length,
      freeListRoot: 0,
    });
    this.pager.writePage(0, header);

    // 4. Update in-memory state and the free page set
    this.catalog = { version: 1, tables };
    this.catalogPages = catalogNumbers;
    this.freePages = [...freePool];
    for (const pageNumber of oldPages) {
      if (!reused.has(pageNumber)) this.freePages.push(pageNumber);
    }
    this.freePages.sort((a, b) => a - b);
    this.hasData = true;

    this.commit();
  }

  /**
   * Commit: write the journal first, then modify the database, then delete the journal.
   * If any step fails, the next open can use the journal to return to a consistent state.
   */
  commit() {
    if (this.pager.dirty.size === 0) return;
    writeJournal(this.path, this.pager.dirty, PAGE_SIZE);
    this.pager.flush();
    fs.unlinkSync(this.path + ".journal");
    this.pager.dirty.clear();
  }

  close() {
    this.pager.close();
  }
}
