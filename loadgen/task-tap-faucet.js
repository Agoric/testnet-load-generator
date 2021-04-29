import { E } from '@agoric/eventual-send';

// set up a fungible faucet contract, and a purse to match, if they aren't already present
export async function prepareFaucet(homePromise, deployPowers) {
  const KEY = 'fungible';
  const home = await homePromise;
  const { zoe, scratch } = home;
  let tools = await E(scratch).get(KEY);
  if (!tools) {
    const { bundleSource } = deployPowers;
    const bundle = await bundleSource(
      require.resolve(`@agoric/zoe/src/contracts/mintPayments`),
    );
    const installation = await E(zoe).install(bundle);
    const { creatorFacet, instance, publicFacet } = await E(zoe).startInstance(
      installation,
    );
    const tokenIssuer = await E(publicFacet).getTokenIssuer();
    // Bob makes a purse for tokens
    const bobPurse = await E(tokenIssuer).makeEmptyPurse();
    // stash everything needed for each cycle under the key on the solo node
    tools = { zoe, creatorFacet, bobPurse };
    const id = await E(scratch).set(KEY, tools);
    console.log(`faucet ready for cycles`);
  }

  const { creatorFacet, bobPurse } = tools;

  async function faucetCycle() {
    // make ourselves an invitation
    const invitationP = E(creatorFacet).makeInvitation();
    // claim it
    const seatP = E(zoe).offer(invitationP); // pipeline stall: bug #2846
    const paymentP = E(seatP).getPayout('Token');
    const payment = await paymentP;
    await E(bobPurse).deposit(payment);
    const amount = await E(bobPurse).getCurrentAmount();
    console.log(`new purse balance`, amount.value, new Date());
  }

  /* faucetCycle causes the following message batches:
    solo->chain: makeInvitation, offer(invitationP[2]), getPayout
    chain->solo: resolve invitationP[1]
    solo->chain: resolve invitationP[2]
    chain->solo: resolve seatP, resolve paymentP
    solo->chain: deposit
    chain->solo: resolve (ignored result of deposit)
    solo->chain: getCurrentAmount
    chain->solo: resolve amount
   */
  return faucetCycle;
}

/*
  // TODO: exercise a more complex form, using an Offer and the wallet 
  async function cycleMore() {
  const wallet = home.wallet;
  const waf = await E(wallet).getAdminFacet();
  console.log('got wallet admin facet');

    // make ourselves an invitation
    const invitation = E(creatorFacet).makeInvitation();

    // give it to the wallet
    const offerConfig = {
      id,
      invitation,
      installationHandleBoardId: INSTALLATION_BOARD_ID,
      instanceHandleBoardId: INSTANCE_BOARD_ID,
      proposalTemplate: {
        want: {
          Token: {
            pursePetname: tokenPursePetname,
            value: 1000,
          },
        },
      },
    };
    E(waf).addOffer(offerConfig);

    // make the wallet accept it
    // ???

    // check the balance
    const amount = await E(bobPurse).getCurrentAmount();
    console.log(`new purse balance`, amount.value);
  }
  */
