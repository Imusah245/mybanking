// tests/formatters.test.js
//
// Unit tests for the monetary display/parsing helpers (src/utils/formatters.js),
// Task 3.5.
//
// These helpers are DISPLAY/PARSING only (Requirement 15.1: money is stored as
// integer pesewas, 100 pesewas = 1 GHS). The critical guarantee is that
// converting pesewas -> display -> pesewas returns the original integer EXACTLY,
// with no floating-point drift ever introduced into the stored integer value.
//
// Covered:
//   - pesewasToDisplay: zero, sub-GHS, thousands separators, large values
//   - displayToPesewas: GHS prefix, commas, whitespace, 1- or 2-digit fractions
//   - round-trip exactness (no float drift) over representative + random values
//   - invalid inputs throwing as implemented (non-integer, negative, non-string,
//     malformed strings)

import { pesewasToDisplay, displayToPesewas } from '../src/utils/formatters.js';

describe('pesewasToDisplay', () => {
  test('formats zero as "GHS 0.00"', () => {
    expect(pesewasToDisplay(0)).toBe('GHS 0.00');
  });

  test('formats sub-GHS values with a leading zero cedi part', () => {
    // 9 pesewas is GHS 0.09 — the fraction must be zero-padded to two digits.
    expect(pesewasToDisplay(9)).toBe('GHS 0.09');
    expect(pesewasToDisplay(5)).toBe('GHS 0.05');
    expect(pesewasToDisplay(99)).toBe('GHS 0.99');
  });

  test('formats whole cedis with a .00 fraction', () => {
    expect(pesewasToDisplay(100)).toBe('GHS 1.00');
    expect(pesewasToDisplay(1000)).toBe('GHS 10.00');
  });

  test('formats a value with both cedis and pesewas', () => {
    // 123456 pesewas = 1234 GHS + 56 pesewas.
    expect(pesewasToDisplay(123456)).toBe('GHS 1,234.56');
    expect(pesewasToDisplay(101)).toBe('GHS 1.01');
  });

  test('inserts thousands separators at every third digit', () => {
    expect(pesewasToDisplay(100000)).toBe('GHS 1,000.00'); // 1,000 GHS
    expect(pesewasToDisplay(100000000)).toBe('GHS 1,000,000.00'); // 1,000,000 GHS
  });

  test('formats large values with multiple comma groups', () => {
    // 1,234,567,890.12 GHS
    expect(pesewasToDisplay(123456789012)).toBe('GHS 1,234,567,890.12');
  });

  test('formats a value just under the thousands boundary', () => {
    expect(pesewasToDisplay(99999)).toBe('GHS 999.99');
  });

  describe('invalid inputs throw', () => {
    test('throws on a non-integer number', () => {
      expect(() => pesewasToDisplay(1.5)).toThrow(TypeError);
    });

    test('throws on a negative value', () => {
      expect(() => pesewasToDisplay(-1)).toThrow(TypeError);
    });

    test('throws on a non-number', () => {
      expect(() => pesewasToDisplay('100')).toThrow(TypeError);
      expect(() => pesewasToDisplay(null)).toThrow(TypeError);
      expect(() => pesewasToDisplay(undefined)).toThrow(TypeError);
      expect(() => pesewasToDisplay({})).toThrow(TypeError);
    });

    test('throws on NaN and Infinity', () => {
      expect(() => pesewasToDisplay(NaN)).toThrow(TypeError);
      expect(() => pesewasToDisplay(Infinity)).toThrow(TypeError);
    });

    test('throws on a value beyond the safe integer range', () => {
      expect(() => pesewasToDisplay(Number.MAX_SAFE_INTEGER + 1)).toThrow(
        TypeError
      );
    });
  });
});

