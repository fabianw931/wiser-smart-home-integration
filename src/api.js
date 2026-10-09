export function createApi() {
  const pending = new Set();
  let draftScope = null;
  return {
    cancel() { for (const controller of pending) controller.abort(); },
    async request(path, method = 'GET', payload, live = false) {
      const controller = new AbortController();
      pending.add(controller);
      const timeout = setTimeout(() => controller.abort(), path === '/api/connect' ? 60000 : 15000);
      try {
        const response = await fetch(path, {
          method, signal: controller.signal, cache: 'no-store',
          headers: { 'X-Wiser-Client': 'local-poc', ...(live ? { 'X-Wiser-Intent': 'live', 'X-Wiser-Scope': draftScope || '' } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.error || 'Request failed.');
          error.status = response.status;
          throw error;
        }
        if (['/api/connect', '/api/session', '/api/reconnect'].includes(path)) draftScope = result.draftScope || null;
        if (['/api/disconnect', '/api/disconnect-session'].includes(path)) draftScope = null;
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Request timed out or was cancelled.');
        throw error;
      } finally {
        clearTimeout(timeout);
        pending.delete(controller);
      }
    },
  };
}
