import * as si from "simple-icons";

/** 24×24 stroke icons drawn for the site (currentColor). */
const P: Record<string, string> = {
  wand: '<path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M4 20 14 10"/><path d="m19 13 .5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  canvas: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="9" cy="10" r="1.5"/><path d="m14 8 2.5 5.5-2-.5-1 2"/>',
  pulse: '<path d="M2.5 12h4l2.5-6 4 12 2.5-6h6"/>',
  ledger: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2"/><path d="M9.5 8h6M9.5 12h6M9.5 16h3.5"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  key: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>',
  map: '<path d="m3 6.5 6-3 6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  cloud: '<path d="M7 18.5h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.4 1.7A3.7 3.7 0 0 0 7 18.5z"/><rect x="9.5" y="12" width="5" height="4" rx="1"/><path d="M10.5 12v-1a1.5 1.5 0 0 1 3 0v1"/>',
  spark: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/><path d="M19 16.5c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z"/>',
  shield: '<path d="M12 2.8 4.5 5.6v5.9c0 4.6 3.1 8 7.5 9.7 4.4-1.7 7.5-5.1 7.5-9.7V5.6z"/><path d="m8.8 12 2.3 2.3 4.2-4.6"/>',
  gauge: '<path d="M3.5 16a8.5 8.5 0 1 1 17 0"/><path d="m12 16 4-5"/><circle cx="12" cy="16" r="1.4" fill="currentColor"/>',
  stop: '<path d="M8.3 2.5h7.4l5.8 5.8v7.4l-5.8 5.8H8.3l-5.8-5.8V8.3z"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none"/>',
  cursor: '<path d="m4.5 3.5 6.2 16.2 2.4-6.6 6.6-2.4z"/><path d="m13.3 13.3 5.2 5.2"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  tap: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10l4.6.8a2 2 0 0 1 1.6 2.3l-.9 5.2a2 2 0 0 1-2 1.7H11a2 2 0 0 1-1.6-.8L6 14.8a1.5 1.5 0 0 1 2.2-2z"/><path d="M5.5 6.5A5 5 0 0 1 15.4 5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5" opacity=".55"/>',
  text: '<path d="M4 6V4.5h16V6M12 4.5v15M9 19.5h6"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>',
  switch: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="3" fill="currentColor"/>',
  alert: '<path d="M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  arrow: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  globe: '<circle cx="12" cy="12" r="8.75"/><path d="M3.25 12h17.5M12 3.25c2.4 2.4 3.6 5.3 3.6 8.75S14.4 18.35 12 20.75C9.6 18.35 8.4 15.45 8.4 12S9.6 5.65 12 3.25z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>',
  devices: '<rect x="2.5" y="4" width="14" height="10" rx="1.5"/><path d="M5.5 17.5h8"/><rect x="16" y="9" width="5.5" height="11" rx="1.2"/><path d="M18.75 17.5h.01"/>',
  flow: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  browser: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 8.5h19"/><path d="M6 6.25h.01M8.5 6.25h.01"/><path d="m9 13 2 2 4-4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.75"/><path d="m21 16-5-5-9 9"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4"/>',
  branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4-6 3-12 6.5"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
};

export type IconName = keyof typeof P;

export function icon(name: string, size = 20, cls = "i"): string {
  const body = P[name] ?? P.spark!;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Filled brand glyphs (simple-icons, CC0) plus a few drawn by hand where simple-icons has none. */
const BRAND: Record<string, string> = {
  x: si.siX.path,
  facebook: si.siFacebook.path,
  reddit: si.siReddit.path,
  line: si.siLine.path,
  whatsapp: si.siWhatsapp.path,
  telegram: si.siTelegram.path,
  weibo: si.siSinaweibo.path,
  googleplay: si.siGoogleplay.path,
  github: si.siGithub.path,
  android: si.siAndroid.path,
  windows: "M0 3.45 9.75 2.1v9.45H0zm10.95-1.5L24 0v11.4H10.95zM0 12.6h9.75v9.45L0 20.7zm10.95.15H24V24l-13.05-1.85z",
  linkedin:
    "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z",
};

export function brand(name: string, size = 18): string {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${BRAND[name]}"/></svg>`;
}

/** The AutoFlow mark, inline (no request, crisp at any DPR). */
export function mark(size = 28, id = "m"): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="64" y1="448" x2="448" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22C3A6"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="#0B0B1A"/><path d="M120 360 C 176 360, 196 152, 256 152 S 336 360, 392 360" fill="none" stroke="url(#${id})" stroke-width="44" stroke-linecap="round"/><path d="M168 288 H 344" fill="none" stroke="url(#${id})" stroke-width="36" stroke-linecap="round" opacity=".55"/><circle cx="392" cy="360" r="34" fill="#22C3A6"/></svg>`;
}
