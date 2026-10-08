/**
 * Integer-safe money helpers for MyBanking.
 *
 * Money is stored and transmitted as INTEGER PESEWAS (100 pesewas = 1 GHS).
 * All math here operates on integers only — never divide the stored pesewa
 * value by 100 as a float, to avoid floating-point drift.
 */

export const PESEWAS_PER_GHS = 100;

// Upper bound mirrors the backend guard.
const MAX_PESEWAS = 999999999999;

/**
 * Format integer pesewas as a GHS display string.
 *
 * e.g. 123456 -> 'GHS 1,234.56', 10 -> 'GHS 0.10', 0 -> 'GHS 0.00'.
 *
 * @param {number} pesewas non-negative safe integer
 * @returns {string}
 * @throws {TypeError} on non-integer or negative input
 */
export function pesewasToDisplay(pesewas) {
  if (
    typeof pesewas !== 'number' ||
    !Number.isSafeInteger(pesewas) ||
    pesewas < 0
  ) {
    throw new TypeError(
      'pesewasToDisplay expects a non-negative safe integer',
    );
  }

  // Integer-only split: no float division of the stored value.
  const whole = Math.trunc(pesewas / PESEWAS_PER_GHS);
  const fraction = pesewas % PESEWAS_PER_GHS;

  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionStr = String(fraction).padStart(2, '0');

  return `GHS ${wholeStr}.${fractionStr}`;
}

/**
 * Parse a GHS input string into integer pesewas.
 *
 * Accepts '1234.56', 'GHS 1,234.56', '10', optionally with a 'GHS' prefix,
 * commas, and surrounding whitespace. Up to 2 decimal places.
 *
 * @param {string} str
 * @returns {number} integer pesewas
 * @throws {TypeError} on non-string input
 * @throws {RangeError} on malformed or out-of-range input
 */
export function displayToPesewas(str) {
  if (typeof str !== 'string') {
    throw new TypeError('displayToPesewas expects a string');
  }

  // Strip optional 'GHS' prefix (case-insensitive), commas, and whitespace.
  const cleaned = str
    .replace(/ghs/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '');

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new RangeError(`Malformed GHS amount: "${str}"`);
  }

  const whole = Number(match[1]);
  // Pad the fractional part to exactly 2 digits so '.5' => 50 pesewas.
  const fractionStr = (match[2] || '').padEnd(2, '0');
  const fraction = Number(fractionStr);

  // Integer-only composition — no float arithmetic.
  const pesewas = whole * PESEWAS_PER_GHS + fraction;

  if (!Number.isSafeInteger(pesewas) || pesewas < 0 || pesewas > MAX_PESEWAS) {
    throw new RangeError(`GHS amount out of range: "${str}"`);
  }

  return pesewas;
}

/**
 * Validate an integer pesewa amount against the backend bounds.
 *
 * @param {number} pesewas
 * @returns {boolean} true if integer AND >= 1 AND <= MAX_PESEWAS
 */
export function isValidPesewaAmount(pesewas) {
  return (
    typeof pesewas === 'number' &&
    Number.isInteger(pesewas) &&
    pesewas >= 1 &&
    pesewas <= MAX_PESEWAS
  );
}
