/**
 * MAIN-world entry, injected at document_start on www.geeksforgeeks.org.
 * Has no access to extension APIs; it only forwards submission traffic to the
 * isolated content script via window.postMessage.
 */
import { installNetworkObserver } from '../shared/network-observer';
import { GFG_CHANNEL, gfgObservationRule } from './gfg-api';

installNetworkObserver(window, {
  channel: GFG_CHANNEL,
  classify: gfgObservationRule,
  baseUrl: () => window.location.href,
  post: (message) => {
    window.postMessage(message, window.location.origin);
  },
});
