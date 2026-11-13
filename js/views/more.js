import { h, icon } from '../dom.js';
import { card, viewHead } from '../ui.js';

// The phone layout's "More" tab: the pages that don't fit in the bottom bar.
const LINKS = [
  ['budgets', 'Budgets', 'budget'],
  ['recurring', 'Recurring', 'repeat'],
  ['reports', 'Reports', 'chart'],
  ['settings', 'Settings', 'settings'],
];

export function renderMore(ctx) {
  return h('div', { class: 'view' },
    viewHead(ctx, 'More'),
    card({ cls: 'card-list' }, LINKS.map(([route, label, name]) => h('a', { class: 'list-link', href: `#/${route}` },
      icon(name), h('span', {}, label), icon('chevronRight', 'icon-sm push')))));
}
