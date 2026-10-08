/**
 * Monetary display/parsing helpers.
 *
 * All money in this system is stored as integer pesewas (100 pesewas = 1 GHS),
 * per Requirement 15.1. These helpers are for DISPLAY and PARSING ONLY — they
 * are never used in balance arithmetic. Conversions are performed with integer
 * and string operations so no floating-point drift is ever introduced into the
 * underlying integer pesewa values.
 */

const PESEWAS_PER_GHS = 100;

/**
 * Format an integer pesewa amount as a human-readable GHS string.
 *
 * @param {number} pesewas - Non-negative integer number of pesewas.
 * @returns {string} e.g. 123456 -> "GHS 1,234.56"
 * @throws {TypeError} if `pesewas` is not a safe non-negative integer.
 */
export function pesewasToDisplay(pesewas) {
  if (
    typeof pesewas !== 'number' ||
    !Number.isInteger(pesewas) ||
    !Number.isSafeInteger(pesewas) ||
    pesewas < 0
  ) {
    throw new TypeError(
      'pesewasToDisplay expects a non-negative safe integer number of pesewas'
    );
  }

  // Integer-only split: no division that could produce a float.
  const whole = Math.trunc(pesewas / PESEWAS_PER_GHS); // integer cedis
  const fraction = pesewas % PESEWAS_PER_GHS; // 0..99 pesewas

  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionStr = String(fraction).padStart(2, '0');

  return `GHS ${wholeStr}.${fractionStr}`;
}

/**
 * Parse a GHS display/amount string into integer pesewas.
 *
 * Accepts optional "GHS" prefix, thousands separators (commas), surrounding
 * whitespace, and an optional fractional part of up to two digits. Parsing is
 * done entirely on the string's digits so the result is an exact integer with
 * no floating-point rounding.
 *
 * @param {string} value - e.g. "GHS 1,234.56", "1234.5", "1,000", "0.09"
 * @returns {number} integer pesewas (e.g. "GHS 1,234.56" -> 123456)
 * @throws {TypeError} if `value` is not a string.
 * @throws {Error} if `value` is not a well-formed non-negative amount.
 */
export function displayToPesewas(value) {
  if (typeof value !== 'string') {
    throw new TypeError('displayToPesewas expects a string');
  }

  // Normalize: drop a leading currency code/symbol, thousands separators,
  // and surrounding whitespace.
  const normalized = value
    .trim()
    .replace(/^GHS\s*/i, '')
    .replace(/,/g, '')
    .trim();

  // Require a non-negative decimal with up to two fractional digits.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid monetary string: "${value}"`);
  }

  const wholePart = match[1];
  // Pad/truncate fractional part to exactly two digits of pesewas.
  const fractionPart = (match[2] ?? '').padEnd(2, '0');

  const wholePesewas = Number(wholePart) * PESEWAS_PER_GHS;
  const fractionPesewas = Number(fractionPart);

  const pesewas = wholePesewas + fractionPesewas;

  if (!Number.isSafeInteger(pesewas)) {
    throw new Error(`Monetary string out of safe integer range: "${value}"`);
  }

  return pesewas;
}

export default { pesewasToDisplay, displayToPesewas };
