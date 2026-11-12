const SVG_NS = 'http://www.w3.org/2000/svg';

// Tiny element builder. String children become text nodes, so user data is never parsed as HTML.
export function h(tag, props = {}, ...children) {
  const isSvg = tag.startsWith('svg:');
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  let value;
  for (const [key, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (key === 'style') Object.assign(el.style, v);
    else if (key === 'dataset') Object.assign(el.dataset, v);
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2), v);
    else if (key === 'value') value = v; // Set after children, so a <select> already has its options.
    else if (!isSvg && key in el && !key.includes('-')) el[key] = v;
    else el.setAttribute(key, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  if (value !== undefined) el.value = value;
  return el;
}

export const svg = (tag, props, ...children) => h(`svg:${tag}`, props, ...children);

const ICONS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle class="fill" cx="4.5" cy="6" r="1.2"/><circle class="fill" cx="4.5" cy="12" r="1.2"/><circle class="fill" cx="4.5" cy="18" r="1.2"/>',
  budget: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.6v9.9z"/><path d="M14 3.2a8.5 8.5 0 0 1 6.8 6.8H14z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle class="fill" cx="12" cy="12" r="1.2"/>',
  repeat: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 11V9.5A2.5 2.5 0 0 1 6 7h14.5"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 13v1.5A2.5 2.5 0 0 1 18 17H3.5"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="M8 16.5v-5M12.5 16.5V7M17 16.5v-8"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<circle class="fill" cx="5.5" cy="12" r="1.6"/><circle class="fill" cx="12" cy="12" r="1.6"/><circle class="fill" cx="18.5" cy="12" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronLeft: '<path d="M14.5 18 8.5 12l6-6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  cloudCheck: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  cloudOff: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z"/><path d="M4 4l16 16"/>',
  refresh: '<path d="M19.5 11A7.5 7.5 0 0 0 6 6.6L4.5 8"/><path d="M4.5 3.5V8H9"/><path d="M4.5 13A7.5 7.5 0 0 0 18 17.4l1.5-1.4"/><path d="M19.5 20.5V16H15"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><circle class="fill" cx="12" cy="17" r="1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M4.5 19.5h15"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle class="fill" cx="12" cy="8" r="1"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M17 14v5.5H4.5V7H10"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
};

// Icon markup comes only from the constants above, never from user data.
export function icon(name, className = '') {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', `icon ${className}`.trim());
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] ?? '';
  return el;
}

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(h('span', {}, message));
  if (action) {
    el.append(h('button', { type: 'button', onclick: () => { el.classList.remove('show'); action.run(); } }, action.label));
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 3000);
}

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
