// Hand-built charts (no libraries, so they work offline and under a strict CSP).
// Mark specs: bars at most 24px thick with a 4px rounded data end and a square baseline,
// a 2px gap between touching bars, hairline solid gridlines, and a hover/focus tooltip.

import { h, svg } from './dom.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function hideTooltip() {
  const el = document.getElementById('tooltip');
  if (el) el.hidden = true;
  document.querySelectorAll('.col-group.active').forEach((g) => g.classList.remove('active'));
}

// Values lead and labels follow; series are keyed with a short stroke of their colour.
function showTooltip(anchor, title, rows) {
  const el = document.getElementById('tooltip');
  el.replaceChildren(
    h('div', { class: 'tooltip-title' }, title),
    ...rows.map((row) => h('div', { class: 'tooltip-row' },
      row.cls ? h('span', { class: `tooltip-key ${row.cls}` }) : null,
      h('span', { class: 'tooltip-value' }, row.value),
      h('span', { class: 'tooltip-label' }, row.label))));
  el.hidden = false;
  const a = anchor.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  let top = a.top - t.height - 8;
  if (top < 8) top = a.bottom + 8;
  const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

// Touch has no hover: a tap shows the tooltip, and scrolling or tapping elsewhere hides it.
addEventListener('scroll', hideTooltip, { passive: true });
addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('[data-tip]')) hideTooltip();
}, true);

function bindTooltip(el, show) {
  el.dataset.tip = '';
  el.addEventListener('pointerenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') hideTooltip();
  });
  el.addEventListener('blur', hideTooltip);
}

// Ranked horizontal bars in one hue, value at the tip.
// rows: [{ label, value, previous? }]; values are cents.
export function barList(rows, { format, total, previousLabel }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'barlist' }, rows.map((row) => {
    const share = total ? percent.format(row.value / total) : '';
    const bar = h('span', { class: 'barlist-bar s1', style: { width: `calc((100% - var(--barlist-value)) * ${row.value / max})` } });
    const el = h('div', { class: 'barlist-row', tabindex: 0, 'aria-label': `${row.label}: ${format(row.value)}${share ? `, ${share} of spending` : ''}` },
      h('span', { class: 'barlist-label' }, row.label),
      h('span', { class: 'barlist-track' }, bar, h('span', { class: 'barlist-value' }, format(row.value))));
    const details = [{ value: format(row.value), label: share ? `${share} of spending` : '' }];
    if (row.previous !== undefined) details.push({ value: format(row.previous), label: previousLabel });
    bindTooltip(el, () => showTooltip(bar, row.label, details));
    return el;
  }));
}

function niceScale(maxValue, ticks = 4) {
  const raw = maxValue / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const f = raw / magnitude;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * magnitude;
  return { step, max: Math.ceil(maxValue / step) * step };
}

function barPath(x, y, w, height) {
  const r = Math.min(4, w / 2, height);
  return `M${x},${y + height}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + height}Z`;
}

// Grouped columns over time. data: [{ label, longLabel, values: [cents per series] }];
// series: [{ name, cls }]. Redraws to fit its container's width.
export function columnChart({ data, series, format, formatAxis, label, highlight = data.length - 1 }) {
  const plot = h('div', { class: 'chart-plot' });
  const figure = h('figure', { class: 'chart', role: 'group', 'aria-label': label },
    h('div', { class: 'legend' }, series.map((s) => h('span', { class: 'legend-item' }, h('span', { class: `legend-swatch ${s.cls}` }), s.name))),
    plot);
  let drawnWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width);
    if (width > 0 && width !== drawnWidth) {
      drawnWidth = width;
      plot.replaceChildren(draw(width));
    }
  }).observe(plot);
  return figure;

  function draw(width) {
    const height = 220;
    const pad = { top: 8, right: 2, bottom: 26, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const { step, max } = niceScale(Math.max(10000, ...data.flatMap((d) => d.values)));
    const band = plotW / data.length;
    const barW = Math.max(2, Math.min(24, (band * 0.7 - 2) / series.length));
    const groupW = barW * series.length + 2 * (series.length - 1);
    const labelEvery = Math.ceil(40 / band);
    const root = svg('svg', { class: 'chart-svg', width, height, viewBox: `0 0 ${width} ${height}` });

    for (let value = 0; value <= max + step / 2; value += step) {
      const y = Math.round(pad.top + plotH - (value / max) * plotH) + 0.5;
      root.append(
        svg('line', { class: value === 0 ? 'axis-line' : 'grid-line', x1: pad.left, x2: width - pad.right, y1: y, y2: y }),
        svg('text', { class: 'tick', x: pad.left - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, formatAxis(value)));
    }

    data.forEach((d, i) => {
      const x = pad.left + i * band;
      const group = svg('g', { class: 'col-group' });
      group.append(svg('rect', { class: 'col-band', x: x + 1, y: pad.top, width: band - 2, height: plotH, rx: 6 }));
      d.values.forEach((value, s) => {
        if (value <= 0) return;
        const barH = Math.max(1, (value / max) * plotH);
        const bx = x + (band - groupW) / 2 + s * (barW + 2);
        group.append(svg('path', { class: `bar ${series[s].cls}`, d: barPath(bx, pad.top + plotH - barH, barW, barH) }));
      });
      if ((data.length - 1 - i) % labelEvery === 0) {
        group.append(svg('text', { class: `tick${i === highlight ? ' tick-strong' : ''}`, x: x + band / 2, y: height - 8, 'text-anchor': 'middle' }, d.label));
      }
      const hit = svg('rect', {
        class: 'col-hit',
        x,
        y: pad.top,
        width: band,
        height: plotH + pad.bottom,
        tabindex: 0,
        role: 'img',
        'aria-label': `${d.longLabel}: ${series.map((s, k) => `${s.name} ${format(d.values[k])}`).join(', ')}`,
      });
      bindTooltip(hit, () => {
        hideTooltip();
        group.classList.add('active');
        showTooltip(hit, d.longLabel, series.map((s, k) => ({ cls: s.cls, value: format(d.values[k]), label: s.name })));
      });
      group.append(hit);
      root.append(group);
    });
    return root;
  }
}
