// @ts-nocheck
import { E } from '@agoric/eventual-send';
import WebSocket from 'ws';
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0';

/**
 * @param {any} homePromise
 * @param {JSONRPCServerAndClient} jrpc
 */
const startService = async (homePromise, jrpc) => {
  const {
    zoe,
  } = await homePromise;

  jrpc.addMethod('hello', async ({ name = 'world' }) => {
    // Just return a delayed message.
    await new Promise(resolve => setTimeout(resolve, 2000));
    return `Hello, ${name}!`;
  });

  jrpc.addMethod('makeError', async ({ message = 'unknown error' }) => {
    throw Error(message);
  });

  jrpc.addMethod('askZoe', async () => {
    return E(zoe).askZoe('something');
  });
};

const runWorkbench = async (homePromise, deployPowers) => {
  const wss = new WebSocket.Server({ port: 8080 });
  console.log('listening on', wss.address());

  // Add JSON-RPC methods
  wss.on('connection', async (socket) => {
    // create a JSON-RPC server
    const send = async obj => socket.send(JSON.stringify(obj));

    const jrpc = new JSONRPCServerAndClient(new JSONRPCServer(), new JSONRPCClient(send));
    await startService(homePromise, jrpc);

    socket.on('message', async (message) => {
      try {
        // Convert message buffer to a string
        const json = message.toString('utf-8');
        const data = JSON.parse(json);

        // Dispatch the message to the appropriate method
        await jrpc.receiveAndSend(data);
      } catch (e) {
        console.error(e);
      }
    });
  });

  // Wait forever.
  await new Promise(() => {});
};


export default runWorkbench;
