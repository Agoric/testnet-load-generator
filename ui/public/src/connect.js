// @ts-check
/* globals document */
import { rpc } from '../lib/socket';
import { activateSocket as startApi } from '../lib/api-client';
import { activateSocket as startBridge } from '../lib/wallet-client';

const $messages = /** @type {HTMLDivElement} */ (document.getElementById(
  `messages`,
));
const $debug = /** @type {HTMLInputElement} */ (document.getElementById(
  'debug',
));

function debugChange() {
  // console.log('checked', $debug.checked);
  if ($debug.checked) {
    $messages.style.display = '';
  } else {
    $messages.style.display = 'none';
  }
}
$debug.addEventListener('change', debugChange);
debugChange();

function linesToHTML(lines) {
  return lines
    .split('\n')
    .map(
      (l) =>
        l
          // These replacements are for securely inserting into .innerHTML, from
          // https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#rule-1-html-encode-before-inserting-untrusted-data-into-html-element-content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/\//g, '&#x2F;')

          // These two replacements are just for word wrapping, not security.
          .replace(/\t/g, '  ') // expand tabs
          .replace(/ {2}/g, ' &nbsp;'), // try preserving whitespace
    )
    .join('<br />');
}

/**
 * @param {string} endpointPath
 * @param {(obj: { type: string, data: any }) => void} recv
 * @param {string} [query='']
 */
export const connect = (endpointPath, recv, query = '') => {
  const statusId = endpointPath === 'wallet' ? 'wallet-status' : `api-status`;
  const $status = /** @type {HTMLSpanElement} */ (document.getElementById(
    statusId,
  ));
  $status.innerHTML = 'Connecting...';

  const endpoint =
    endpointPath === 'wallet' ? `/private/wallet-bridge${query}` : endpointPath;

  /**
   * @param {{ type: string, data: any}} obj
   */
  const send = (obj) => {
    const $m = document.createElement('div');
    $m.className = `message send ${endpointPath}`;
    $m.innerHTML = `${endpointPath}> ${linesToHTML(
      JSON.stringify(obj, null, 2),
    )}`;
    $messages.appendChild($m);
    console.log(`${endpointPath}>`, obj);
    return rpc(obj, endpoint);
  };

  /**
   * @type {(value?: any) => void}
   */
  let resolve;
  /**
   * @type {(reason?: any) => void}
   */
  let reject;
  const sendP = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const activator = endpointPath === 'wallet' ? startBridge : startApi;
  activator(
    {
      onConnect() {
        $status.innerHTML = 'Connected';
        resolve(send);
      },
      /** @param {Record<string, unknown>} obj */
      onMessage(obj) {
        if (!obj || typeof obj.type !== 'string') {
          return;
        }
        const $m = document.createElement('div');
        $m.className = `message receive ${endpointPath}`;

        const displayObj = { ...obj };
        if (obj.type === 'walletUpdatePurses' && typeof obj.data === 'string') {
          // This returns JSON for now.
          displayObj.data = JSON.parse(obj.data);
        }

        $m.innerHTML = `${endpointPath}< ${linesToHTML(
          JSON.stringify(displayObj, null, 2),
        )}`;
        // $m.innerText = `${endpointPath}< ${JSON.stringify(obj)}`;
        $messages.appendChild($m);
        console.log(`${endpointPath}<`, obj);
        recv(obj);
      },
      onDisconnect() {
        $status.innerHTML = 'Disconnected';
        reject();
      },
    },
    endpoint,
  );

  return sendP;
};
