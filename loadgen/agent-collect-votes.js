// @ts-check
import { makePromiseKit } from '@agoric/promise-kit';
import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { observeIteration } from '@agoric/notifier';
import { AmountMath } from '@agoric/ertp';
import { stringifyNat } from '@agoric/ui-components/src/display/natValue/stringifyNat';
// eslint-disable-next-line import/no-extraneous-dependencies
import { QuorumRule, ElectionType } from '@agoric/governance/src/question.js';

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/governance/exported.js';
import { pursePetnames } from './petnames';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

const { quote: q } = assert;

const { entries, keys } = Object;

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

  /**
   * @param {string} slot
   * @param {() => Promise<T> } build
   * @returns { Promise<T> }
   *
   * @template T
   */
  const memo = async (slot, build) => {
    const found = await E(scratch).get(slot);
    if (found) {
      console.error(' == cache hit:', slot);
      return found;
    }
    console.error(' == cache miss:', slot);
    const it = await build();
    await E(scratch).set(slot, it);
    console.error(' == cached:', slot);
    return it;
  };

  async function* play() {
    const todo = {
      registrarInstallation: registrarBundle,
      counterInstallation: counterBundle,
    };
    yield ['allocating fees'];
    await memo('workingFees', () => allocateFees(home));

    yield [` +++ agent installing`, ...keys(todo)];
    const [registrarInstallation, counterInstallation] = await Promise.all(
      entries(todo).map(([prop, bundle]) =>
        memo(prop, async () => E(zoe).install(bundle)),
      ),
    );

    /** @type { CommitteeRegistrarTerms } */
    const terms = {
      committeeName: 'The Three Stooges',
      committeeSize: 3,
    };

    yield [` +++ agent starting registrar`];
    /** @type {{ creatorFacet: ERef<RegistrarCreatorFacet>, publicFacet: ERef<RegistrarPublic> }} */
    const { creatorFacet, publicFacet } = await memo(
      'stoogesRegistrar',
      async () => E(home.zoe).startInstance(registrarInstallation, {}, terms),
    );

    yield [` +++ agent getting time`];
    // @ts-ignore ISSUE: Zoe API incomplete?
    const t0 = await E(timer).getCurrentTimestamp();
    const closingRule = { deadline: t0 + 20n * 1000n, timer };
    /** @type { QuestionSpec } */
    const q1 = {
      issue: { text: 'What time should we meet?' },
      positions: [{ text: 'Tue 9am' }, { text: 'Wed 10am' }],
      method: 'unranked',
      closingRule,
      electionType: ElectionType.SURVEY,
      maxChoices: 1,
      quorumRule: QuorumRule.MAJORITY,
      tieOutcome: { text: 'Tue 9am' },
    };
    yield [` +++ agent adding question ${q(q1)}`];
    console.error(`@@@q1 ${q(q1)}`);
    const { instance: counterInstance } = await memo('q1', async () =>
      E(creatorFacet).addQuestion(counterInstallation, q1),
    );

    yield [` +++ agent getting voter invitations, votingRights`];
    /** @type { Promise<CommitteeVoter>[] } */
    const [larry, _moe, _curly] = await memo('votingRights', async () =>
      E(creatorFacet)
        .getVoterInvitations()
        .then((invs) =>
          invs.map((inv) => E(E(zoe).offer(inv)).getOfferResult()),
        ),
    );

    const voted = makePromiseKit();
    observeIteration(
      E(publicFacet).getQuestionSubscription(),
      Far('voting observer', {
        /** @param { QuestionDetails } details */
        updateState: async (details) => {
          const [name, choice] = ['larry', { text: 'Tue 9am' }];
          console.log(`${name} voted for ${q(choice)}`);
          await E(larry).castBallotFor(details.questionHandle, [choice]);
          voted.resolve(undefined);
        },
      }),
    );
    yield [` +++ agent casting ballot: ${larry}`];
    await voted.promise;
    // await memo('larry cast ballot', () => E(larry).castBallotFor(qh, [pos]));

    const counterPublicFacet = E(zoe).getPublicFacet(counterInstance);
    yield await E(counterPublicFacet)
      .getOutcome()
      .then((outcome) => [`vote outcome: ${q(outcome)}`])
      .catch((e) => [`vote failed ${e}`]);
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
