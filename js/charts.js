// Hand-built charts (no libraries, so they work offline and under a strict CSP).
// Mark specs: bars at most 24px thick with a 4px rounded data end and a square baseline,
// a 2px gap between touching bars, hairline solid gridlines, and a hover/focus tooltip.

import { h, svg } from './dom.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function hideTooltip() {
  const el = document.getElementById('tooltip');
  if (el) el.hidden = true;
  document.querySelectorAll('.col-group.active').forEach((g) => g.classList.remove('active'));
  document.querySelectorAll('.cross.on').forEach((g) => g.classList.remove('on'));
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
// rows: [{ label, value, previous? }]; values are cents. cls: the series colour (s1 income, s2 spending,
// s3 set aside); of: what the shares are a share of.
export function barList(rows, { format, total, previousLabel, cls = 's1', of = 'spending' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'barlist' }, rows.map((row) => {
    const share = total ? percent.format(row.value / total) : '';
    const bar = h('span', { class: `barlist-bar ${cls}`, style: { width: `calc((100% - var(--barlist-value)) * ${row.value / max})` } });
    const el = h('div', { class: 'barlist-row', tabindex: 0, 'aria-label': `${row.label}: ${format(row.value)}${share ? `, ${share} of ${of}` : ''}` },
      h('span', { class: 'barlist-label' }, row.label),
      h('span', { class: 'barlist-track' }, bar, h('span', { class: 'barlist-value' }, format(row.value))));
    const details = [{ value: format(row.value), label: share ? `${share} of ${of}` : '' }];
    if (row.previous !== undefined) details.push({ value: format(row.previous), label: previousLabel });
    bindTooltip(el, () => showTooltip(bar, row.label, details));
    return el;
  }));
}

// Redraws a chart to fit its container whenever the container's width changes.
function fitToWidth(plot, draw) {
  let drawnWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width);
    if (width > 0 && width !== drawnWidth) {
      drawnWidth = width;
      plot.replaceChildren(draw(width));
    }
  }).observe(plot);
}

