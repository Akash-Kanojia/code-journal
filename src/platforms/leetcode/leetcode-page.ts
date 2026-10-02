/**
 * MAIN-world entry, injected at document_start on leetcode.com.
 * Has no access to extension APIs; it only forwards submission traffic to the
 * isolated content script via window.postMessage.
 */
import { installNetworkObserver } from '../shared/network-observer';
import { LEETCODE_CHANNEL, leetCodeObservationRule } from './leetcode-api';

installNetworkObserver(window, {
  channel: LEETCODE_CHANNEL,
  classify: leetCodeObservationRule,
  baseUrl: () => window.location.href,
  post: (message) => {
    window.postMessage(message, window.location.origin);
  },
});
