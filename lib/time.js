// Date/time helpers. All "local" values are for the location's time zone, not the server's
// (Vercel runs on UTC).

// "YYYY-MM-DD" in timeZone.
export const localDate = (timeZone, date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

// "YYYY-MM-DD HH:MM" in timeZone.
export const localDateTime = (timeZone, date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date);

// UTC offset in hours for timeZone at that moment, DST included (e.g. -4 in July, -5 in November for Boston).
export function utcOffsetHours(timeZone, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date).find(p => p.type === 'timeZoneName').value; // "GMT-05:00", or "GMT" for UTC
  const m = name.match(/([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] + m[3] / 60) : 0;
}

// Calendar arithmetic on "YYYY-MM-DD" strings.
export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

// ISO 8601 duration as hours: "PT3H" -> 3, "P1DT6H" -> 30.
export function durationHours(iso) {
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  return m ? (+(m[1] || 0)) * 24 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60 : 0;
}

// NWS gridpoint series ({ validTime: "2026-11-01T12:00:00+00:00/PT2H", value }) -> value in force at `when` (ms).
export function gridValueAt(values, when) {
  for (const v of values) {
    const [start, dur] = v.validTime.split('/');
    const t0 = Date.parse(start);
    if (when >= t0 && when < t0 + durationHours(dur) * 3600000) return v.value;
  }
  return null;
}
