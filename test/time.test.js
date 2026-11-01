import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcOffsetHours, addDays, daysBetween, durationHours, gridValueAt, localDateTime } from '../lib/time.js';

test('utcOffsetHours follows DST for the location, not the server', () => {
  assert.equal(utcOffsetHours('America/New_York', new Date('2026-07-01T12:00:00Z')), -4);
  assert.equal(utcOffsetHours('America/New_York', new Date('2026-11-02T12:00:00Z')), -5);
  assert.equal(utcOffsetHours('America/Los_Angeles', new Date('2026-07-01T12:00:00Z')), -7);
  assert.equal(utcOffsetHours('UTC', new Date('2026-07-01T12:00:00Z')), 0);
});

test('calendar arithmetic crosses month ends and DST changes', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', -8), '2026-10-24');
  assert.equal(daysBetween('2026-11-01', '2026-11-09'), 8);
  assert.equal(daysBetween('2026-11-09', '2026-11-01'), -8);
});

test('localDateTime formats in the given zone', () => {
  assert.equal(localDateTime('America/New_York', new Date('2026-11-01T22:05:00Z')), '2026-11-01 17:05');
});

test('durationHours and gridValueAt read NWS gridpoint series', () => {
  assert.equal(durationHours('PT3H'), 3);
  assert.equal(durationHours('P1DT6H'), 30);
  const gusts = [
    { validTime: '2026-11-01T12:00:00+00:00/PT2H', value: 16.7 },
    { validTime: '2026-11-01T14:00:00+00:00/PT1H', value: 18.5 },
  ];
  assert.equal(gridValueAt(gusts, Date.parse('2026-11-01T13:00:00Z')), 16.7);
  assert.equal(gridValueAt(gusts, Date.parse('2026-11-01T14:30:00Z')), 18.5);
  assert.equal(gridValueAt(gusts, Date.parse('2026-11-01T15:00:00Z')), null);
});
