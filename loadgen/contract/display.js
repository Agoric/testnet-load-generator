import { stringifyNat } from '@agoric/ui-components/src/display/natValue/stringifyNat.js';

// TODO: const { decimalPlaces } = await E(brand).getDisplayInfo(); // or E(issuer)

export function disp(amount) {
  return stringifyNat(amount.value, 6, 6);
}
