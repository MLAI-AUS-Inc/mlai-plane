import { config, readEnv } from "./config.mjs";
import { Store } from "./store.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { Linear } from "./source.mjs";
import { Plane } from "./plane.mjs";
import { Engine } from "./engine.mjs";
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
    engine = new Engine({
      state,
      store,
      linear: new Linear(settings.linearKey),
      plane: new Plane(settings, { apply }),
      apply,
    });
    const report = await engine.run({ reconcile: args.includes("--reconcile") });
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
