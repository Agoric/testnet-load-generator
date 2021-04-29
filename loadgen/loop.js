import http from 'http';
import { prepareFaucet } from './task-tap-faucet';

const tasks = {
  faucet: [prepareFaucet],
};

const runners = {}; // name -> { cycle, timer }
const status = {}; // name -> { active, succeeded, failed } // JSON-serializable

function startOneCycle(name) {
  const s = status[name];
  s.active += 1;
  console.log(`starting ${name}, active=${s.active}`);
  runners[name]
    .cycle()
    .then(
      () => {
        console.log(` finished ${name}`);
        s.succeeded += 1;
      },
      (err) => {
        console.log(`[${name}] failed:`, err);
        s.failed += 1;
      },
    )
    .then(() => {
      s.active -= 1;
      console.log(` ${name}.active now ${s.active}`);
    });
}

function checkConfig(config) {
  const known = Object.keys(runners).join(',');
  let ok = true;
  for (const [name, interval] of Object.entries(config)) {
    if (!runners[name]) {
      console.log(`state[${name}]: no such task, have ${known}`);
      ok = false;
    }
    if (interval === 0 || (interval && interval < 1)) {
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
  for (const r of Object.values(runners)) {
    if (r.timer) {
      clearInterval(r.timer);
      r.timer = undefined;
    }
  }
  for (const [name, interval] of Object.entries(config)) {
    if (interval) {
      runners[name].timer = setInterval(
        () => startOneCycle(name),
        interval * 1000,
      );
    }
  }
}

let oldConfig;

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`pathname ${url.pathname}, ${req.method}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    if (url.pathname === '/config') {
      if (req.method === 'PUT') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const newConfig = JSON.parse(body);
            if (checkConfig(newConfig)) {
              console.log(`updating config:`);
              console.log(`from: ${JSON.stringify(oldConfig)}`);
              console.log(`  to: ${JSON.stringify(newConfig)}`);
              updateConfig(newConfig);
              oldConfig = newConfig;
            }
            res.end('config updated\n');
          } catch (err) {
            console.log(`config update error`, err);
            res.end(`config error ${err}\n`);
          }
        });
      } else {
        res.end(`${JSON.stringify(oldConfig)}\n`);
      }
    } else {
      res.end(`${JSON.stringify(status)}\n`);
    }
  });
  server.listen(3352, '127.0.0.1');
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
    runners[name] = { cycle, timer: undefined };
    status[name] = { active: 0, succeeded: 0, failed: 0 };
  }
  startServer();

  const config = {
    faucet: 60,
  };

  if (!checkConfig(config)) {
    throw Error('bad config');
  }
  updateConfig(config);
  oldConfig = config;
  console.log(`updated config: ${JSON.stringify(config)}`);
  await new Promise(() => 0); // runs forever
}
