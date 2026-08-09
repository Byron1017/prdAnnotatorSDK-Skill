import { build } from "esbuild";

await build({
  entryPoints: ["prd-annotator/src/index.js"],
  outfile: "prd-annotator/prd-annotator.js",
  bundle: true,
  format: "iife",
  target: ["es2022"],
  charset: "utf8",
  legalComments: "eof",
  sourcemap: false,
  minify: false
});
