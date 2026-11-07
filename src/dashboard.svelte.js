import { createApi } from './api.js';
import { sampleHome } from './demo.js';
import { validateLayout } from './layout.js';
import { makeMapping, readMappings, saveMappings } from './mappings.js';
import { exportConfiguration, configurationFilename, parseConfiguration, planImport, describePlan } from './configuration.js';
import { decorate, buildHome, actionTargets, loadName, ACTIONS } from './home.js';

export const RESOURCE_NAMES = ['info', 'rooms', 'buttons', 'sensors', 'westgroups', 'smartbuttons', 'devices', 'hvacgroups', 'hvacgroups/state'];
const POLL_MS = 30000;
// Quick actions send one request at a time: parallel sends gave no visible benefit on the real gateway.
const LIGHT_PARALLEL = 1;
const bare = host => host.replace(/^\[|\]$/g, '');
const emptyLayout = () => ({ floors: [], favorites: { loads: [], rooms: [] } });

// Session lifecycle, live updates, commands and personal organisation. Views only read these fields.
export class Dashboard {
  host = $state('');
  connected = $state(false);
  busy = $state(true);
  disconnecting = $state(false);
  remembered = $state(false);
  liveStatus = $state('polling');
  stale = $state(true);
  error = $state('');
  notice = $state('Checking local session…');
  commandNotice = $state('');
  updated = $state(null);
  loads = $state([]);
  states = $state({});
  resources = $state({});
  diagnosticsBusy = $state(false);
  epoch = $state(0);
  demo = $state(false);
  mappings = $state({});
  layout = $state(emptyLayout());
  layoutIllustrative = $state(false); // sample home shows an illustrative layout that is not saved
  gatewayKey = $state('');
  storageNotice = $state('');
  mappingBusy = $state(false);
  review = $state(null); // { id, changes, expected } while the gateway-metadata dialog is open
  pendingAction = $state('');

  rooms = $derived(Array.isArray(this.resources.rooms?.data) ? this.resources.rooms.data : []);
  displayed = $derived(decorate(this.loads, this.mappings, this.rooms));
  home = $derived(buildHome(this.displayed, this.layout));
  roomNames = $derived([...new Set(this.displayed.map(load => load.room).filter(Boolean))].sort());
  active = $derived(this.connected || this.demo);

  #api = createApi();
  #timer;
  #resyncTimer;
  #stopLive;
  #liveEpoch = -1;
  #stateRevision = 0;
  #livePatches = [];

  // ---- scheduling and the single in-flight operation ----
  #schedule() {
    clearTimeout(this.#timer);
    if (this.connected && !this.demo) this.#timer = setTimeout(this.refresh, POLL_MS);
  }

  // User commands wait for the running operation instead of being dropped; background refreshes skip when busy.
  async #operation(action, { wait = false } = {}) {
    if (this.busy && wait) {
      const queued = this.epoch;
      while (this.busy && queued === this.epoch) await new Promise(resolve => setTimeout(resolve, 40));
      if (queued !== this.epoch) return;
    }
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

  #ensureLive(current) {
    if (this.#liveEpoch === current || !this.connected || this.demo) return;
    this.#stopLive?.(); this.#liveEpoch = current;
    this.#stopLive = this.#api.events(event => {
      if (current !== this.epoch || !this.connected || this.demo) return;
      if (event.type === 'status') this.liveStatus = event.status === 'live' ? 'live' : 'polling';
      if (event.type === 'load' && this.loads.some(load => load.id === event.id) && event.state && typeof event.state === 'object') {
        this.#stateRevision++;
        this.#livePatches.push({ revision: this.#stateRevision, id: event.id, state: event.state });
        if (this.#livePatches.length > 1000) this.#livePatches.shift();
        this.states = { ...this.states, [event.id]: { ...this.states[event.id], ...event.state } };
        this.updated = new Date();
      }
      if (event.type === 'resync') {
        const retry = () => {
          if (current !== this.epoch || !this.connected || this.demo) return;
          if (this.busy) this.#resyncTimer = setTimeout(retry, 250);
          else void this.refresh();
        };
        clearTimeout(this.#resyncTimer); this.#resyncTimer = setTimeout(retry, 100);
      }
    }, changed => {
      if (current !== this.epoch) return;
      this.liveStatus = 'polling';
      if (changed) { this.stale = true; this.error = 'Gateway session changed. Reconnect this page before controlling devices.'; }
    });
  }

