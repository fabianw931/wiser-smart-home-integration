<script>
  // One stroke weight and one family for every icon in the app.
  let { name, size = 20 } = $props();
  const paths = {
    bulb: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.8-1 2H9c0-.2 0-1.2-1-2Z',
    blind: 'M4 3h16v14H4zM4 7h16M4 11h16M4 15h16M12 17v4m-3 0h6',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9Z',
    chevron: 'M6 9l6 6 6-6',
    home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
    sensors: 'M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z',
    settings: 'M4 7h10m4 0h2M4 17h4m4 0h8M16 5v4M10 15v4',
    close: 'M6 6l12 12M18 6L6 18',
    alert: 'M12 4l9 16H3zM12 10v4m0 3v.01',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
    wind: 'M3 9h10a3 3 0 1 0-3-3M3 14h14a3 3 0 1 1-3 3M3 19h6',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
    temp: 'M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d={paths[name]} />
</svg>
