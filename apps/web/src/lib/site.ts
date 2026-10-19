/** Public website (marketing, legal, downloads). Absolute so links also work inside the native shells. */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://autoflowmacro.com").replace(/\/+$/, "");
