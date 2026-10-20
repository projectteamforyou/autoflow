// Renders PWA icons from the brand mark. Run: node scripts/icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../../../packages/brand/mark.svg", import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
for (const s of [192, 512]) await sharp(svg, { density: 384 }).resize(s, s).png().toFile(out(`icon-${s}.png`));
const inner = await sharp(svg, { density: 384 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0B0B1A" } }).composite([{ input: inner, gravity: "center" }]).png().toFile(out("maskable-512.png"));
console.log("icons written");
