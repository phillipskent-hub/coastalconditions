// Run with: npm test   (uses Node's built-in test runner, no dependencies)
// Fixtures are trimmed copies of real NWS bulletins from Oct 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ugcZones, segmentFor, headlines, surfZone } from '../lib/nws-text.js';

test('ugcZones expands ranges and prefix changes, drops the expiry time', () => {
  assert.deepEqual(ugcZones('ANZ230>232-250-AMZ150-310900-'), ['ANZ230', 'ANZ231', 'ANZ232', 'ANZ250', 'AMZ150']);
  assert.deepEqual(ugcZones('FLZ141-347-447-311015-'), ['FLZ141', 'FLZ347', 'FLZ447']);
});

const cwf = `FZUS51 KBOX 302003
ANZ200-310900-
...SYNOPSIS...
$$
ANZ230>232-
250-310900-
Boston Harbor-

...SMALL CRAFT ADVISORY IN EFFECT FROM 6 AM EDT SATURDAY THROUGH
SUNDAY MORNING...

.TONIGHT...NW winds 20 to 25 kt.
$$`;

test('segmentFor finds a zone inside a wrapped UGC range; headlines unwrap', () => {
  const seg = segmentFor(cwf, ['ANZ231']);
  assert.ok(seg);
  assert.deepEqual(headlines(seg), ['SMALL CRAFT ADVISORY IN EFFECT FROM 6 AM EDT SATURDAY THROUGH SUNDAY MORNING']);
  assert.equal(segmentFor(cwf, ['ANZ233']), null);
});

const srfSubAreas = `MAZ024-311000-
Nantucket MA-
408 PM EDT Fri Oct 30 2026

.REST OF TODAY...
Rip Current Risk*...
   East Coast...............Low.
   South Coast..............Moderate.
UV Index**..................Moderate.
Water Temperature...........In the mid 50s.
Tides...
   Nantucket................High 4.2 feet (MLLW) 04:03 PM EDT.
                            Low 0.4 feet (MLLW) 10:16 PM EDT.

.SUNDAY...Surf height 2 to 3 feet. Sunny. Highs in the mid 50s.
Northwest winds around 10 mph.

&&

Rip Current Risk Category
* Low Risk - The risk for rip currents is low
$$`;

test('surfZone handles sub-areas, wrapped values and narrative periods', () => {
  const [today, sunday] = surfZone(srfSubAreas);
  assert.equal(today.name, 'Rest Of Today');
  const rip = today.fields.find(f => f.label === 'Rip Current Risk');
  assert.deepEqual(rip.parts, [{ area: 'East Coast', text: 'Low' }, { area: 'South Coast', text: 'Moderate' }]);
  assert.deepEqual(today.fields.find(f => f.label === 'UV Index').parts, [{ area: null, text: 'Moderate' }]);
  assert.equal(today.fields.find(f => f.label === 'Tides').parts[0].text,
    'High 4.2 feet (MLLW) 04:03 PM EDT. Low 0.4 feet (MLLW) 10:16 PM EDT');
  assert.equal(sunday.fields.length, 0);
  assert.equal(sunday.text, 'Surf height 2 to 3 feet. Sunny. Highs in the mid 50s. Northwest winds around 10 mph');
});

test('surfZone handles the wide-label Pacific format', () => {
  const [p] = surfZone(`ORZ101-311400-
SEASIDE AND CANNON BEACH OREGON-

.TODAY...
Surf Height...................5 to 8 ft.
Sunrise/Sunset Times..........Sunrise - 7:55 AM PDT.
                              Sunset  - 6:04 PM PDT.
`);
  assert.deepEqual(p.fields.map(f => f.label), ['Surf Height', 'Sunrise/Sunset Times']);
  assert.equal(p.fields[1].parts[0].text, 'Sunrise - 7:55 AM PDT. Sunset - 6:04 PM PDT');
});
