import {
  mkdirSync,
  openSync,
  writeFileSync,
  readFileSync,
  closeSync,
  renameSync,
  unlinkSync,
  fsyncSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export function atomic(path, value) {
  const tmp = path + "." + randomUUID() + ".tmp";
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "state.json");
  }
  load() {
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  save(state) {
    atomic(this.path, state);
  }
  lock() {
    const path = join(this.directory, "run.lock");
    // Never auto-break a lock: PID reuse and multiple containers make that unsafe.
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    closeSync(fd);
    return () => unlinkSync(path);
  }
  report(report) {
    atomic(join(this.directory, "last-report.json"), report);
    atomic(join(this.directory, "report-" + report.startedAt.replaceAll(":", "-") + ".json"), report);
    const files = readdirSync(this.directory)
      .filter((f) => /^report-.*\.json$/.test(f))
      .sort();
    // Bounded retention of this program's own diagnostic reports, never source data.
    for (const name of files.slice(0, -96)) unlinkSync(join(this.directory, name));
  }
  exists() {
    return existsSync(this.path);
  }
}
