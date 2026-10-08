/**
 * Shared client-side validators matching the backend rules.
 *
 * Each validator returns `null` when the value is valid, or an error message
 * string when invalid.
 */

import { displayToPesewas, isValidPesewaAmount } from './money.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {string} v
 * @returns {string|null}
 */
export function validateEmail(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Email is required';
  }
  if (v.length > 254) {
    return 'Email must be at most 254 characters';
  }
  if (!EMAIL_RE.test(v)) {
    return 'Enter a valid email address';
  }
  return null;
}

/**
 * @param {string} v
 * @returns {string|null}
 */
export function validatePassword(v) {
  if (typeof v !== 'string') {
    return 'Password is required';
  }
  if (v.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (v.length > 128) {
    return 'Password must be at most 128 characters';
  }
  return null;
}

/**
 * @param {string} v
 * @returns {string|null}
 */
export function validateFirstName(v) {
  if (typeof v !== 'string') {
    return 'First name is required';
  }
  const trimmed = v.trim();
  if (trimmed.length < 1) {
    return 'First name is required';
  }
  if (trimmed.length > 50) {
    return 'First name must be at most 50 characters';
  }
  return null;
}

/**
 * @param {string} v
 * @returns {string|null}
 */
export function validateLastName(v) {
  if (typeof v !== 'string') {
    return 'Last name is required';
  }
  const trimmed = v.trim();
  if (trimmed.length < 1) {
    return 'Last name is required';
  }
  if (trimmed.length > 50) {
    return 'Last name must be at most 50 characters';
  }
  return null;
}

/**
 * Registration phone rule: 10-15 digits only.
 * @param {string} v
 * @returns {string|null}
 */
export function validatePhone(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Phone number is required';
  }
  if (!/^\d{10,15}$/.test(v.trim())) {
    return 'Phone number must be 10-15 digits';
  }
  return null;
}

/**
 * Profile-update phone rule: 7-20 chars of digits, +, -, spaces, parens.
 * @param {string} v
 * @returns {string|null}
 */
export function validateProfilePhone(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Phone number is required';
  }
  const trimmed = v.trim();
  if (trimmed.length < 7 || trimmed.length > 20) {
    return 'Phone number must be 7-20 characters';
  }
  if (!/^[0-9+\-\s()]+$/.test(trimmed)) {
    return 'Phone number contains invalid characters';
  }
  return null;
}

/**
 * @param {string} v
 * @returns {string|null}
 */
export function validateAddress(v) {
  if (typeof v !== 'string') {
    return 'Address is required';
  }
  const trimmed = v.trim();
  if (trimmed.length < 1) {
    return 'Address is required';
  }
  if (trimmed.length > 255) {
    return 'Address must be at most 255 characters';
  }
  return null;
}

/**
 * Valid date of birth that parses and yields age >= 18 as of today.
 * @param {string} v
 * @returns {string|null}
 */
export function validateDateOfBirth(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Date of birth is required';
  }

  const dob = new Date(v);
  if (Number.isNaN(dob.getTime())) {
    return 'Enter a valid date';
  }

  // Threshold = today minus 18 years. DOB must be on or before it.
  const now = new Date();
  const threshold = new Date(
    now.getFullYear() - 18,
    now.getMonth(),
    now.getDate(),
  );

  if (dob.getTime() > threshold.getTime()) {
    return 'You must be at least 18 years old';
  }
  return null;
}

/**
 * Validate a GHS amount input string: must convert to an integer pesewa
 * in [1, 999999999999]. Rejects 0, negatives, non-numeric, >2 decimals.
 * @param {string} v
 * @returns {string|null}
 */
export function validateAmount(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Amount is required';
  }
  try {
    const pesewas = displayToPesewas(v);
    if (!isValidPesewaAmount(pesewas)) {
      return 'Enter an amount between GHS 0.01 and GHS 9,999,999,999.99';
    }
    return null;
  } catch {
    return 'Enter a valid amount (up to 2 decimal places)';
  }
}

/**
 * Recipient account number: exactly 10 digits.
 * @param {string} v
 * @returns {string|null}
 */
export function validateAccountNumber(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    return 'Account number is required';
  }
  if (!/^\d{10}$/.test(v.trim())) {
    return 'Account number must be exactly 10 digits';
  }
  return null;
}
