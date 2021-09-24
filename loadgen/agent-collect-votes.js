// @ts-check
import { E } from '@agoric/eventual-send';
import { Far, fulfillToStructure } from '@agoric/marshal';
import { observeIteration } from '@agoric/notifier';
import { AmountMath } from '@agoric/ertp';
import { stringifyNat } from '@agoric/ui-components/src/display/natValue/stringifyNat';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  QuorumRule,
  ElectionType,
  ChoiceMethod,
} from '@agoric/governance/src/question.js';

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/governance/exported.js';
import { pursePetnames } from './petnames';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

const { quote: q } = assert;

const { entries } = Object;

/**
 * @typedef { import('./task-collect-votes').Home } Home
 * @typedef { import('./task-collect-votes').Bundle } Bundle
 */

/**
 * @param {Home} home
 */
async function allocateFees(home) {
  const { faucet, wallet } = home;

  function disp(amount) {
    return stringifyNat(amount.value, 6, 6);
  }

  console.error(`collect-votes: allocating fees`);
  const runPurse = E(wallet).getPurse(pursePetnames.RUN);

  const run = await E(runPurse).getCurrentAmount();
  if (AmountMath.isEmpty(run)) {
    throw Error(`no RUN, collect-votes cannot proceed`);
  }
  const someRun = AmountMath.make(run.brand, run.value / 3n);

  // TODO: change to the appropriate amounts
  // setup: transfer 33% of our initial RUN to the feePurse
  console.error(
    `collect-votes: depositing ${disp(someRun)} into the fee purse`,
  );
  const feePurse = E(faucet).getFeePurse(); // faucet? why?
  const feePayment = await E(runPurse).withdraw(someRun);
  await E(feePurse).deposit(feePayment);
  return E(feePurse).getCurrentAmount();
}

/**
 * committeeRegistrar.js expects a certain form of Terms; exporting a type
 * for them in the API would be nice.
 *
 * ISSUE: ideally, zoe would use a parameter rather than any for Terms.
 *
 * @typedef {{ committeeName: string, committeeSize: number }} CommitteeRegistrarTerms
 */

/**
 * @param {[key: string, home: Home, registrarBundle: Bundle, counterBundle: Bundle]} args
 */
export default async function startAgent([
  key,
  home,
  registrarBundle,
  counterBundle,
]) {
  const { zoe, scratch, chainTimerService: timer } = home;

  /** @param { Record<string, unknown> } stuff */
  function saveToRepl(stuff) {
    entries(stuff).map(
      ([prop, val]) => E(home.scratch).set(prop, val), // send-only
    );
  }

  async function* play() {
    yield ['allocating fees'];
    await allocateFees(home);

    yield [` +++ agent installing contracts`];
    /** @type { Record<string, Installation> } */
    const inst = await fulfillToStructure(
      harden({
        committeeRegistrar: E(zoe).install(registrarBundle),
        counter: E(zoe).install(counterBundle),
      }),
    );
    saveToRepl({ inst });

    yield [
      ` +++ When a question is posed,
       it is only with respect to a particular Registrar,
       (which identifies a collection of eligible voters)
       and a particular vote counting contract.`,
    ];
    /** @type { CommitteeRegistrarTerms } */
    const committeeTerms = {
      committeeName: 'The Three Stooges',
      committeeSize: 3,
    };
    /** @type {Promise<{ creatorFacet: ERef<RegistrarCreatorFacet>, publicFacet: ERef<RegistrarPublic> }>} */
    const stoogesReg = E(zoe).startInstance(
      inst.committeeRegistrar,
      {},
      committeeTerms,
    );
    saveToRepl({ stoogesReg });

    /** @type { QuestionSpec } */
    const q1 = {
      method: ChoiceMethod.UNRANKED,
      issue: { text: 'What time should we meet?' },
      positions: [{ text: 'Tue 9am' }, { text: 'Wed 10am' }],
      electionType: ElectionType.SURVEY,
      maxChoices: 1,
      closingRule: { deadline: 20n, timer },
      quorumRule: QuorumRule.MAJORITY,
      tieOutcome: { text: 'Tue 9am' },
    };
    saveToRepl({ q1 });

    yield [` +++ reg.addQuestion(${q(inst.counter)}, ${q(q1)})`];
    const q1rP = E(E.get(stoogesReg).creatorFacet).addQuestion(
      inst.counter,
      q1,
    );

    yield [
      ` +++ Voters get a voting facet via an invitation,
        so they're sure they're connected to
        the Registrar that's responsible for this vote.`,
    ];
    /** @param { ERef<Invitation> } inv */
    const getResult = (inv) => E(E(zoe).offer(inv)).getOfferResult();
    /**
     * @typedef { any } CommitteeVoter // TODO
     * @type { ERef<Record<string, CommitteeVoter>> }
     */
    const rightsP = E(E.get(stoogesReg).creatorFacet)
      .getVoterInvitations()
      .then(([iLarry, iMoe, iCurly]) =>
        fulfillToStructure(
          harden({
            Larry: getResult(iLarry),
            Moe: getResult(iMoe),
            Curly: getResult(iCurly),
          }),
        ),
      );
    rightsP.then((rights) => saveToRepl({ rights }));

    yield [
      `They can subscribe with the registrar to get a list of new questions.`,
    ];
    saveToRepl({ observeIteration });
    const detailsP = new Promise((resolve) =>
      observeIteration(
        E(E.get(stoogesReg).publicFacet).getQuestionSubscription(),
        Far('voting observer', {
          /** @param { QuestionDetails } details */
          updateState: async (details) => resolve(details),
        }),
      ),
    );
    detailsP.then((details) => saveToRepl({ details }));

    yield [
      ` +++ Voters cast their vote by sending their selected list of positions
       to their registrar, which they know and trust.`,
    ];
    await Promise.all([
      rightsP,
      detailsP,
    ]).then(([rights, { questionHandle }]) =>
      Promise.all([
        E(rights.Larry).castBallotFor(questionHandle, [{ text: 'Tue 9am' }]),
        E(rights.Moe).castBallotFor(questionHandle, [{ text: 'Tue 9am' }]),
        E(rights.Curly).castBallotFor(questionHandle, [{ text: 'Wed 10am' }]),
      ]),
    );

    yield [
      `+++ The only vote counter currently is the BinaryVoteCounter,
       At the end, it looks for a majority winner and announces that.`,
    ];
    const result = await q1rP.then((q1r) =>
      E(E(zoe).getPublicFacet(q1r.instance))
        .getOutcome()
        .then((outcome) => [`vote outcome: ${q(outcome)}`])
        .catch((e) => [`vote failed ${e}`]),
    );
    yield result;

    return ['agent done.'];
  }

  const playing = play();
  let done = false;

  const agent = Far('vote collector', {
    async doCollectVotes() {
      if (done) {
        return ['doCollectVotes@@ done'];
      }
      console.error('doCollectVotes@@');
      const step = await playing.next();
      if (step.done) {
        console.error('DONE!');
        done = true;
        return ['@@done'];
      }
      return step.value;
    },
  });

  console.error(` +++ agent storing itself to scratch`);
  // stash everything needed for each cycle under the key on the solo node
  await E(scratch).set(key, agent);
  console.error(`vote counter ready for cycles`);
  return agent;
}
