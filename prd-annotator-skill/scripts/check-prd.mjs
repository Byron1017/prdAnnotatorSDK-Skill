import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckProjectCli } from "./check-project.mjs";

export { checkProject } from "./check-project.mjs";

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runCheckProjectCli({ argv: process.argv.slice(2) });
}
