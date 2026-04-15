#!/usr/bin/env node
/**
 * Rasterize build/icon.svg into a multi-size build/icon.ico for electron-builder.
 *
 * Usage: npm run build-icon
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "build", "icon.svg");
const OUT_ICO = path.join(ROOT, "build", "icon.ico");
const OUT_PNG = path.join(ROOT, "build", "icon.png"); // 512px PNG for reference / Linux

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`Missing source SVG: ${SRC}`);
        process.exit(1);
    }
    const svgBuffer = fs.readFileSync(SRC);

    console.log("Rasterizing PNGs…");
    const pngBuffers = await Promise.all(
        SIZES.map((size) =>
            sharp(svgBuffer, { density: 384 })
                .resize(size, size, { fit: "contain" })
                .png()
                .toBuffer()
        )
    );

    console.log("Bundling ICO…");
    const icoBuffer = await pngToIco(pngBuffers);
    fs.writeFileSync(OUT_ICO, icoBuffer);

    const png512 = await sharp(svgBuffer, { density: 512 })
        .resize(512, 512, { fit: "contain" })
        .png()
        .toBuffer();
    fs.writeFileSync(OUT_PNG, png512);

    console.log(`Wrote ${OUT_ICO} (${icoBuffer.length} bytes, sizes ${SIZES.join(",")}).`);
    console.log(`Wrote ${OUT_PNG} (${png512.length} bytes).`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
