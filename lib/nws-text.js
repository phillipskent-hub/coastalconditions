// Parsers for NWS text bulletins (Coastal Waters Forecast, Surf Zone Forecast).
// A bulletin is a series of segments separated by "$$"; each segment starts with a UGC line
// naming the zones it covers, e.g. "ANZ230>232-250-AMZ150-310900-".

// Expand a UGC line to zone ids (">" is a range; the trailing 6 digits are an expiry time, not a zone).
export function ugcZones(line) {
  const ids = [];
  let prefix = '';
  for (const tok of line.split('-').filter(Boolean)) {
    const m = tok.match(/^([A-Z]{2}Z)?(\d{3})(?:>(\d{3}))?$/);
    if (!m) continue;
    if (m[1]) prefix = m[1];
    for (let n = +m[2]; n <= +(m[3] || m[2]); n++) ids.push(prefix + String(n).padStart(3, '0'));
  }
  return ids;
}

// The segment covering any of zoneIds (UGC lines can wrap, hence the multi-line match), or null.
export function segmentFor(text, zoneIds) {
  for (const segment of text.split('$$')) {
    const ugc = segment.match(/^[A-Z]{2}Z\d{3}[-\d>A-Z\n]*?\d{6}-$/m);
    if (ugc && ugcZones(ugc[0].replace(/\n/g, '')).some(id => zoneIds.includes(id))) return segment;
  }
  return null;
}

// "...SMALL CRAFT ADVISORY IN EFFECT THROUGH\nSATURDAY MORNING..." -> one line each.
export function headlines(segment) {
  return [...segment.matchAll(/^\.\.\.([\s\S]+?)\.\.\.\s*$/gm)].map(m => m[1].replace(/\s+/g, ' ').trim());
}

const tidy = s => s.replace(/\s+/g, ' ').trim().replace(/\.$/, '');

// Surf Zone Forecast segment -> periods of labelled fields. Handles the variations offices use:
//   Rip Current Risk*...........High.              (simple)
//   Rip Current Risk*...                           (split by sub-area)
//      East Coast...............Low.
//   Tides.........................High 7.1 feet.   (value continued on indented lines)
//                                 Low 3.2 feet.
//   .SUNDAY...Surf height 2 to 3 feet. Sunny.      (narrative period, no fields)
export function surfZone(segment) {
  const body = segment.split('&&')[0];
  const periods = [];
  let period = null, field = null;
  for (const line of body.split('\n')) {
    let m;
    if ((m = line.match(/^\.([A-Z][A-Z0-9 ,'/-]*?)\.\.\.(.*)$/))) {
      period = { name: m[1].replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), fields: [], text: m[2].trim() };
      periods.push(period);
      field = null;
    } else if (!period) {
      continue;
    } else if ((m = line.match(/^(\S[^.]*?)\**\.{3,}(.*)$/))) {
      field = { label: m[1].trim(), parts: [] };
      if (m[2].trim()) field.parts.push({ area: null, text: m[2] });
      period.fields.push(field);
    } else if (field && (m = line.match(/^\s+(\S[^.]*?)\.{3,}(.*)$/))) {
      field.parts.push({ area: m[1].trim(), text: m[2] });
    } else if ((m = line.match(/^\s+(\S.*)$/))) {
      // Continuation of the last value, or of a narrative period's text.
      const last = field?.parts.at(-1);
      if (last) last.text += ' ' + m[1];
      else if (!field) period.text += ' ' + m[1];
    } else if (!line.trim()) {
      field = null;
    } else if (!period.fields.length) {
      period.text += ' ' + line; // narrative periods wrap at column 0
    }
  }
  return periods.map(p => ({
    name: p.name,
    text: tidy(p.text),
    fields: p.fields.map(f => ({ label: f.label, parts: f.parts.map(x => ({ area: x.area, text: tidy(x.text) })) })),
  }));
}
