/* global setInterval clearInterval setTimeout clearTimeout */
/* eslint-disable no-continue */

import { performance } from 'perf_hooks';
import http from 'http';

import { E } from '@agoric/eventual-send';

import { makeAuthBroker } from './firebase/auth.js';
import { makeClientConnectionHandlerFactory } from './firebase/client.js';

// import { prepareFaucet } from './task-tap-faucet';
// import { prepareAMMTrade } from './task-trade-amm';
// import { prepareVaultCycle } from './task-create-vault';
import { preparePoll } from './task-collect-votes';

let pushHandlerBroker;

// we want mostly AMM tasks, and only occasional vault tasks

let currentConfig = {
  // faucet: null, // or { interval=60, limit=1, wait=0 }
  // amm: null,
  // vault: null,
  // amm: { interval: 120},
  // vault: { interval: 120, wait: 60 },
  poll: { interval: 3 },
};

let pushHandler = null;

const tasks = {
  // faucet: [prepareFaucet],
  // we must start the AMM task before Vault: AMM exchanges some RUN for BLD,
  // and Vault measures the balances
  // amm: [prepareAMMTrade],
  // vault: [prepareVaultCycle],
  poll: [preparePoll],
};

const runners = {}; // name -> { cycle, stop?, limit }
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
      `not starting ${name}, ${s.active} active reached dynamic limit ${r.limit}`,
    );
    return;
  }
  r.limit = Math.max(0, r.limit - 1);
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
      const { limit = 1 } = config[name] || { limit: 0 };
      r.limit = Math.min(r.limit, limit);
    }
  }
  for (const [name, data] of Object.entries(config)) {
    if (!data) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const { interval = 60, limit = 1, wait = 0 } = data;
    function bump() {
      const r = runners[name];
      r.limit = Math.min(r.limit + 1, limit);
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
  const newConfig = newConfigOrNull || {};
  if (checkConfig(newConfig)) {
    console.log(`updating config:`);
    console.log(`from: ${JSON.stringify(currentConfig)}`);
    console.log(`  to: ${JSON.stringify(newConfig)}`);
    currentConfig = newConfig;
    updateConfig(currentConfig);
    if (pushHandler) {
      pushHandler.configUpdated(newConfig);
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
          const newPushHandler = newConfig.trim()
            ? await pushHandlerBroker(newConfig)
            : null;
          if (pushHandler === newPushHandler) return;

          if (pushHandler) {
            pushHandler.disconnect();
            pushHandler.setRequestedConfigHandler(null);
          }
          pushHandler = newPushHandler;
          if (pushHandler) {
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

export default async function runCycles(homePromise, deployPowers) {
  // const home = await homePromise;
  // console.log(`got home`);
  // const { chainTimerService } = home;
  // let time = await E(chainTimerService).getCurrentTimestamp();
  // console.log(`got chain time:`, time);
  // return;

  for (const [name, [prepare]] of Object.entries(tasks)) {
    // eslint-disable-next-line no-await-in-loop
    const cycle = await prepare(homePromise, deployPowers);
    runners[name] = { cycle, limit: 0, stop: undefined };
    status[name] = { active: 0, succeeded: 0, failed: 0, next: 0 };
  }
  const { myAddressNameAdmin } = await homePromise;
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
