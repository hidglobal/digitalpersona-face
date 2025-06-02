//import pkg from "./package.json" with { type: "json" };
import * as esbuild from "esbuild"

/** @type {import('esbuild').BuildOptions} */
const baseConfig = {
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ['chrome60', 'firefox55', 'edge17'],
}

const faceSDK = (minify) => ({
    ...baseConfig,
    minify,
    sourcemap: true,
    // globalName: 'faceSDK',
    entryPoints: ["src/index.ts"],
    outfile: `dist/face.sdk${minify ? '.min': ''}.js`,
})

await esbuild.build(faceSDK(false))
await esbuild.build(faceSDK(true))

await esbuild.build({
    ...baseConfig,
    // globalName: 'facefinder',
    entryPoints: ["src/facefinder.ts"],
    outfile: "dist/facefinder.js",
    loader: { ".bin": "binary" },
})
