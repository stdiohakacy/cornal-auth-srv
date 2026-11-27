import {
  ceilSeconds,
  days,
  fromEpochSeconds,
  hours,
  inSeconds,
  minutes,
  seconds,
  secondsUntil,
  toEpochSeconds,
} from './duration.js';

describe('duration', () => {
  it('builds milliseconds from human units', () => {
    expect(seconds(2)).toBe(2_000);
    expect(minutes(15)).toBe(900_000);
    expect(hours(24)).toBe(86_400_000);
    expect(days(7)).toBe(604_800_000);
  });

  it('converts milliseconds to whole seconds exactly or rounded up', () => {
    expect(inSeconds(days(14))).toBe(1_209_600);
    expect(ceilSeconds(1_001)).toBe(2);
    expect(ceilSeconds(-5)).toBe(0);
  });

  it('round-trips epoch seconds, truncating sub-second precision', () => {
    const at = new Date('2026-11-27T10:00:00.900Z');
    expect(toEpochSeconds(at)).toBe(Date.parse('2026-11-27T10:00:00Z') / 1000);
    expect(fromEpochSeconds(toEpochSeconds(at))).toEqual(
      new Date('2026-11-27T10:00:00Z'),
    );
  });

  it('counts whole seconds until a moment, never negative', () => {
    const from = new Date('2026-11-27T10:00:00Z');
    expect(secondsUntil(from, new Date('2026-11-27T10:01:30.700Z'))).toBe(90);
    expect(secondsUntil(from, new Date('2026-11-27T09:00:00Z'))).toBe(0);
  });
});
