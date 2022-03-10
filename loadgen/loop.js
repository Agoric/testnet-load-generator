/* global setInterval clearInterval setTimeout clearTimeout */

import { performance } from 'perf_hooks';
import http from 'http';

import { E } from '@agoric/eventual-send';

import { makeAuthBroker } from './firebase/auth.js';
import { makeClientConnectionHandlerFactory } from './firebase/client.js';
import { deepEquals } from './firebase/admin/helpers.js';

import { prepareLoadgen } from './prepare-loadgen.js';
import { prepareFaucet } from './task-tap-faucet.js';
import { prepareAMMTrade } from './task-trade-amm.js';
// import { prepareVaultCycle } from './task-create-vault.js';

const sortAndFilterNullish = (obj) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => value != null)
      .sort(([aKey], [bKey]) => aKey - bKey)
      .map(([key, value]) => [
        key,
        typeof value === 'object' ? sortAndFilterNullish(value) : value,
      ]),
  );

let pushHandlerBroker;

// we want mostly AMM tasks, and only occasional vault tasks

let currentConfig = sortAndFilterNullish({
  faucet: null, // e.g. { interval=60, limit=1, wait=0 }
  amm: null, // e.g. { interval: 120}
  // vault: null, // e.g. { interval: 120, wait: 60 }
});

let pushHandler = null;
let pushBroker = null;

const tasks = {
  faucet: [prepareFaucet],
  amm: [prepareAMMTrade],
  // vault: [prepareVaultCycle],
};

const runners = {}; // name -> { cycle, stop?, limit, pending }
const status = {}; // name -> { active, succeeded, failed, next } // JSON-serializable

function logdata(data) {
  const timeMS = performance.timeOrigin + performance.now();
  const time = timeMS / 1000;
  // every line that starts with '{' should be JSON-parseable
  console.log(JSON.stringify({ time, ...data }));
}

function maybeStartOneCycle(name) {
  logdata({ type: 'status', status });
  const s = status[name];
  const r = runners[name];
  if (s.active >= r.limit) {
    console.log(
      `not starting ${name}, ${s.active} active reached limit ${r.limit}`,
    );
    return;
  }
  if (!r.pending) {
    console.log(`not starting ${name}, no pending (${s.active} active)`);
    return;
  }
  r.pending -= 1;
  const seq = s.next;
  s.next += 1;
  s.active += 1;
  console.log(`starting ${name} [${seq}], active=${s.active} at ${new Date()}`);
  logdata({ type: 'start', task: name, seq });
  if (pushHandler) {
    pushHandler.recordTaskStart(name, seq);
  }
  runners[name]
    .cycle()
    .then(
      () => {
        console.log(` finished ${name} at ${new Date()}`);
        logdata({ type: 'finish', task: name, seq, success: true });
        if (pushHandler) {
          pushHandler.recordTaskEnd(name, seq, true);
        }
        s.succeeded += 1;
      },
      (err) => {
        console.log(`[${name}] failed:`, err);
        logdata({ type: 'finish', task: name, seq, success: false });
        if (pushHandler) {
          pushHandler.recordTaskEnd(name, seq, false);
        }
        s.failed += 1;
      },
    )
    .then(() => {
      s.active -= 1;
      console.log(` ${name}.active now ${s.active}`);
      maybeStartOneCycle(name);
    });
}

function checkConfig(config) {
  const known = Object.keys(runners).join(',');
  let ok = true;
  for (const [name, data] of Object.entries(config)) {
    if (!runners[name]) {
      console.log(`state[${name}]: no such task, have ${known}`);
      ok = false;
    }
    if (!data) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-unused-vars
    const { interval = 60, limit = 1, wait = 0 } = data;
    if (interval < 1) {
      console.log(`[${name}].interval (${interval}) too short, please >=1.0 s`);
      ok = false;
    }
  }
  return ok;
}

// curl http://127.0.0.1:3352/config
// curl -X PUT --data '{"faucet":60}' http://127.0.0.1:3352/config
// curl -X PUT --data '{"faucet":null}' http://127.0.0.1:3352/config

