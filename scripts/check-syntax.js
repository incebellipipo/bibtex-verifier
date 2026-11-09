// Syntax-check every browser module with `node --check`. A Node script rather
// than a shell loop so `npm run check` behaves the same on every platform.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
for (const dir of ["src/lib", "src/app"]) {
  for (const file of readdirSync(dir).filter(name => name.endsWith(".js")).sort()) {
    try {
      execFileSync(process.execPath, ["--check", join(dir, file)], { stdio: "inherit" });
    } catch {
      failed++;
    }
  }
}
if (failed) {
  console.error(`${failed} module(s) failed the syntax check.`);
  process.exit(1);
}
console.log("All modules pass the syntax check.");