describe('displayToPesewas', () => {
  test('parses a plain whole-cedi string', () => {
    expect(displayToPesewas('1234')).toBe(123400);
  });

  test('parses a value with a GHS prefix', () => {
    expect(displayToPesewas('GHS 1,234.56')).toBe(123456);
    expect(displayToPesewas('GHS1234.56')).toBe(123456);
  });

  test('is case-insensitive on the GHS prefix', () => {
    expect(displayToPesewas('ghs 10.00')).toBe(1000);
  });

  test('strips thousands separators', () => {
    expect(displayToPesewas('1,000,000.00')).toBe(100000000);
  });

  test('trims surrounding whitespace', () => {
    expect(displayToPesewas('   GHS 1.01   ')).toBe(101);
  });

  test('parses sub-GHS values', () => {
    expect(displayToPesewas('0.09')).toBe(9);
    expect(displayToPesewas('GHS 0.05')).toBe(5);
  });

  test('pads a single fractional digit to two pesewa digits', () => {
    // "1234.5" is 1234 GHS and 5 tenths-of-a-cedi => 50 pesewas.
    expect(displayToPesewas('1234.5')).toBe(123450);
    expect(displayToPesewas('0.1')).toBe(10);
  });

  test('parses zero', () => {
    expect(displayToPesewas('0')).toBe(0);
    expect(displayToPesewas('GHS 0.00')).toBe(0);
  });

  describe('invalid inputs throw', () => {
    test('throws TypeError on a non-string', () => {
      expect(() => displayToPesewas(123)).toThrow(TypeError);
      expect(() => displayToPesewas(null)).toThrow(TypeError);
      expect(() => displayToPesewas(undefined)).toThrow(TypeError);
      expect(() => displayToPesewas({})).toThrow(TypeError);
    });

    test('throws on an empty / whitespace-only string', () => {
      expect(() => displayToPesewas('')).toThrow();
      expect(() => displayToPesewas('   ')).toThrow();
    });

    test('throws on a negative amount', () => {
      expect(() => displayToPesewas('-1')).toThrow();
      expect(() => displayToPesewas('GHS -1.00')).toThrow();
    });

    test('throws on more than two fractional digits', () => {
      expect(() => displayToPesewas('1.234')).toThrow();
    });

    test('throws on non-numeric garbage', () => {
      expect(() => displayToPesewas('abc')).toThrow();
      expect(() => displayToPesewas('1.2.3')).toThrow();
      expect(() => displayToPesewas('GHS')).toThrow();
    });
  });
});

describe('round-trip exactness (no floating-point drift)', () => {
  // Representative values spanning zero, sub-GHS, whole cedis, boundaries,
  // and large multi-comma amounts.
  const representative = [
    0,
    1,
    9,
    99,
    100,
    101,
    999,
    1000,
    12345,
    99999,
    100000,
    123456,
    100000000,
    123456789012,
    // 99,999,999,999,999.99 GHS worth of pesewas — the top of the Account
    // balance range (9_999_999_999_999) is comfortably within this.
    9999999999999,
  ];

  test.each(representative)(
    'pesewas -> display -> pesewas returns %i exactly',
    (pesewas) => {
      const display = pesewasToDisplay(pesewas);
      const roundTripped = displayToPesewas(display);
      expect(roundTripped).toBe(pesewas);
      // The recovered value is an exact integer, never a drifted float.
      expect(Number.isInteger(roundTripped)).toBe(true);
    }
  );

  test('round-trips a dense sweep of sub-GHS and boundary values exactly', () => {
    // 0..999 pesewas exercises every zero-padding and carry case at the
    // GHS/pesewa boundary.
    for (let pesewas = 0; pesewas <= 999; pesewas += 1) {
      const roundTripped = displayToPesewas(pesewasToDisplay(pesewas));
      expect(roundTripped).toBe(pesewas);
    }
  });

  test('round-trips pseudo-random safe values exactly (drift sentinel)', () => {
    // Values that would be prone to float error if any division/multiplication
    // were done in floating point (e.g. 1_234_567_890_1 style magnitudes).
    let seed = 123456789;
    const nextInt = (maxExclusive) => {
      // Simple deterministic LCG so failures are reproducible.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % maxExclusive;
    };

    for (let i = 0; i < 500; i += 1) {
      const pesewas = nextInt(9999999999999 + 1); // within Account balance range
      const roundTripped = displayToPesewas(pesewasToDisplay(pesewas));
      expect(roundTripped).toBe(pesewas);
    }
  });
});
