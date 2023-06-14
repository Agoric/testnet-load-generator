// @ts-check
import { assert, details } from '@agoric/assert';

const CONVENTIONAL_DECIMAL_PLACES = 2;

export const roundToDecimalPlaces = (
  rightOfDecimalStr = '',
  decimalPlaces = 0,
) => {
  assert.typeof(rightOfDecimalStr, 'string');
  assert.typeof(decimalPlaces, 'number');
  assert(
    decimalPlaces >= 0,
    details`decimalPlaces must be a number greater or equal to 0`,
  );
  // If rightOfDecimalStr isn't long enough, pad with 0s
  const strPadded = rightOfDecimalStr.padEnd(decimalPlaces, '0');
  // This is rounding down to the floor
  // TODO: round more appropriately, maybe bankers' rounding
  const strRounded = strPadded.substring(0, decimalPlaces);
  return strRounded;
};

/**
 * @param {NatValue | null} natValue
 * @param {number} [decimalPlaces]
 * @param {number} [placesToShow]
 * @returns {string}
 */
export const stringifyNat = (
  natValue = null,
  decimalPlaces = 0,
  placesToShow = CONVENTIONAL_DECIMAL_PLACES,
) => {
  if (natValue === null) {
    return '';
  }
  assert.typeof(natValue, 'bigint');
  const str = `${natValue}`.padStart(decimalPlaces, '0');
  const leftOfDecimalStr = str.substring(0, str.length - decimalPlaces) || '0';
  const rightOfDecimalStr = roundToDecimalPlaces(
    `${str.substring(str.length - decimalPlaces)}`,
    placesToShow,
  );

  if (rightOfDecimalStr === '') {
    return leftOfDecimalStr;
  }

  return `${leftOfDecimalStr}.${rightOfDecimalStr}`;
};

/**
 * @param {Amount<'nat'>} amount
 * @param {number} [decimalPlaces]
 */
export function disp(amount, decimalPlaces = 6) {
  return stringifyNat(amount.value, decimalPlaces, 6);
}
