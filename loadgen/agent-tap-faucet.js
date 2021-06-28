import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

export default async function startAgent([key, home, faucetBundle]) {
  const { zoe, scratch } = home;
  console.debug(` +++ agent installing bundle`);
  const installation = await E(zoe).install(faucetBundle);
  console.debug(` +++ agent doing startInstance`);
  const { creatorFacet, publicFacet } = await E(zoe).startInstance(
    installation,
  );
  console.debug(` +++ agent did startInstance, doing getTokenIssuer`);
  const tokenIssuer = await E(publicFacet).getTokenIssuer();
  console.debug(` +++ agent doing makeEmptyPurse`);
  // Bob makes a purse for tokens
  const bobPurse = await E(tokenIssuer).makeEmptyPurse();
  console.debug(` +++ agent defining agent`);

  const agent = Far('faucet agent', {
    async doFaucetCycle() {
      // make ourselves an invitation
      const invitationP = E(creatorFacet).makeInvitation();
      // claim it
      const seatP = E(zoe).offer(invitationP); // pipeline stall: bug #2846
      const paymentP = E(seatP).getPayout('Token');
      const payment = await paymentP;
      await E(bobPurse).deposit(payment);
      return E(bobPurse).getCurrentAmount();
    },
  });

  console.debug(` +++ agent storing itself to scratch`);
  // stash everything needed for each cycle under the key on the solo node
  await E(scratch).set(key, agent);
  console.debug(`faucet ready for cycles`);
  return agent;
}