function updateConfig(config) {
  for (const [name, r] of Object.entries(runners)) {
    if (r.stop) {
      r.stop();
      r.stop = undefined;
    }
    const { limit = 1 } = config[name] || { limit: 0 };
    r.limit = Math.max(0, Math.round(limit));
    r.pending = Math.min(r.pending, r.limit);
  }
  for (const [name, data] of Object.entries(config)) {
    if (!data) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const { interval = 60, wait = 0 } = data;
    function bump() {
      const r = runners[name];
      r.pending = Math.min(r.pending + 1, r.limit);
      maybeStartOneCycle(name);
    }
    function start() {
      const timer = setInterval(bump, Math.min(interval * 1000, 2 ** 31 - 1));
      runners[name].stop = () => clearInterval(timer);
      bump();
    }
    const timer = setTimeout(start, Math.min(wait * 1000, 2 ** 31 - 1));
    runners[name].stop = () => clearTimeout(timer);
  }
}

const checkAndUpdateConfig = (newConfigOrNull) => {
  const newConfig = sortAndFilterNullish(newConfigOrNull || {});
  if (checkConfig(newConfig) && !deepEquals(newConfig, currentConfig)) {
    console.log(`updating config:`);
    console.log(`from: ${JSON.stringify(currentConfig)}`);
    console.log(`  to: ${JSON.stringify(newConfig)}`);
    currentConfig = newConfig;
    updateConfig(currentConfig);
    if (pushHandler) {
      pushHandler.configUpdated(currentConfig);
    }
  }
};

function handleConfigRequest(req, res, get, set) {
  if (req.method === 'PUT') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        await set(body);
        res.end('config updated\n');
      } catch (err) {
        console.log(`config update error`, err);
        res.end(`config error ${err}\n`);
      }
    });
  } else {
    Promise.resolve(get()).then((config) => res.end(`${config}\n`));
  }
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // console.log(`pathname ${url.pathname}, ${req.method}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    if (url.pathname === '/config') {
      handleConfigRequest(
        req,
        res,
        () => JSON.stringify(currentConfig),
        (body) => {
          const newConfig = JSON.parse(body);
          checkAndUpdateConfig(newConfig);
        },
      );
    } else if (url.pathname === '/push-config') {
      handleConfigRequest(
        req,
        res,
        () => (pushHandler ? pushHandler.getId() : ''),
        async (newConfig) => {
          const newPushBroker = newConfig.trim()
            ? await pushHandlerBroker(newConfig)
            : null;
          if (pushBroker === newPushBroker) {
            if (pushBroker) {
              // Make sure connection is updated with new token
              await pushBroker.connect();
            }
            return;
          }

          if (pushBroker) {
            await pushBroker.disconnect();
            pushHandler.setRequestedConfigHandler(null);
            pushHandler = null;
          }
          pushBroker = newPushBroker;
          if (pushBroker) {
            await pushBroker.connect();
            pushHandler = pushBroker.configFacet;
            pushHandler.setRequestedConfigHandler(checkAndUpdateConfig);
            pushHandler.configUpdated(currentConfig);
          }

          console.log(
            `new push config:`,
            pushHandler ? pushHandler.getId() : 'none',
          );
        },
      );
    } else {
      res.end(`${JSON.stringify(status)}\n`);
    }
  });
  server.listen(3352, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.on('listening', resolve).on('error', reject);
  });
}

/**
 *
 * @param { ERef<import('./types').Home> } homePromise
 * @param { import('./types').DeployPowers } deployPowers
 */
export default async function runCycles(homePromise, deployPowers) {
  // const home = await homePromise;
  // console.log(`got home`);
  // const { chainTimerService } = home;
  // let time = await E(chainTimerService).getCurrentTimestamp();
  // console.log(`got chain time:`, time);
  // return;

  await prepareLoadgen(homePromise, deployPowers);

  for (const [name, [prepare]] of Object.entries(tasks)) {
    // eslint-disable-next-line no-await-in-loop
    const cycle = await prepare(homePromise, deployPowers);
    runners[name] = { cycle, limit: 0, pending: 0, stop: undefined };
    status[name] = { active: 0, succeeded: 0, failed: 0, next: 0 };
  }
  const { myAddressNameAdmin } = E.get(homePromise);
  const myAddr = await E(myAddressNameAdmin).getMyAddress();
  const connectionHandlerFactory = makeClientConnectionHandlerFactory(myAddr);
  pushHandlerBroker = makeAuthBroker(connectionHandlerFactory);
  console.log('all tasks ready');
  await startServer();
  console.log(`server running for ${myAddr} on 127.0.0.1:3352`);

  if (!checkConfig(currentConfig)) {
    throw Error('bad config');
  }
  updateConfig(currentConfig);
  console.log(`updated config: ${JSON.stringify(currentConfig)}`);
  await new Promise(() => 0); // runs forever
}
