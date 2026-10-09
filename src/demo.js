// Clearly labeled sample home, used only for browser previews. Never sent to a gateway.
export function sampleHome() {
  return {
    buttons: [
      { id: 101, name: 'Entrance switch', device: '0000a98f', channel: 0, type: 'button', sub_type: 'up down', job: 8 },
      { id: null, name: 'Living room switch', device: '0000a98f', channel: 1, type: 'button', sub_type: 'up down' },
    ],
    smartbuttons: [{ id: 101, name: 'Entrance scene button', job: 8 }],
    sensors: [
      { id: 21, name: 'Outdoor temperature', device: '00000124', channel: 0, type: 'temperature', value: 18.5, unit: '°C' },
      { id: 23, name: 'Daylight', device: '00000124', channel: 2, type: 'illuminance', value: 12000, unit: 'lux' },
      { id: 24, name: 'Wind', device: '00000124', channel: 3, type: 'wind', value: 3.2, unit: 'm/s' },
      { id: 25, name: 'Rain', device: '00000124', channel: 4, type: 'rain', value: 0, unit: 'bool' },
      { id: 26, name: 'Hail', device: '00000124', channel: 5, type: 'hail', value: false, unit: 'bool' },
    ],
    westgroups: [{ id: 6, name: 'Living room protection', loads: [3], wind: { action: 'up and lock', threshold: 5.5, unit: 'm/s' }, temperature: { action: 'off' }, rain: { action: 'off' }, hail: { action: 'up and lock' } }],
    rooms: [{ id: 1, name: 'Living room' }, { id: 2, name: 'Kitchen' }, { id: 3, name: 'Bedroom' }],
    loads: [
      { id: 1, name: 'Pendant lights', type: 'dali', sub_type: 'tw', room: 1, device: 'sample-1', channel: 0 },
      { id: 2, name: 'Reading corner', type: 'dim', room: 1, device: 'sample-2', channel: 0 },
      { id: 3, name: 'Window blinds', type: 'motor', room: 1, device: 'sample-3', channel: 0 },
      { id: 4, name: 'Counter lighting', type: 'dali', sub_type: 'rgb', room: 2, device: 'sample-4', channel: 0 },
      { id: 5, name: 'Ceiling light', type: 'onoff', room: 3, device: 'sample-5', channel: 0 },
    ],
    states: { 1: { bri: 6500, ct: 3000 }, 2: { bri: 3500 }, 3: { level: 2000 },
      4: { bri: 8000, red: 255, green: 160, blue: 60, white: 80 }, 5: { bri: 0 } },
  };
}
