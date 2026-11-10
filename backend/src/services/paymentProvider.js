import { env } from '../config/env.js';

/**
 * Payment provider abstraction (provider-independent by design).
 *
 * The business logic in paymentService.js NEVER talks to a gateway directly —
 * it always goes through the registry here. Two kinds of providers exist:
 *
 *  1. GATEWAY providers (today: 'test') — have a charge() method. The service
 *     awaits charge() and records the row itself.
 *  2. MANUAL providers ('bkash' | 'nagad' | 'rocket' | 'bank') — NO charge().
 *     The member sends money themselves (mobile wallet send-money or a bank
 *     transfer), then submits the Transaction ID / transfer reference (+
 *     optional screenshot). The row is recorded as 'pending' and stays that way
 *     until an admin/authority reviews it.
 *
 * Adding a real gateway later (bKash Tokenized Checkout, etc.) means adding ONE
 * adapter here with a charge()/verify() pair — monthly calculation, history,
 * admin views, and authorization remain untouched.
 */

// 'bank' is a MANUAL method too: the member transfers to the association's
// account and submits the transfer reference for admin verification.
export const MANUAL_PROVIDERS = ['bkash', 'nagad', 'rocket', 'bank'];

/** Android app package + official store pages (verified — never guessed). */
const BKASH_ANDROID_PACKAGE = 'com.bKash.customerapp'; // Google Play listing
const NAGAD_ANDROID_PACKAGE = 'com.konasl.nagad'; // Google Play listing
const ROCKET_ANDROID_PACKAGE = 'com.dbbl.mbs.apps.main'; // Google Play listing (DBBL)

/** Bank transfer details come ONLY from backend/.env — never hard-coded. */
const bank = env.payments.bank;
const bankConfigured = Boolean(bank.bankName && bank.accountName && bank.accountNumber);

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
  // `appUrl` = OFFICIALLY documented app deep link ONLY. None of the three
  //            providers publishes a public consumer deep-link scheme (verified
  //            against bkash.com, nagad.com.bd and dbbl.com.bd), so all ship as
  //            null. Phones instead get a real "Open ... App" affordance built
  //            from the VERIFIED Android package (documented `intent:` URI with
  //            the Play Store as its browser fallback) or the iTunes/App Store
  //            page on iOS — the app is only a SENDING tool: opening it can
  //            never confirm or mark a payment; verification stays admin-driven
  //            with the required Transaction ID.
  // `brand`  = provider brand color for the UI selector.
  bkash: {
    label: 'bKash',
    manual: true,
    brand: '#E2136E',
    number: env.payments.bkash.number,
    appUrl: env.payments.bkash.appUrl,
    androidPackage: BKASH_ANDROID_PACKAGE,
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
    androidPackage: NAGAD_ANDROID_PACKAGE,
    // Official Google Play listing / App Store page (publisher: Nagad Limited).
    storeUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.konasl.nagad',
      ios: 'https://apps.apple.com/app/nagad/id1471844924',
    },
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
    androidPackage: ROCKET_ANDROID_PACKAGE,
    // Official DBBL Rocket listings (publisher: Dutch-Bangla Bank).
    storeUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.dbbl.mbs.apps.main',
      ios: 'https://apps.apple.com/app/dbbl-rocket/id1194003397',
    },
    instructions: [
      'Open the Rocket app on your phone (or dial *322#) and choose "Bank to Rocket" / "Send Money".',
      `Send the exact amount to ${env.payments.rocket.number || '(number not configured)'} (BILBILASH ALUMNI ASSOCIATION).`,
      'Copy the Transaction ID from the confirmation SMS or app receipt.',
      'Come back here, paste the Transaction ID and confirm — the payment is verified manually.',
    ],
  },

  // ----- Manual BANK TRANSFER (fourth method) -----
  // No app to open and no gateway: the member transfers from their own bank /
  // internet banking and submits the transfer reference. Account details are
  // served ONLY when configured in backend/.env (BANK_NAME,
  // BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER, BANK_BRANCH_NAME,
  // BANK_ROUTING_NUMBER, BANK_INSTRUCTIONS) — otherwise `configured` is false,
  // no details are shown and the API refuses bank submissions.
  bank: {
    label: 'Bank Account',
    manual: true,
    brand: '#0F4C3A',
    number: null,
    appUrl: null,
    androidPackage: null,
    storeUrls: null,
    configured: bankConfigured,
    bank: bankConfigured
      ? {
        name: bank.bankName,
        account_name: bank.accountName,
        account_number: bank.accountNumber,
        branch_name: bank.branchName,
        routing_number: bank.routingNumber,
      }
      : null,
    details: {
      bank_name: bank.bankName,
      account_name: bank.accountName,
      account_number: bank.accountNumber,
      branch_name: bank.branchName,
      routing_number: bank.routingNumber,
      note: bank.instructions,
    },
    instructions: bankConfigured
      ? [
        `Transfer the exact amount to the association's ${bank.bankName} account (details below) using internet banking, a mobile banking app, or a branch deposit.`,
        'Write your registration number in the transfer reference / remarks so the treasurer can match it.',
        'Keep the transfer reference (or Transaction ID) from your bank receipt.',
        'Come back here, paste the transfer reference and confirm — the payment is verified manually by an admin.',
      ]
      : [
        'Bank transfer is not configured yet — the association has not published its account details.',
        'Please use bKash, Nagad or Rocket for now, or contact an admin for the bank details.',
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
      app_url: p.appUrl || null, // null => UI uses the verified store/intent fallback
      android_package: p.androidPackage || null, // verified Play package (Android intent launch)
      store_urls: p.storeUrls || null, // official app-store pages only
      instructions: p.instructions,
      // Bank-only payload: null details until the real account is configured.
      configured: p.configured !== false,
      bank: p.bank || null,
      bank_details: p.details || null,
    };
  });
}
