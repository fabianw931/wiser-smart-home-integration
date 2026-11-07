import { createApi } from './api.js';

export const RESOURCE_NAMES = ['info', 'rooms', 'devices', 'sensors', 'hvacgroups', 'hvacgroups/state'];
const POLL_MS = 30000;
const bare = host => host.replace(/^\[|\]$/g, '');

// Session lifecycle, polling and commands. UI components read these fields only.
export class Dashboard {
  host = $state('');
  connected = $state(false);
  busy = $state(true);
  disconnecting = $state(false);
  stale = $state(true);
  error = $state('');
  notice = $state('Checking local session…');
  commandNotice = $state('');
  updated = $state(null);
  loads = $state([]);
  states = $state({});
  resources = $state({});
  epoch = $state(0);

  #api = createApi();
  #timer;

  #schedule() {
    clearTimeout(this.#timer);
    if (this.connected) this.#timer = setTimeout(this.refresh, POLL_MS);
  }

  async #operation(action) {
    if (this.busy) return;
    clearTimeout(this.#timer);
    this.busy = true;
    this.error = '';
    const current = this.epoch;
    try { await action(current); }
    catch (failure) {
      if (current === this.epoch) {
        this.stale = true;
        this.error = failure.message;
        this.notice = this.connected ? 'Refresh failed — readings may be stale.' : 'Connection failed.';
      }
    } finally {
      if (current === this.epoch) { this.busy = false; this.#schedule(); }
    }
  }

  #read = async resource => (await this.#api.request(`/api/read/${resource}`)).data;

  async #loadAll(current) {
    const discovered = await this.#read('loads');
    if (current !== this.epoch) return;
    this.loads = discovered;
    try {
      const snapshot = await this.#read('loads/state');
      if (!Array.isArray(snapshot) || snapshot.some(item => !item || !Number.isSafeInteger(item.id))) throw new Error('Invalid load state response.');
      if (current !== this.epoch) return;
      this.states = Object.fromEntries(snapshot.map(item => [item.id, item.state]));
      this.updated = new Date();
      this.stale = false;
      this.notice = 'Connected — reported states refreshed.';
    } catch (failure) {
      if (current !== this.epoch) return;
      this.stale = true;
      this.error = failure.message;
      this.notice = 'Connected — state unavailable; old readings are stale.';
    }
    for (const name of RESOURCE_NAMES) {
      let result;
      try { result = { data: await this.#read(name) }; }
      catch (failure) { result = { error: failure.message, unsupported: [404, 405, 501].includes(failure.status) }; }
      if (current !== this.epoch) return;
      this.resources = { ...this.resources, [name]: result };
    }
  }

  refresh = () => this.#operation(current => this.#loadAll(current));

  connect = async payload => {
    try {
      await this.#operation(async current => {
        this.notice = payload.pair ? 'Pairing — press a flashing gateway button within 30 seconds…' : 'Connecting…';
        this.commandNotice = '';
        const result = await this.#api.request('/api/connect', 'POST', payload);
        if (current !== this.epoch) return;
        this.connected = result.connected;
        this.host = bare(result.host);
        await this.#loadAll(current);
      });
    } finally { delete payload.token; }
  };

  write = (load, target) => this.#operation(async current => {
    this.commandNotice = '';
    await this.#api.request(`/api/loads/${load.id}/target_state`, 'PUT', target);
    if (current !== this.epoch) return;
    this.commandNotice = `Target accepted for ${load.name || `Load ${load.id}`}. Acceptance is not confirmation — check the reported state and the physical device.`;
    await this.#loadAll(current);
  });

  disconnect = async () => {
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.epoch++;
    clearTimeout(this.#timer);
    this.#api.cancel();
    this.connected = false;
    this.busy = true;
    this.stale = true;
    this.loads = [];
    this.states = {};
    this.resources = {};
    this.updated = null;
    this.commandNotice = '';
    this.error = '';
    try {
      await this.#api.request('/api/disconnect', 'POST');
      this.notice = 'Disconnected — server credentials forgotten.';
    } catch {
      this.notice = 'Polling stopped.';
      this.error = 'Could not confirm disconnect. Stop the Node server to ensure credentials are forgotten.';
    } finally { this.busy = false; this.disconnecting = false; }
  };

  dismissCommandNotice = () => { this.commandNotice = ''; };

  start() {
    this.busy = false;
    this.#operation(async current => {
      const session = await this.#api.request('/api/session');
      if (current !== this.epoch) return;
      this.connected = session.connected;
      if (this.connected) {
        this.host = bare(session.host);
        await this.#loadAll(current);
      } else this.notice = session.connecting ? 'A connection is pending in another tab; disconnect to cancel it.' : 'Not connected.';
    });
  }

  stop() {
    this.epoch++;
    clearTimeout(this.#timer);
    this.#api.cancel();
  }
}
