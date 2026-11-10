/**
 * Payment-app opening logic for the wallet methods (bKash / Nagad / Rocket).
 *
 * WHY THIS FILE EXISTS: the previous implementation preferred the iOS store URL
 * on every phone, so Android users tapping "Open bKash App" were sent to the
 * Apple App Store — the reported incorrect redirect. The destination must be
 * chosen from the REAL platform, and only from verified official sources:
 *
 *   - Android: launch the installed app by its VERIFIED package name using the
 *     documented Chrome `intent:` URI syntax, with the official Google Play
 *     listing as `S.browser_fallback_url` (Play Store when not installed).
 *   - iOS: the official Apple App Store page (install / "Open").
 *   - Desktop / unknown: no app to open — the official listing page in a new tab.
 *
 * None of bKash, Nagad or DBBL Rocket publishes a consumer deep-link scheme
 * (verified against bkash.com, nagad.com.bd and dbbl.com.bd), so no custom
 * scheme is ever invented here. A configured official deep link (backend
 * `app_url`) still wins when a provider ever publishes one.
 *
 * Everything in this module is pure so the behaviour is directly testable.
 */

/** 'android' | 'ios' | 'desktop' from the real user agent. */
export function detectPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return 'desktop';
  const ua = nav.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports a desktop Safari user agent.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1) return 'ios';
  return 'desktop';
}

/** Documented Android intent: URI — launch the package, else fall back to Play. */
export function androidIntentUrl(packageName, playStoreUrl) {
  return 'intent://#Intent;package=' + encodeURIComponent(packageName)
    + ';action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER'
    + ';S.browser_fallback_url=' + encodeURIComponent(playStoreUrl)
    + ';end';
}

/**
 * Where an "Open <wallet> App" click should go.
 * Returns { mode, url }:
 *   app      — a configured official deep link (window.location)
 *   intent   — Android package launch with a Play Store fallback (window.location)
 *   new-tab  — official store page in a new tab (iOS / desktop / no package)
 *   none     — nothing verified to open (bank transfers never reach here)
 */
export function providerAppTarget(provider, platform = detectPlatform()) {
  if (!provider || provider.key === 'bank') return { mode: 'none', url: null };
  const stores = provider.store_urls || {};

  if (provider.app_url) return { mode: 'app', url: provider.app_url };

  if (platform === 'android') {
    if (provider.android_package && stores.android) {
      return { mode: 'intent', url: androidIntentUrl(provider.android_package, stores.android) };
    }
    if (stores.android) return { mode: 'new-tab', url: stores.android };
    return { mode: 'none', url: null };
  }
  if (platform === 'ios') {
    return stores.ios ? { mode: 'new-tab', url: stores.ios } : { mode: 'none', url: null };
  }
  const fallback = stores.android || stores.ios || null;
  return fallback ? { mode: 'new-tab', url: fallback } : { mode: 'none', url: null };
}

/** True when the click can lead somewhere official (used to show the button). */
export function hasOfficialAppTarget(provider) {
  return providerAppTarget(provider, 'android').mode !== 'none'
    || providerAppTarget(provider, 'ios').mode !== 'none';
}
