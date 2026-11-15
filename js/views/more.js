import { h, icon } from '../dom.js';
import { card, viewHead } from '../ui.js';

// The menu in the top bar: the pages that don't fit in the phone's bottom bar.
const LINKS = [
  ['insights', 'Insights', 'trend'],
  ['reports', 'Reports', 'chart'],
  ['settings', 'Settings', 'settings'],
];

export function renderMore(ctx) {
  return h('div', { class: 'view' },
    viewHead(ctx, 'Menu'),
    card({ cls: 'card-list' }, LINKS.map(([route, label, name]) => h('a', { class: 'list-link', href: `#/${route}` },
      icon(name), h('span', {}, label), icon('chevronRight', 'icon-sm push')))));
}