  #resetLive() {
    this.#stopLive?.(); this.#liveEpoch = -1; this.liveStatus = 'polling'; this.#livePatches = [];
  }

  async #loadAll(current, diagnostics = true) {
    const discovered = await this.#read('loads');
    if (current !== this.epoch) return;
    this.loads = discovered;
    try {
      const revision = this.#stateRevision;
      const snapshot = await this.#read('loads/state');
      if (!Array.isArray(snapshot) || snapshot.some(item => !item || !Number.isSafeInteger(item.id))) throw new Error('Invalid load state response.');
      if (current !== this.epoch) return;
      const next = Object.fromEntries(snapshot.map(item => [item.id, item.state]));
      for (const patch of this.#livePatches.filter(item => item.revision > revision)) next[patch.id] = { ...next[patch.id], ...patch.state };
      this.states = next;
      this.#livePatches = [];
      this.updated = new Date();
      this.stale = false;
      this.notice = 'Connected — reported states refreshed.';
    } catch (failure) {
      if (current !== this.epoch) return;
      this.stale = true;
      this.error = failure.message;
      this.notice = 'Connected — state unavailable; old readings are stale.';
    }
    if (diagnostics && current === this.epoch) void this.#refreshDiagnostics(current);
    this.#ensureLive(current);
  }

  async #refreshDiagnostics(current) {
    if (this.diagnosticsBusy) return;
    this.diagnosticsBusy = true;
    try {
      for (const name of RESOURCE_NAMES) {
        let result;
        try { result = { data: await this.#read(name), observedAt: Date.now() }; }
        catch (failure) { result = { error: failure.message, unsupported: [404, 405, 501].includes(failure.status) }; }
        if (current !== this.epoch) return;
        this.resources = { ...this.resources, [name]: result };
      }
    } finally {
      if (current === this.epoch) this.diagnosticsBusy = false;
    }
  }

  refresh = () => this.#operation(current => this.#loadAll(current));

  // ---- personal mappings and layout (SQLite, per gateway) ----
  #url = (kind, suffix = '', key = this.gatewayKey) => `/api/local/${kind}${suffix}?gateway=${encodeURIComponent(key)}`;

  async #restoreLocal(key) {
    this.gatewayKey = key.toLowerCase();
    const current = this.epoch, scope = this.gatewayKey;
    this.storageNotice = ''; this.mappings = {}; this.layout = emptyLayout(); this.layoutIllustrative = false;
    try {
      const [mappings, layout] = await Promise.all([this.#api.request(this.#url('mappings', '', scope)), this.#api.request(this.#url('layout', '', scope))]);
      if (current !== this.epoch) return;
      this.mappings = mappings.data;
      this.layout = layout.data;
      let legacy;
      try { legacy = readMappings(localStorage, scope); }
      catch { this.storageNotice = 'Existing browser mappings could not be read. Database mappings are available.'; return; }
      if (Object.keys(legacy).length) {
        const migrated = await this.#api.request(this.#url('mappings', '/import', scope), 'POST', { mappings: legacy });
        if (current !== this.epoch) return;
        this.mappings = migrated.data;
        try { saveMappings(localStorage, scope, {}); }
        catch { this.storageNotice = 'Mappings migrated, but the old browser copy could not be cleared.'; }
        this.commandNotice = 'Existing browser mappings migrated to SQLite. Existing database entries were kept.';
      }
    } catch {
      if (current === this.epoch) this.storageNotice = 'Could not load or migrate saved mappings. Existing browser data has been kept. Retry by reconnecting.';
    }
  }

  async #changeMappings(suffix, method, payload) {
    if (this.mappingBusy || !this.gatewayKey) throw new Error('A save is already in progress.');
    const current = this.epoch;
    this.mappingBusy = true; this.storageNotice = '';
    try {
      const result = await this.#api.request(this.#url('mappings', suffix), method, payload);
      if (current !== this.epoch) return false;
      this.mappings = result.data;
      return true;
    } catch (failure) {
      if (current !== this.epoch) return false;
      throw failure;
    } finally { if (current === this.epoch) this.mappingBusy = false; }
  }

  saveLocal = async (load, fields) => {
    try {
      if (await this.#changeMappings('/' + load.id, 'PUT', makeMapping(load, fields))) {
        this.commandNotice = 'Personal details saved on this computer. Gateway configuration is unchanged.';
        return true;
      }
    } catch (failure) { this.storageNotice = 'Details were not saved: ' + failure.message; }
    return false;
  };

  removeLocal = async id => {
    try {
      if (await this.#changeMappings('/' + id, 'DELETE')) this.commandNotice = 'Personal details removed. Gateway configuration is unchanged.';
    } catch (failure) { this.storageNotice = 'Details were not removed: ' + failure.message; }
  };

  // Stored configuration of the current gateway. The sample home's illustrative layout is not stored, so it is not exported or merged.
  #stored() { return { mappings: this.mappings, layout: this.layoutIllustrative ? emptyLayout() : this.layout }; }

  downloadConfiguration = () => {
    const now = new Date();
    const text = exportConfiguration(this.gatewayKey, { ...this.#stored(), loads: this.loads, rooms: this.rooms }, now);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = configurationFilename(this.gatewayKey, now); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Validate a file and work out what would change. Writes nothing; throws a readable error for invalid files.
  previewImport = text => {
    const imported = parseConfiguration(text, this.gatewayKey);
    return { gateway: this.gatewayKey, imported, plan: planImport(this.#stored(), imported) };
  };

  // Apply a preview: mappings first, then the layout. A failure reports exactly what was and was not imported.
  applyImport = async preview => {
    if (!this.gatewayKey || preview.gateway !== this.gatewayKey) throw new Error('The connection changed. Nothing was imported.');
    const plan = planImport(this.#stored(), preview.imported);
    if (Object.keys(plan.mappings).length) {
      try {
        if (!(await this.#changeMappings('/import', 'POST', { mappings: plan.mappings }))) throw new Error('the connection changed');
      } catch (failure) { throw new Error('Nothing was imported: ' + failure.message); }
    }
    if (plan.layout) {
      try { await this.#writeLayout(plan.layout); }
      catch (failure) {
        throw new Error(plan.counts.names
          ? `${describePlan({ counts: { ...plan.counts, floors: 0, rooms: 0, pins: 0, kept: 0 }, empty: false }, true)} The floors and pins were not imported: ${failure.message}`
          : 'Nothing was imported: ' + failure.message);
      }
    }
    const message = `${describePlan(plan, true)} Nothing was sent to the gateway.`;
    this.commandNotice = message;
    return message;
  };

  // Replace the layout and update the UI optimistically; rolled back and rethrown if the save fails.
  async #writeLayout(next) {
    const previous = this.layout, wasIllustrative = this.layoutIllustrative, current = this.epoch;
    const valid = validateLayout(next);
    this.layout = valid; this.layoutIllustrative = false;
    try {
      const result = await this.#api.request(this.#url('layout'), 'PUT', { layout: valid });
      if (current === this.epoch) this.layout = result.data;
    } catch (failure) {
      if (current === this.epoch) { this.layout = previous; this.layoutIllustrative = wasIllustrative; }
      throw failure;
    }
  }

  saveLayout = async next => {
    if (!this.gatewayKey) return false;
    const current = this.epoch;
    this.storageNotice = '';
    try { await this.#writeLayout(next); return true; }
    catch (failure) { if (current === this.epoch) this.storageNotice = 'Layout not saved: ' + failure.message; return false; }
  };

  toggleFavoriteLoad = id => {
    const list = this.layout.favorites.loads;
    return this.saveLayout({ ...this.layout, favorites: { ...this.layout.favorites, loads: list.includes(id) ? list.filter(item => item !== id) : [...list, id] } });
  };
  toggleFavoriteRoom = name => {
    const list = this.layout.favorites.rooms;
    return this.saveLayout({ ...this.layout, favorites: { ...this.layout.favorites, rooms: list.includes(name) ? list.filter(item => item !== name) : [...list, name] } });
  };

  // ---- connection ----
  connect = async payload => {
    this.demo = false;
    this.#resetLive();
    try {
      await this.#operation(async current => {
        this.notice = payload.pair ? 'Pairing — press a flashing gateway button within 30 seconds…' : 'Connecting…';
        this.commandNotice = '';
        const result = await this.#api.request('/api/connect', 'POST', payload);
        if (current !== this.epoch) return;
        this.connected = result.connected;
        this.remembered = result.remembered;
        this.host = bare(result.host);
        await this.#restoreLocal(this.host);
        if (current !== this.epoch) return;
        await this.#loadAll(current);
      });
    } finally { delete payload.token; }
  };

  reconnect = async () => {
    this.#resetLive();
    await this.#operation(async current => {
      const result = await this.#api.request('/api/reconnect', 'POST');
      if (current !== this.epoch) return;
      this.connected = true; this.demo = false; this.remembered = true;
      this.host = bare(result.host);
      await this.#restoreLocal(this.host);
      if (current === this.epoch) await this.#loadAll(current);
    });
  };

  disconnect = async (forget = true) => {
    if (this.disconnecting) return;
    this.#resetLive(); clearTimeout(this.#resyncTimer);
    this.disconnecting = true;
    this.demo = false; this.mappings = {}; this.layout = emptyLayout(); this.layoutIllustrative = false; this.gatewayKey = ''; this.storageNotice = ''; this.mappingBusy = false; this.review = null;
    this.epoch++;
    clearTimeout(this.#timer);
    this.#api.cancel();
    this.connected = false;
    this.busy = true;
    this.stale = true;
    this.loads = [];
    this.states = {};
    this.resources = {};
    this.diagnosticsBusy = false;
    this.updated = null;
    this.commandNotice = '';
    this.pendingAction = '';
    this.error = '';
    try {
      await this.#api.request(forget ? '/api/disconnect' : '/api/disconnect-session', 'POST');
      if (forget) this.remembered = false;
      this.notice = forget ? 'Disconnected — server credentials forgotten.' : 'Disconnected for now. Saved credentials kept; reconnect manually or restart the server.';
    } catch {
      this.notice = 'Polling stopped.';
      this.error = 'Could not confirm disconnect or credential removal. Saved credentials may remain on disk; check server permissions before restarting.';
    } finally { this.busy = false; this.disconnecting = false; }
  };

  explore = async () => {
    clearTimeout(this.#timer); this.#api.cancel(); this.epoch++;
    const sample = sampleHome();
    this.demo = true; this.connected = false; this.busy = true; this.stale = false; this.diagnosticsBusy = false;
    this.loads = sample.loads; this.states = sample.states;
    this.resources = Object.fromEntries(['rooms', 'buttons', 'sensors', 'westgroups', 'smartbuttons'].map(name => [name, { data: sample[name] }]));
    const current = this.epoch;
    await this.#restoreLocal('sample-home');
    if (current !== this.epoch) return;
    if (!this.layout.floors.length) { this.layout = sample.layout; this.layoutIllustrative = true; }
    this.busy = false;
    this.error = ''; this.notice = 'Sample home — simulated equipment. No gateway connected.'; this.updated = null;
  };

  // ---- commands ----
  write = (load, target) => {
    if (this.demo) {
      this.states = { ...this.states, [load.id]: { ...this.states[load.id], ...target } };
      this.commandNotice = 'Sample control updated. No gateway connected.';
      return;
    }
    return this.#operation(async current => {
      this.commandNotice = '';
      await this.#api.request(`/api/loads/${load.id}/target_state`, 'PUT', target, true);
      if (current !== this.epoch) return;
      this.commandNotice = `Target accepted for ${loadName(load)}. Check the reported state and the physical device; acceptance is not confirmation of movement.`;
      await this.#loadAll(current, false);
    }, { wait: true });
  };

  // One quick action over many loads: sequential writes, one refresh, honest partial-failure report.
  runAction = (action, loads) => {
    const spec = ACTIONS[action];
    const targets = actionTargets(action, loads, this.states);
    this.pendingAction = '';
    if (!targets.length) { this.commandNotice = `${spec.label}: nothing to change.`; return; }
    if (this.demo) {
      const next = { ...this.states };
      for (const load of targets) next[load.id] = { ...next[load.id], [spec.field]: spec.value };
      this.states = next;
      this.commandNotice = `Sample ${spec.label.toLowerCase()} applied to ${targets.length}. No gateway connected.`;
      return;
    }
    return this.#operation(async current => {
      this.commandNotice = '';
      const failed = [];
      let accepted = 0;
      const queue = [...targets];
      const worker = async () => {
        while (queue.length && current === this.epoch) {
          const load = queue.shift();
          try { await this.#api.request(`/api/loads/${load.id}/target_state`, 'PUT', { [spec.field]: spec.value }, true); accepted++; }
          catch { failed.push(loadName(load)); }
        }
      };
      const width = spec.kind === 'light' ? Math.min(LIGHT_PARALLEL, targets.length) : 1;
      await Promise.all(Array.from({ length: width }, worker));
      if (current !== this.epoch) return;
      this.commandNotice = `${spec.label}: targets accepted for ${accepted} of ${targets.length}. Check the reported states; acceptance is not confirmation of movement.`;
      if (failed.length) this.error = `Not sent to: ${failed.join(', ')}.`;
      await this.#loadAll(current, false);
    }, { wait: true });
  };

  // Blind actions move motors, so they ask first (inline, not a modal).
  requestAction = (action, loads) => {
    const spec = ACTIONS[action];
    const key = `${action}:${loads.map(load => load.id).join(',')}`;
    if (spec.confirm && this.pendingAction !== key) {
      if (!actionTargets(action, loads, this.states).length) { this.commandNotice = `${spec.label}: nothing to change.`; return; }
      this.pendingAction = key;
      return;
    }
    return this.runAction(action, loads);
  };
  cancelAction = () => { this.pendingAction = ''; };

  identifyButton = async button => {
    if (this.demo || !this.connected || this.busy) return;
    await this.#operation(async current => {
      this.commandNotice = '';
      try {
        await this.#api.request('/api/buttons/identify', 'POST', { device: button.device, channel: button.channel }, true);
        if (current !== this.epoch) return;
        this.commandNotice = 'Identification request accepted — look for the flashing button LED. No button assignment was changed.';
      } catch (failure) {
        if (current === this.epoch) this.error = 'Could not confirm button identification: ' + failure.message;
      }
    });
  };

  // ---- gateway metadata review (separate, explicit action) ----
  reviewLoad = $derived(this.review ? this.loads.find(load => String(load.id) === this.review.id) : null);
  reviewConflict = $derived(this.review && (!this.reviewLoad || Object.entries(this.review.expected).some(([field, value]) => (this.reviewLoad[field] ?? null) !== value)));

  openReview = (load, change) => {
    if (this.demo || this.busy || !this.connected) return;
    this.review = { id: String(load.id), ...change };
  };
  closeReview = () => { this.review = null; };

  applyReview = () => {
    if (this.demo || !this.connected || !this.review || this.reviewConflict) return;
    const { id, changes, expected } = this.review;
    this.review = null;
    return this.#operation(async current => {
      await this.#api.request('/api/loads/' + id + '/config', 'PATCH', { changes, expected }, true);
      if (current !== this.epoch) return;
      this.commandNotice = 'Gateway metadata change accepted. Your personal mapping is kept separately.';
      await this.#loadAll(current, false);
    });
  };

  dismissCommandNotice = () => { this.commandNotice = ''; };

  // ---- lifecycle ----
  start() {
    this.busy = false;
    this.#operation(async current => {
      let session = await this.#api.request('/api/session');
      while (session.connecting && current === this.epoch) {
        this.notice = 'Connecting — waiting for gateway…';
        await new Promise(resolve => setTimeout(resolve, 300));
        if (current !== this.epoch) return;
        session = await this.#api.request('/api/session');
      }
      if (current !== this.epoch) return;
      this.connected = session.connected;
      this.remembered = session.remembered;
      if (session.host) this.host = bare(session.host);
      if (session.credentialError) this.error = session.credentialError;
      if (this.connected) {
        await this.#restoreLocal(this.host);
        if (current !== this.epoch) return;
        await this.#loadAll(current);
      } else this.notice = session.connecting ? 'A connection is pending in another tab; disconnect to cancel it.' : 'Not connected.';
    });
  }

  stop() {
    this.epoch++;
    clearTimeout(this.#timer); clearTimeout(this.#resyncTimer);
    this.#stopLive?.();
    this.#api.cancel();
  }
}
