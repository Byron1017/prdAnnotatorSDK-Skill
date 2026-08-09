import { build } from "esbuild";
import { SDK_VERSION } from "../prd-annotator/src/constants.js";

await build({
  entryPoints: ["prd-annotator/src/index.js"],
  outfile: "prd-annotator/prd-annotator.js",
  bundle: true,
  format: "iife",
  target: ["es2022"],
  charset: "utf8",
  banner: { js: `/*! PRD Annotator SDK v${SDK_VERSION} */` },
  legalComments: "eof",
  sourcemap: false,
  minify: false
});