// The legend mirrors the mark: a block for bars, a short stroke for lines. One series needs none.
function legend(series, mark = 'bar', always = false) {
  if (series.length < 2 && !always) return null;
  return h('div', { class: 'legend' }, series.map((s) => h('span', { class: 'legend-item' }, h('span', { class: `legend-swatch${mark === 'line' ? ' legend-line' : ''} ${s.cls}` }), s.name)));
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
  const figure = h('figure', { class: 'chart', role: 'group', 'aria-label': label }, legend(series), plot);
  fitToWidth(plot, draw);
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

// Lines over time on one axis that includes zero. points: [{ label, longLabel }]; series: [{ name, cls, values }],
// where a series may stop early (a missing value draws nothing). The pointer finds the nearest position and
// one tooltip lists every series there; the arrow keys do the same from the keyboard.
export function lineChart({ points, series, format, formatAxis, label }) {
  const plot = h('div', { class: 'chart-plot' });
  const figure = h('figure', { class: 'chart', role: 'group', 'aria-label': label }, legend(series, 'line'), plot);
  fitToWidth(plot, draw);
  return figure;

  function draw(width) {
    const height = 220;
    const pad = { top: 10, right: 12, bottom: 26, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const has = (v) => typeof v === 'number';
    const all = series.flatMap((s) => s.values.filter(has));
    const low = Math.min(0, ...all);
    const high = Math.max(0, ...all);
    const { step } = niceScale(Math.max(10000, high - low));
    const min = Math.floor(low / step) * step;
    const max = Math.max(min + step, Math.ceil(high / step) * step);
    const n = points.length;
    const x = (i) => pad.left + (n < 2 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;
    const root = svg('svg', { class: 'chart-svg', width, height, viewBox: `0 0 ${width} ${height}` });

    for (let value = min; value <= max + step / 2; value += step) {
      const at = Math.round(y(value)) + 0.5;
      root.append(
        svg('line', { class: value === 0 ? 'axis-line' : 'grid-line', x1: pad.left, x2: width - pad.right, y1: at, y2: at }),
        svg('text', { class: 'tick', x: pad.left - 8, y: at, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, formatAxis(value)));
    }
    const labelEvery = Math.max(1, Math.ceil(44 / (plotW / Math.max(1, n - 1))));
    points.forEach((p, i) => {
      if (i % labelEvery === 0) root.append(svg('text', { class: 'tick', x: x(i), y: height - 8, 'text-anchor': 'middle' }, p.label));
    });

    for (const s of series) {
      let d = '';
      let last = -1;
      s.values.forEach((v, i) => {
        if (!has(v) || i >= n) return;
        d += `${last === i - 1 && d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        last = i;
      });
      if (!d) continue;
      root.append(svg('path', { class: `line ${s.cls}`, d }));
      root.append(svg('circle', { class: `dot ${s.cls}`, cx: x(last), cy: y(s.values[last]), r: 4 }));
    }

    // The crosshair and its dots, shown at the position nearest the pointer.
    const hair = svg('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH });
    const dots = series.map((s) => svg('circle', { class: `dot ${s.cls}`, r: 4 }));
    const cross = svg('g', { class: 'cross' }, hair, dots);
    const lastIndex = Math.max(0, ...series.map((s) => Math.min(n, s.values.length) - 1));
    let index = lastIndex;
    const show = (i) => {
      index = Math.max(0, Math.min(n - 1, i));
      hideTooltip();
      hair.setAttribute('x1', x(index));
      hair.setAttribute('x2', x(index));
      const rows = [];
      series.forEach((s, k) => {
        const v = s.values[index];
        dots[k].style.display = has(v) ? '' : 'none';
        if (!has(v)) return;
        dots[k].setAttribute('cx', x(index));
        dots[k].setAttribute('cy', y(v));
        rows.push({ cls: s.cls, value: format(v), label: s.name });
      });
      cross.classList.add('on');
      showTooltip(hair, points[index].longLabel, rows);
    };
    const fromPointer = (event) => {
      const box = root.getBoundingClientRect();
      show(n < 2 ? 0 : Math.round(((event.clientX - box.left - pad.left) / plotW) * (n - 1)));
    };
    const hit = svg('rect', {
      class: 'col-hit',
      x: pad.left - 6,
      y: pad.top,
      width: plotW + 12,
      height: plotH + pad.bottom,
      tabindex: 0,
      role: 'img',
      'aria-label': `${label}. ${series.map((s) => {
        const values = s.values.filter(has);
        return values.length ? `${s.name}: ${format(values[values.length - 1])} at the end` : `${s.name}: nothing yet`;
      }).join('; ')}. Use the left and right arrow keys to read each point.`,
    });
    hit.dataset.tip = '';
    hit.addEventListener('pointermove', fromPointer);
    hit.addEventListener('pointerdown', fromPointer);
    hit.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') hideTooltip();
    });
    hit.addEventListener('focus', () => show(index));
    hit.addEventListener('blur', hideTooltip);
    hit.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      show(index + (event.key === 'ArrowLeft' ? -1 : 1));
    });
    root.append(cross, hit);
    return root;
  }
}

// One whole split into parts: a tall bar of blocks, each with its share printed on it where it fits.
// parts: [{ name, value, cls }] in cents; a part at zero draws nothing. of: what the shares are a share of.
export function segmentBar({ parts, format, label, of }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  const share = (p) => percent.format(p.value / total);
  const blocks = shown.map((p) => {
    const text = h('span', { class: 'segbar-label' }, share(p));
    const block = h('span', { class: `segbar-block ${p.cls}`, style: { flexGrow: p.value }, tabindex: 0, 'aria-label': `${p.name}: ${format(p.value)}, ${share(p)} of ${of}` }, text);
    bindTooltip(block, () => showTooltip(block, p.name, [{ value: format(p.value), label: `${share(p)} of ${of}` }]));
    return { block, text };
  });
  const bar = h('div', { class: 'segbar' }, blocks.map((b) => b.block));
  // A block too narrow for its share prints none; the legend, the tooltip and the table still carry it.
  new ResizeObserver(() => {
    for (const { block, text } of blocks) text.style.visibility = block.clientWidth >= text.scrollWidth + 14 ? '' : 'hidden';
  }).observe(bar);
  return h('figure', { class: 'chart', role: 'group', 'aria-label': label }, legend(shown, 'bar', true), bar);
}
