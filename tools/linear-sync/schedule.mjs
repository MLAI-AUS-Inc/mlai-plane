import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config, readEnv } from "./config.mjs";
export function plist({ node, cli, env, stateDir }) {
  const xml = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const args = [node, cli, "run", "--apply", "--env", env];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>au.mlai.plane.linear-sync</string>
<key>ProgramArguments</key><array>${args.map((s) => "<string>" + xml(s) + "</string>").join("")}</array>
<key>WorkingDirectory</key><string>${xml(dirname(cli))}</string>
<key>StartInterval</key><integer>300</integer>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(join(stateDir, "scheduler.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(stateDir, "scheduler-error.log"))}</string>
</dict></plist>\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "darwin" || process.argv[2] !== "install-local" || !process.argv[3])
    throw Error("Use install-local /private/config.env on macOS");
  const env = resolve(process.argv[3]),
    settings = config(readEnv(env));
  const directory = join(homedir(), "Library", "LaunchAgents"),
    path = join(directory, "au.mlai.plane.linear-sync.plist");
  if (existsSync(path)) throw Error("Schedule already exists; inspect it before replacing");
  const label = "gui/" + process.getuid() + "/au.mlai.plane.linear-sync";
  if (spawnSync("launchctl", ["print", label]).status === 0)
    throw Error("A matching launchd service is already loaded");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path,
    plist({
      node: process.execPath,
      cli: join(dirname(fileURLToPath(import.meta.url)), "cli.mjs"),
      env,
      stateDir: settings.stateDir,
    }),
    { mode: 0o600, flag: "wx" }
  );
  const result = spawnSync("launchctl", ["bootstrap", "gui/" + process.getuid(), path], { encoding: "utf8" });
  if (result.status !== 0) throw Error("launchd installation failed; inspect saved plist and launchctl status");
  console.log(JSON.stringify({ label, path, intervalSeconds: 300, mode: "apply" }));
}
