import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Ejecuta cada scripts/validate-*.mjs en su propio proceso; falla si alguno falla.
const files = readdirSync(new URL(".", import.meta.url))
  .filter((name) => /^validate-.*\.mjs$/.test(name))
  .sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-loader",
      "./scripts/ts-alias-loader.mjs",
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      `scripts/${file}`,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    console.error(`FALLÓ: scripts/${file}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
