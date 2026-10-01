import { config, readEnv } from "./config.mjs";
import { Store } from "./store.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { Linear } from "./source.mjs";
import { Plane } from "./plane.mjs";
import { Engine } from "./engine.mjs";
import { Writeback } from "./writeback.mjs";
import { LinearWriter } from "./linear-write.mjs";
const args = process.argv.slice(2),
  option = (name) => {
    const n = args.indexOf(name);
    return n < 0 ? undefined : args[n + 1];
  };
let release, engine, store;
try {
  const settings = config(option("--env") ? readEnv(option("--env")) : process.env);
  store = new Store(settings.stateDir);
  release = store.lock();
  if (args[0] === "bootstrap") {
    console.log(
      JSON.stringify({
        bootstrapped: bootstrap(store, option("--export"), option("--ledger"), option("--destination")),
      })
    );
  } else if (args[0] === "run") {
    const state = store.load(),
      apply = args.includes("--apply");
    if (settings.writeBack && apply && !settings.linearWriteKey) throw Error("LINEAR_WRITE_API_KEY is required for writeback");
    const writer = settings.writeBack ? new LinearWriter(settings.linearWriteKey, { apply }) : null;
    if (settings.writeBack && apply) await writer.identity();
    engine = new Engine({
      state,
      store,
      linear: new Linear(settings.linearKey),
      plane: new Plane(settings, { apply }),
      apply,
    });
    const report = await engine.run({ reconcile: args.includes("--reconcile") });
    if (settings.writeBack) {
      await new Writeback(engine, writer).run();
      report.finishedAt = new Date().toISOString();
      if (apply) { state.lastRun.conflicts = report.conflicts.length; engine.save(); }
      report.pending = Object.values(state.pending).reduce((n, p) => n + Object.keys(p).length, 0);
    }
    store.report(report);
    console.log(
      JSON.stringify({
        at: report.finishedAt,
        mode: report.mode,
        creates: report.creates,
        updates: report.updates,
        unchanged: report.unchanged,
        files: report.files,
        conflicts: report.conflicts.length,
        pending: report.pending,
      })
    );
    if (report.conflicts.length) process.exitCode = 2;
  } else throw Error("Use bootstrap or run [--apply] [--reconcile] --env /private/config.env");
} catch (error) {
  const message =
    error.code === "EEXIST" ? "A sync lock exists; inspect the previous process before removing it" : error.message;
  if (engine) {
    engine.report.failed = true;
    engine.report.error = message;
    engine.report.finishedAt = new Date().toISOString();
    store.report(engine.report);
  }
  // Do not print raw error objects, request headers, bodies or credentials.
  console.error(JSON.stringify({ status: "failed", message }));
  process.exitCode = 1;
} finally {
  release?.();
}
