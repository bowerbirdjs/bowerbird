/**
 * The starter icon set for `icon` nodes: outline drawings on a 24-unit grid, stroked in the text
 * colour. Drawn for Bowerbird, like the editor's own icons (no icon library, no licence to carry).
 * Hosts add or replace icons with `registry.registerIcons({ name: '<svg …>' })`.
 */
export const ICONS: Record<string, string> = {
  // Arrows
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'external-link':
    '<path d="M14 4h6v6M20 4l-9 9M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>',
  // Marks
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.8"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9M12 16.6v.1"/>',
  // Value and trust
  star: '<path d="M12 3.4l2.47 6.1 6.57.46-5.05 4.24 1.59 6.39L12 17.1l-5.58 3.49 1.59-6.39-5.05-4.24 6.57-.46L12 3.4Z"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
  sparkles:
    '<path d="M10 4.5 11.6 9a2 2 0 0 0 1.4 1.4L17.5 12 13 13.6a2 2 0 0 0-1.4 1.4L10 19.5 8.4 15A2 2 0 0 0 7 13.6L2.5 12 7 10.4A2 2 0 0 0 8.4 9L10 4.5Z"/><path d="M18.5 3v4M16.5 5h4M19 17v3M17.5 18.5h3"/>',
  shield:
    '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z"/><path d="m9 12 2.2 2.2L15 10.4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.5 11.5 8-8M16 7l3 3M13.5 9.5l2 2"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7.5 5-2.5 5 2.5-1.5-7.5"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  'thumbs-up':
    '<path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7Zm0 0 3.5-7A2.5 2.5 0 0 1 13 6.5V9h5.2a2 2 0 0 1 2 2.4l-1.3 7a2 2 0 0 1-2 1.6H7"/>',
  smile:
    '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.1M15 9.5v.1"/>',
  // Time and place
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  'map-pin':
    '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8Z"/>',
  building:
    '<path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M8.5 8h3M8.5 12h3M8.5 16h3"/>',
  // People and talk
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  users:
    '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.5L7 21v-4H6a2 2 0 0 1-2-2V6Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z"/>',
  share:
    '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.2 10.8 7-3.6M8.2 13.2l7 3.6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z"/><path d="M10 21h4"/>',
  quote:
    '<path d="M10 13H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6.5A2.5 2.5 0 0 1 7.5 17M19 13h-4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6.5a2.5 2.5 0 0 1-2.5 2.5"/>',
  'life-buoy':
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  headphones:
    '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
  // Work and product
  rocket:
    '<path d="M12 3c3 2.5 4.5 6 4.5 9.5V16h-9v-3.5C7.5 9 9 5.5 12 3Z"/><path d="M7.5 13 5 16.5V19l2.5-1.5M16.5 13l2.5 3.5V19l-2.5-1.5M10.5 19c.3 1.2.8 2 1.5 2.5.7-.5 1.2-1.3 1.5-2.5"/><circle cx="12" cy="10" r="1.6"/>',
  lightbulb:
    '<path d="M9 17.5h6M10 20.5h4M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2Z"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V6M17 16V8"/>',
  'trending-up': '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  layers:
    '<path d="m12 2.5 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  sliders:
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
  terminal:
    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5"/>',
  database:
    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.5 3.75 3.75 0 0 1-.65 7.46H7Z"/>',
  briefcase:
    '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 13h18"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  refresh: '<path d="M20 5v5h-5"/><path d="M19.5 10A8 8 0 1 0 20 13.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  // Commerce
  'credit-card': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  cart: '<path d="M3 4h2.5l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.3"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17.5" cy="19.5" r="1.3"/>',
  tag: '<path d="M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5L21 12l-8.5 8.5-9-8Z"/><circle cx="8" cy="8" r="1.2"/>',
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M6 13v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6M12 9v11"/><path d="M12 9c-1-3-2.5-4.5-4.2-4.5a2.2 2.2 0 0 0 0 4.5H12ZM12 9c1-3 2.5-4.5 4.2-4.5a2.2 2.2 0 0 1 0 4.5H12Z"/>',
  box: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  truck:
    '<path d="M2.5 6.5h11v10h-11zM13.5 10h4l3.5 3.5v3h-7.5"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  // Media and nature
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  camera:
    '<path d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="12.5" r="3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5-5.5-3.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14.5-14.5C19 14 13.5 19.5 5 19Z"/><path d="m5 19 8-8"/>',
  flag: '<path d="M5 21V4M5 4.5c5-2.5 8 2.5 14 0v9c-6 2.5-9-2.5-14 0"/>',
  bookmark: '<path d="M6 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V21l-6-4.5L6 21V4.5Z"/>',
};
