// Clearly labeled sample home, used only for browser previews. Never sent to a gateway.
export function sampleHome() {
  return {
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
