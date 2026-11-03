/**
 * KINETIX progressive-web-app controls.
 *
 * Registration is optional: unsupported browsers keep the normal website.
 * Camera permission is intentionally unrelated to app installation and is
 * requested only after the player presses the camera action.
 */
export function setupKinetixPWA({
  installButton = null,
  updateButton = null,
  navigatorRef = globalThis.navigator,
  windowRef = globalThis.window,
  logger = console
} = {}) {
  const hide = (button) => {
    if (!button) return;
    button.classList?.add('hidden');
    button.hidden = true;
  };
  const show = (button) => {
    if (!button) return;
    button.hidden = false;
    button.classList?.remove('hidden');
  };

  let deferredInstallPrompt = null;
  let registration = null;
  let reloadAfterUpdate = false;

  const unavailable = !navigatorRef?.serviceWorker || !windowRef?.addEventListener;
  if (unavailable) {
    hide(installButton);
    hide(updateButton);
    return Object.freeze({
      ready: Promise.resolve(null),
      promptInstall: async () => false,
      activateUpdate: async () => false
    });
  }

  hide(installButton);
  hide(updateButton);

  const onBeforeInstallPrompt = (event) => {
    event.preventDefault?.();
    deferredInstallPrompt = event;
    show(installButton);
  };
  const onAppInstalled = () => {
    deferredInstallPrompt = null;
    hide(installButton);
  };
  const onControllerChange = () => {
    if (!reloadAfterUpdate) return;
    reloadAfterUpdate = false;
    windowRef.location?.reload?.();
  };

  windowRef.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  windowRef.addEventListener('appinstalled', onAppInstalled);
  navigatorRef.serviceWorker.addEventListener('controllerchange', onControllerChange);

  async function promptInstall() {
    if (!deferredInstallPrompt) return false;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') hide(installButton);
      return choice?.outcome === 'accepted';
    } catch (error) {
      logger?.warn?.('[KINETIX PWA] Install prompt unavailable.', error);
      return false;
    }
  }

  async function activateUpdate() {
    const activeRegistration = registration || await ready;
    if (!activeRegistration) return false;

    try {
      if (!activeRegistration.waiting) {
        await activeRegistration.update();
      }
      if (!activeRegistration.waiting) return false;
      reloadAfterUpdate = true;
      activeRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch (error) {
      logger?.warn?.('[KINETIX PWA] Update check failed.', error);
      reloadAfterUpdate = false;
      return false;
    }
  }

  installButton?.addEventListener('click', () => {
    installButton.disabled = true;
    void promptInstall().finally(() => {
      installButton.disabled = false;
      if (!deferredInstallPrompt) hide(installButton);
    });
  });

  updateButton?.addEventListener('click', () => {
    void activateUpdate();
  });

  const ready = navigatorRef.serviceWorker.register('/sw.js', { scope: '/' })
    .then((nextRegistration) => {
      registration = nextRegistration;
      if (registration.waiting) show(updateButton);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigatorRef.serviceWorker.controller) {
            show(updateButton);
          }
        });
      });

      return registration;
    })
    .catch((error) => {
      logger?.warn?.('[KINETIX PWA] Offline support could not be enabled.', error);
      hide(installButton);
      hide(updateButton);
      return null;
    });

  return Object.freeze({ ready, promptInstall, activateUpdate });
}
