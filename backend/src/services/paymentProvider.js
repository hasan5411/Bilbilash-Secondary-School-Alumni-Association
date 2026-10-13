import { env } from '../config/env.js';

/**
 * Payment provider abstraction (provider-independent by design).
 *
 * The business logic in paymentService.js NEVER talks to a gateway directly —
 * it always goes through the registry here. Two kinds of providers exist:
 *
 *  1. GATEWAY providers (today: 'test') — have a charge() method. The service
 *     awaits charge() and records the row itself.
 *  2. MANUAL providers ('bkash' | 'nagad' | 'rocket') — NO charge(). The member
 *     sends money to the association's number from their own app, then submits
 *     the Transaction ID (+ optional screenshot). The row is recorded as
 *     'pending' and stays that way until an admin/authority reviews it.
 *
 * Adding a real gateway later (bKash Tokenized Checkout, etc.) means adding ONE
 * adapter here with a charge()/verify() pair — monthly calculation, history,
 * admin views, and authorization remain untouched.
 */

export const MANUAL_PROVIDERS = ['bkash', 'nagad', 'rocket'];

export const PAYMENT_PROVIDERS = {
  test: {
    /** Human-facing label shown on receipts/history (never pretends to be bKash/Nagad). */
    label: 'TEST PAYMENT',
    /**
     * Charges `amount`. The test provider always resolves AFTER an async tick
     * so the flow exercises the same await/error paths a real gateway would.
     * Resolves with a gateway reference; rejects to signal a failed charge.
     */
    async charge({ amount, senderNumber }) {
      await new Promise((r) => setTimeout(r, 150));
      if (!(amount > 0)) throw new Error('Provider charge failed: invalid amount');
      void senderNumber; // real MFS providers would use this; test provider ignores it
      return { providerRef: 'OK', raw: { simulated: true } };
    },
  },

  // ----- Manual mobile-money providers (manual flow, no gateway APIs) -----
  // `number` = the association's receiving number from backend/.env — ONE
  //            centralized value per provider (bKash: BKASH_NUMBER). null when
  //            unset: the UI shows a setup notice, never a fake number.
  // `appUrl` = OFFICIALLY documented gateway deep link ONLY. None of the three
  //            providers publishes a public consumer deep-link scheme, so all
  //            ship as null. Mobile devices instead get a real "Open ... App"
  //            affordance via `storeUrls` (official app-store pages, verified
  //            on bkash.com) — the app is only a SENDING tool: opening it can
  //            never confirm or mark a payment; verification stays admin-
  //            driven with the required Transaction ID.
  // `brand`  = provider brand color for the UI selector.
  bkash: {
    label: 'bKash',
    manual: true,
    brand: '#E2136E',
    number: env.payments.bkash.number,
    appUrl: env.payments.bkash.appUrl,
    // Official app pages from bkash.com (no unofficial mirrors).
    storeUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.bKash.customerapp',
      ios: 'https://apps.apple.com/app/bkash/id1351183172',
    },
    instructions: [
      'Open the bKash app on your phone (or dial *247#) and choose "Send Money".',
      `Send the exact amount to ${env.payments.bkash.number || '(number not configured)'} (BILBILASH ALUMNI ASSOCIATION).`,
      'Copy the Transaction ID (TrxID) from the confirmation SMS or app receipt.',
      'Come back here, paste the Transaction ID and confirm — the payment is verified manually.',
    ],
  },
  nagad: {
    label: 'Nagad',
    manual: true,
    brand: '#F6921E',
    number: env.payments.nagad.number,
    appUrl: env.payments.nagad.appUrl,
    storeUrls: null, // no officially verified store pages yet — add only verified URLs
    instructions: [
      'Open the Nagad app on your phone (or dial *167#) and choose "Send Money".',
      `Send the exact amount to ${env.payments.nagad.number || '(number not configured)'} (BILBILASH ALUMNI ASSOCIATION).`,
      'Copy the Transaction ID from the confirmation SMS or app receipt.',
      'Come back here, paste the Transaction ID and confirm — the payment is verified manually.',
    ],
  },
  rocket: {
    label: 'Rocket',
    manual: true,
    brand: '#8C3494',
    number: env.payments.rocket.number,
    appUrl: env.payments.rocket.appUrl,
    storeUrls: null, // no officially verified store pages yet — add only verified URLs
    instructions: [
      'Open the Rocket app on your phone (or dial *322#) and choose "Bank to Rocket" / "Send Money".',
      `Send the exact amount to ${env.payments.rocket.number || '(number not configured)'} (BILBILASH ALUMNI ASSOCIATION).`,
      'Copy the Transaction ID from the confirmation SMS or app receipt.',
      'Come back here, paste the Transaction ID and confirm — the payment is verified manually.',
    ],
  },
};

export function getProvider(method = 'test') {
  const provider = PAYMENT_PROVIDERS[method];
  if (!provider) throw new Error(`Unknown payment provider: ${method}`);
  return provider;
}

/** Public provider info for the member UI (no internals). */
export function listProviderInfo() {
  return MANUAL_PROVIDERS.map((key) => {
    const p = PAYMENT_PROVIDERS[key];
    return {
      key,
      label: p.label,
      brand: p.brand,
      number: p.number, // null when not configured — UI shows a setup notice
      app_url: p.appUrl || null, // null => UI shows the manual fallback (by design)
      store_urls: p.storeUrls || null, // official app-store pages (bKash only for now)
      instructions: p.instructions,
    };
  });
}
