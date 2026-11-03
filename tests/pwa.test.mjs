import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupKinetixPWA } from '../src/engine/platform/KinetixPWA.js';

class FakeButton {
  constructor() {
    this.hidden = true;
    this.disabled = false;
    this.classes = new Set(['hidden']);
    this.listeners = new Map();
    this.classList = {
      add: (value) => this.classes.add(value),
      remove: (value) => this.classes.delete(value)
    };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async click() {
    for (const listener of this.listeners.get('click') || []) {
      await listener(new Event('click'));
    }
  }
}

class FakeWorker extends EventTarget {
  constructor() {
    super();
    this.messages = [];
  }
  postMessage(message) {
    this.messages.push(message);
  }
}

class FakeRegistration extends EventTarget {
  constructor() {
    super();
    this.waiting = null;
    this.installing = null;
    this.updateCalls = 0;
  }
  async update() {
    this.updateCalls += 1;
  }
}

class FakeServiceWorkerContainer extends EventTarget {
  constructor(registration) {
    super();
    this.registration = registration;
    this.controller = {};
    this.registerCalls = [];
  }
  async register(url, options) {
    this.registerCalls.push({ url, options });
    return this.registration;
  }
}

function makeWindow() {
  const target = new EventTarget();
  target.location = { reloadCalls: 0, reload() { this.reloadCalls += 1; } };
  return target;
}

function makeInstallEvent(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = async () => { event.prompted = true; };
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

test('PWA registers a root-scoped service worker without requesting camera access', async () => {
  const registration = new FakeRegistration();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const navigatorRef = { serviceWorker };
  const windowRef = makeWindow();
  const controller = setupKinetixPWA({ navigatorRef, windowRef, logger: { warn() {} } });

  assert.equal(await controller.ready, registration);
  assert.deepEqual(serviceWorker.registerCalls, [{ url: '/sw.js', options: { scope: '/' } }]);
  assert.equal(windowRef.location.reloadCalls, 0);
});

test('install prompt is shown only when the browser emits beforeinstallprompt', async () => {
  const registration = new FakeRegistration();
  const installButton = new FakeButton();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const windowRef = makeWindow();
  const controller = setupKinetixPWA({
    installButton,
    navigatorRef: { serviceWorker },
    windowRef,
    logger: { warn() {} }
  });

  assert.equal(installButton.hidden, true);
  const event = makeInstallEvent('accepted');
  windowRef.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(installButton.hidden, false);

  assert.equal(await controller.promptInstall(), true);
  assert.equal(event.prompted, true);
  assert.equal(installButton.hidden, true);
});

test('waiting service-worker update is activated only after explicit action', async () => {
  const registration = new FakeRegistration();
  const waiting = new FakeWorker();
  registration.waiting = waiting;
  const updateButton = new FakeButton();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const windowRef = makeWindow();
  const controller = setupKinetixPWA({
    updateButton,
    navigatorRef: { serviceWorker },
    windowRef,
    logger: { warn() {} }
  });

  await controller.ready;
  assert.equal(updateButton.hidden, false);
  assert.equal(await controller.activateUpdate(), true);
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);

  serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(windowRef.location.reloadCalls, 1);
});

test('unsupported browsers gracefully keep the website usable', async () => {
  const installButton = new FakeButton();
  const updateButton = new FakeButton();
  const controller = setupKinetixPWA({
    installButton,
    updateButton,
    navigatorRef: {},
    windowRef: makeWindow()
  });

  assert.equal(await controller.ready, null);
  assert.equal(await controller.promptInstall(), false);
  assert.equal(installButton.hidden, true);
  assert.equal(updateButton.hidden, true);
});

test('PWA manifest and worker scope only describe same-origin offline behaviour', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.src === '/icons/kinetix.svg'));
  assert.ok(worker.includes("url.origin !== self.location.origin"));
  assert.ok(worker.includes("path.startsWith('/models/')"));
  assert.ok(worker.includes("path.startsWith('/mediapipe/wasm/')"));
});
