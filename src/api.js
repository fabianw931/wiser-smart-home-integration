export function createApi() {
  const pending = new Set();
  let draftScope = null;
  let stopEvents = () => {};
  return {
    cancel() { stopEvents(); for (const controller of pending) controller.abort(); },
    events(onEvent, onUnavailable) {
      stopEvents();
      const scope = draftScope;
      const controller = new AbortController();
      let retryTimer;
      let delay = 1000;
      stopEvents = () => { clearTimeout(retryTimer); controller.abort(); };
      const connect = async () => {
        let reader;
        try {
          const response = await fetch('/api/events', { signal: controller.signal, cache: 'no-store', headers: { 'X-Wiser-Client': 'local-poc', 'X-Wiser-Scope': scope || '' } });
          if (!response.ok) {
            onUnavailable(response.status === 409);
            if ([403, 404, 409].includes(response.status)) return;
            throw new Error('Stream unavailable');
          }
          delay = 1000;
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 131072) throw new Error('Stream too large');
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.scope === scope && !controller.signal.aborted) onEvent(event);
            }
          }
        } catch { /* Reconnect below; normal polling remains independent. */ }
        finally { if (reader) await reader.cancel().catch(() => {}); }
        if (!controller.signal.aborted) {
          onUnavailable(false);
          retryTimer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30000);
        }
      };
      void connect();
      return stopEvents;
    },
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
