import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * `beforeinstallprompt` fires exactly once per page load and only on
 * Chromium-based browsers. If we wait until the Settings page mounts to
 * register the listener, we miss the event in any session where the user
 * navigated through other pages first. So capture it at module scope —
 * this side-effect runs once, the moment the module is first imported
 * (during app boot).
 */
let cachedPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<(p: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Do NOT call e.preventDefault() — the browser's native UI (address-bar
    // button, mini-banner) keeps working. We just capture the event so the
    // Settings screen can also offer a button as a convenience.
    cachedPrompt = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn(cachedPrompt));
  });
  window.addEventListener("appinstalled", () => {
    cachedPrompt = null;
    subscribers.forEach((fn) => fn(null));
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari uses the legacy navigator.standalone flag for home-screen apps.
  const navWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return navWithStandalone.standalone === true;
}

function detectIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // iPad on iPadOS 13+ reports as MacIntel; check for touch as a proxy.
  const isIpadOS =
    /Macintosh/.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1;
  return /iPhone|iPad|iPod/.test(ua) || isIpadOS;
}

/**
 * Drives the install entry point in Settings.
 *
 * - `canInstall: true` → render a button that triggers the native prompt.
 * - `showIOSHint: true` → on iOS Safari, render manual instructions (Share →
 *   Add to Home Screen). Apple does not expose a programmatic install API.
 * - both false → app is already installed, or browser has nothing to offer
 *   right now (e.g. Chrome cooldown after a dismissal); hide the section.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    cachedPrompt,
  );
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onChange = (p: BeforeInstallPromptEvent | null) => setPromptEvent(p);
    subscribers.add(onChange);
    // Re-check the standalone media query on mount in case the user just
    // installed in another tab.
    setInstalled(isStandalone());
    return () => {
      subscribers.delete(onChange);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") {
      cachedPrompt = null;
      setPromptEvent(null);
    }
  }

  const isIOS = detectIOS();

  return {
    canInstall: promptEvent !== null && !installed,
    showIOSHint: isIOS && !installed && !promptEvent,
    isInstalled: installed,
    install,
  };
}
