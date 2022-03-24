import { stringifyNat } from '@agoric/ui-components/src/display/natValue/stringifyNat.js';

/**
 * @param {Amount<'nat'>} amount
 * @param {number} [decimalPlaces]
 */
export function disp(amount, decimalPlaces = 6) {
  return stringifyNat(amount.value, decimalPlaces, 6);
}
