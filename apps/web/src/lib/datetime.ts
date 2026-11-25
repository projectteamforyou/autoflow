/**
 * <input type="datetime-local"> works in the device's local time without a zone ("2026-03-01T09:30"),
 * the schema stores ISO-8601 UTC instants ("…Z"). These convert between the two.
 */

/** ISO instant → value for a datetime-local input ("" when missing or unparsable). */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value → ISO instant (undefined when empty or invalid, so the field is simply unset). */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
