/**
 * One-off illustration generator (OpenAI Images API). The output is committed under public/img/,
 * so the regular build never needs network access or an API key.
 *
 *   OPENAI_API_KEY=… OPENAI_IMAGE_MODEL=gpt-image-2 pnpm --filter @autoflow/site images [name…]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "img");
const STYLE =
  "Premium software brand illustration, deep navy space background (#0B0B1A), luminous flowing ribbons in a violet (#7C5CFF) to blue (#4F8BFF) to teal (#22C3A6) gradient, soft volumetric glow, subtle film grain, clean geometric shapes, high-end 3D render, cinematic lighting, generous negative space. Absolutely no text, no letters, no numbers, no logos, no watermarks, no UI labels.";

const IMAGES: { name: string; size: "1536x1024" | "1024x1024"; width: number; prompt: string }[] = [
  {
    name: "hero-universe",
    size: "1536x1024",
    width: 1536,
    prompt: `An abstract "flow universe": many smooth glowing ribbons of light streaming across a dark cosmos, converging through a few small luminous nodes like stations on a route, tiny particles trailing behind like stars, evoking automation, rhythm and calm control. ${STYLE}`,
  },
  {
    name: "keyforge",
    size: "1536x1024",
    width: 1200,
    prompt: `A sleek mechanical keyboard key and a minimalist computer mouse floating above a futuristic anvil in a forge made of light; glowing violet-teal sparks reshape the keycap, suggesting keys being re-forged and remapped. ${STYLE}`,
  },
  {
    name: "practice-canvas",
    size: "1536x1024",
    width: 1200,
    prompt: `A translucent floating virtual screen (a glass panel with a soft grid) in a dark studio, with a glowing cursor path of dotted light tracing between a few circular target points on the panel, ripple rings where clicks land, a safe sandbox practice environment. ${STYLE}`,
  },
  {
    name: "safety-shield",
    size: "1024x1024",
    width: 1024,
    prompt: `A calm, solid glass shield with a soft glowing core, surrounded by gentle concentric guard rings and a protective railing of light that a flowing ribbon passes safely through; conveys trust, privacy and an emergency brake that is always within reach. ${STYLE}`,
  },
  {
    name: "android-automation",
    size: "1024x1024",
    width: 1024,
    prompt: `A modern smartphone floating at a slight angle with a dark blank screen, luminous tap ripples and swipe trails of light flowing across it, small orbiting nodes connected by glowing lines like a routine running on the phone. ${STYLE}`,
  },
];

async function generate(img: (typeof IMAGES)[number]) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, prompt: img.prompt, size: img.size, quality: "high", output_format: "webp", n: 1 }),
  });
  if (!res.ok) throw new Error(`${img.name}: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { b64_json: string }[] };
  const raw = Buffer.from(json.data[0]!.b64_json, "base64");
  await mkdir(OUT, { recursive: true });
  // Keep the full-size original outside the repo, in case it needs re-encoding later.
  await writeFile(join(tmpdir(), `autoflow-${img.name}.raw.webp`), raw);
  // Re-encode until it fits the 300 KB budget.
  for (const q of [90, 84, 78, 70, 62]) {
    const out = await sharp(raw).resize({ width: img.width, withoutEnlargement: true }).webp({ quality: q, effort: 6 }).toBuffer();
    if (out.length < 300_000 || q === 62) {
      await writeFile(join(OUT, `${img.name}.webp`), out);
      console.log(`${img.name}.webp  q=${q}  ${(out.length / 1024).toFixed(0)} KB`);
      return;
    }
  }
}

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
const only = process.argv.slice(2);
await Promise.all(IMAGES.filter((i) => only.length === 0 || only.includes(i.name)).map((i) => generate(i).catch((e) => console.error(String(e)))));
