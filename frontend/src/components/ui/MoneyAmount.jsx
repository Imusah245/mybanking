/**
 * MoneyAmount — renders integer pesewas as a formatted GHS string.
 *
 * props:
 *   pesewas   — non-negative integer pesewa value
 *   className — extra classes merged onto the span
 *   signed    — optional: 'credit' prefixes a '+' and colors green,
 *               'debit' prefixes a '-' and colors red. When unset, the
 *               amount renders in the default (inherited) color.
 *
 * Formatting is delegated to pesewasToDisplay from lib/money, so the GHS
 * conversion stays integer-safe and consistent across the app.
 */

import { pesewasToDisplay } from '../../lib/money';

export default function MoneyAmount({ pesewas, className = '', signed }) {
  let display;
  try {
    display = pesewasToDisplay(pesewas);
  } catch {
    display = 'GHS 0.00';
  }

  let prefix = '';
  let colorClass = '';

  if (signed === 'credit') {
    prefix = '+';
    colorClass = 'text-green-600';
  } else if (signed === 'debit') {
    prefix = '-';
    colorClass = 'text-red-600';
  }

  return (
    <span className={`font-medium tabular-nums ${colorClass} ${className}`}>
      {prefix}
      {display}
    </span>
  );
}
