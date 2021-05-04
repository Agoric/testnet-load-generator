import { stringifyNat } from '@agoric/ui-components/src/display/natValue/stringifyNat';

export function disp(amount) {
  return stringifyNat(amount.value, 6);
}
