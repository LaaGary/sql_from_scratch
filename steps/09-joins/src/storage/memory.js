/**
 * MemoryStore: a storage backend that lives only in memory.
 *
 * Chapter 10 adds a DiskStore that wires the same interface to real files:
 *
 *   load()         -> last saved snapshot (null if never saved)
 *   save(snapshot) -> write the whole database out
 *   close()        -> close
 *
 * With this interface, Database does not need to know whether it runs in memory or on disk.
 */
export class MemoryStore {
  constructor() {
    this.snapshot = null;
    // The in-memory version need not save after every statement; Database checks this flag.
    this.persistent = false;
  }

  /** @returns {object|null} the last saved snapshot */
  load() {
    return this.snapshot;
  }

  /** @param {object} snapshot */
  save(snapshot) {
    // Deep copy so later database changes do not affect the "saved" version.
    this.snapshot = structuredClone(snapshot);
  }

  close() {
    // The in-memory version has nothing to close.
  }
}
