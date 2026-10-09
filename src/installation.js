// Keep missing readings distinct from zero; never infer weather-station ownership.
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function resourceItems(result) {
  return Array.isArray(result?.data) ? result.data.filter(record) : [];
}
export function sensorReading(sensor) {
  const value = sensor.value;
  if (['rain', 'hail'].includes(sensor.type) || sensor.unit === 'bool') {
    if (value === true || value === 1) return 'Detected';
    if (value === false || value === 0) return 'Not detected';
    return 'Unavailable';
  }
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${typeof sensor.unit === 'string' && sensor.unit ? ' ' + sensor.unit : ''}`;
  // Structured or undocumented values remain inspectable without inventing units.
  return 'Unavailable';
}
export function registeredButton(button) {
  return Number.isSafeInteger(button.id) && button.id >= 0;
}
export function identifiableButton(button) {
  return typeof button.device === 'string' && /^[a-f0-9]{1,64}$/i.test(button.device)
    && Number.isSafeInteger(button.channel) && button.channel >= 0;
}
export function resourceStatus(result, now = Date.now(), demo = false) {
  if (demo) return 'Sample data';
  if (!result) return 'Not loaded';
  if (result.error) return result.unsupported ? 'Unsupported by gateway' : 'Unavailable';
  if (!Array.isArray(result.data) || result.data.some(item => !record(item))) return 'Invalid response';
  if (!Number.isFinite(result.observedAt) || now - result.observedAt > 90000) return 'Stale';
  return 'Reported';
}
