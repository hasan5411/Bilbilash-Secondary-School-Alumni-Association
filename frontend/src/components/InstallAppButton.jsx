import { useEffect, useState } from 'react';

const INSTALL_FLAG = 'bssaa_app_installed';
const PROMPT_EVENT = 'bssaa:beforeinstallprompt';
const INSTALLED_EVENT = 'bssaa:appinstalled';

// Capture as early as possible: beforeinstallprompt can fire before React
// mounts, and the event is single-use, so it must be kept until the user acts.
if (typeof window !== 'undefined' && !window.__bssaaInstallCapture) {
  window.__bssaaInstallCapture = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__bssaaDeferredPrompt = event;
    try { localStorage.removeItem(INSTALL_FLAG); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(PROMPT_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    window.__bssaaDeferredPrompt = null;
    try { localStorage.setItem(INSTALL_FLAG, '1'); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(INSTALLED_EVENT));
  });
}

function detectStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.navigator.standalone === true;
}

function readInstalledFlag() {
  try { return localStorage.getItem(INSTALL_FLAG) === '1'; } catch { return false; }
}

export default function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState(() => window.__bssaaDeferredPrompt || null);
  const [installed, setInstalled] = useState(() => detectStandalone() || readInstalledFlag());

  useEffect(() => {
    const onPrompt = () => {
      setPromptEvent(window.__bssaaDeferredPrompt || null);
      setInstalled(detectStandalone());
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };
    const media = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = () => {
      if (detectStandalone()) {
        setPromptEvent(null);
        setInstalled(true);
      }
    };

    window.addEventListener(PROMPT_EVENT, onPrompt);
    window.addEventListener(INSTALLED_EVENT, onInstalled);
    media?.addEventListener?.('change', onDisplayModeChange);
    return () => {
      window.removeEventListener(PROMPT_EVENT, onPrompt);
      window.removeEventListener(INSTALLED_EVENT, onInstalled);
      media?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  const handleInstall = async () => {
    const event = promptEvent;
    if (!event) return;

    // The event is single-use, so drop every reference before prompting.
    if (window.__bssaaDeferredPrompt === event) window.__bssaaDeferredPrompt = null;
    setPromptEvent(null);

    event.prompt();
    const choice = await event.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      try { localStorage.setItem(INSTALL_FLAG, '1'); } catch { /* storage unavailable */ }
      setInstalled(true);
    }
  };

  if (installed || !promptEvent) return null;

  return (
    <button
      type="button"
      onClick={handleInstall}
      className="mt-5 inline-flex items-center gap-2 rounded-lg border border-forest px-4 py-2 text-sm font-semibold text-forest transition hover:bg-mint"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Install BSSAA App
    </button>
  );
}
