/* Chart factories.
 *
 * Each returns a small handle: `{ update(data, opts), chart, dispose() }`. A
 * page builds its charts once and calls `update` on every interaction, so a
 * filter change redraws rather than rebuilds: ECharts keeps the geometry and
 * only the data moves.
 *
 * The form rules these follow, and the reasons, in short:
 *
 *   - **One axis, always.** Two measures of different scale get two charts, not
 *     a second y-axis: the alignment of two scales is arbitrary, so a dual axis
 *     invents a correlation the data does not contain.
 *   - **A ranked bar is one colour.** Colouring each bar darker-where-bigger
 *     double-encodes the length as hue and spends the only free channel on
 *     something the bar already shows.
 *   - **Eight categorical slots, never a ninth.** The tail folds into "Other",
 *     which `Dataset.group` does with `limit`.
 *   - **A legend whenever there are two or more series**, so identity is never
 *     carried by colour alone, and selective direct labels rather than a number
 *     on every mark.
 *   - **Empty months are drawn as zero**, because a gap joined by a line draws a
 *     slope through a quiet quarter as though it were a trend.
 */

import { fmt, fmtMeasure, monthLabel } from './data.js';
import { axisStyle, chartBase, colorsFor, onThemeChange, palette, typeColor } from './theme.js';

const BAR_RADIUS = [4, 4, 0, 0];
const BAR_RADIUS_H = [0, 4, 4, 0];

/** Make an ECharts instance that follows the theme and the container's size. */
function mount(el) {
  const chart = window.echarts.init(el, null, { renderer: 'canvas' });
  const resize = () => chart.resize();
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  const off = onThemeChange(() => el.__redraw && el.__redraw());
  return {
    chart,
    dispose() {
      observer.disconnect();
      off();
      chart.dispose();
    },
  };
}

/** Wrap a draw function so a theme change re-runs it with the last data. */
function handle(el, draw) {
  const { chart, dispose } = mount(el);
  let last = null;
  el.__redraw = () => last && draw(chart, ...last);
  return {
    chart,
    dispose,
    update(...args) {
      last = args;
      draw(chart, ...args);
    },
  };
}

/* ------------------------------------------------------------------ timeline */

/**
 * Records over time, as bars, with a brush.
 *
 * Bars rather than a line: these are counts in a bucket, and a line between
 * monthly counts implies a value on the days between them. The brush is the
 * page's date filter. Dragging it is how a reader asks "what about that
 * spring?", which is the question the data most often raises.
 */
export function timeline(el, { onBrush = null } = {}) {
  const h = handle(el, (chart, series, opts = {}) => {
    const p = palette();
    const { measure = null, unit = '', grain = 'month' } = opts;
    const labels = series.map((d) => (grain === 'month' ? monthLabel(d.key) : d.key));
    const counts = series.map((d) => d.n);
    const peak = Math.max(0, ...counts);

    chart.setOption(
      {
        ...chartBase(),
        grid: { left: 8, right: 14, top: 22, bottom: onBrush ? 44 : 6, containLabel: true },
        tooltip: {
          ...chartBase().tooltip,
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (items) => {
            const i = items[0].dataIndex;
            const d = series[i];
            const rows = [`<b>${labels[i]}</b>`, `${fmt(d.n)} record${d.n === 1 ? '' : 's'}`];
            if (measure && d.v != null) rows.push(`${fmtMeasure(d.v, unit)} ${unit}`);
            return rows.join('<br>');
          },
        },
        xAxis: {
          type: 'category',
          data: labels,
          ...axisStyle(p),
          splitLine: { show: false },
          axisLabel: { ...axisStyle(p).axisLabel, interval: 'auto' },
        },
        yAxis: {
          type: 'value',
          name: measure ? `${unit}` : 'records',
          nameTextStyle: { color: p.ink3, fontSize: 11, align: 'left' },
          nameGap: 10,
          ...axisStyle(p),
          axisLine: { show: false },
        },
        dataZoom: onBrush
          ? [
              {
                type: 'slider',
                height: 22,
                bottom: 6,
                borderColor: p.hairline,
                backgroundColor: 'transparent',
                fillerColor: `${p.series[0]}22`,
                handleStyle: { color: p.series[0], borderColor: p.card },
                moveHandleStyle: { color: p.axis },
                dataBackground: {
                  lineStyle: { color: p.axis, width: 1 },
                  areaStyle: { color: p.hairline },
                },
                selectedDataBackground: {
                  lineStyle: { color: p.series[0] },
                  areaStyle: { color: `${p.series[0]}33` },
                },
                textStyle: { color: p.ink3, fontSize: 10 },
                labelFormatter: (i) => labels[i] || '',
              },
            ]
          : [],
        series: [
          {
            type: 'bar',
            data: measure ? series.map((d) => d.v || 0) : counts,
            itemStyle: { color: p.series[0], borderRadius: BAR_RADIUS },
            barMaxWidth: 26,
            // A 2px gap of surface between neighbours instead of a border:
            // a stroke round every bar reads as a cage at this density.
            barCategoryGap: '22%',
            label: {
              show: !measure && series.length <= 24,
              position: 'top',
              color: p.ink3,
              fontSize: 10,
              // Only the peak is labelled: a number over every bar goes unread
              // and the axis plus the tooltip carry the rest.
              formatter: (d) => (d.value === peak && peak > 0 ? fmt(d.value) : ''),
            },
          },
        ],
      },
      { notMerge: true }
    );

    if (onBrush) {
      chart.off('dataZoom');
      chart.on('dataZoom', () => {
        const zoom = chart.getOption().dataZoom[0];
        const lo = Math.max(0, Math.round((zoom.start / 100) * (series.length - 1)));
        const hi = Math.min(series.length - 1, Math.round((zoom.end / 100) * (series.length - 1)));
        onBrush(series[lo] && series[lo].key, series[hi] && series[hi].key);
      });
    }
  });
  return h;
}

/* ------------------------------------------------------------------ stacked */

/** A monthly series split by one column. Stacked bars, legend always present. */
export function stacked(el, { onSelect = null } = {}) {
  return handle(el, (chart, { keys, rows }) => {
    const p = palette();
    const colors = colorsFor(keys);
    const labels = rows.map((r) => monthLabel(r.key));

    chart.setOption(
      {
        ...chartBase(),
        // Room at the foot for the legend *and* the axis labels. ECharts does
        // not reserve it, so a legend pinned to the bottom will sit on top of
        // the month ticks unless the grid is told to stop short.
        grid: { left: 8, right: 14, top: 10, bottom: 34, containLabel: true },
        legend: {
          type: 'scroll',
          bottom: 0,
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 14,
          icon: 'roundRect',
          textStyle: { color: p.ink2, fontSize: 11 },
          data: keys.map((k) => k.label),
        },
        tooltip: {
          ...chartBase().tooltip,
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          order: 'valueDesc',
          formatter: (items) => {
            const head = `<b>${labels[items[0].dataIndex]}</b>`;
            const body = items
              .filter((i) => i.value > 0)
              .map(
                (i) =>
                  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;` +
                  `background:${i.color};margin-inline-end:6px"></span>${i.seriesName} ` +
                  `<b>${fmt(i.value)}</b>`
              )
              .join('<br>');
            const total = items.reduce((s, i) => s + (i.value || 0), 0);
            return `${head}<br>${body}<br><span style="color:${p.ink3}">${fmt(total)} in all</span>`;
          },
        },
        xAxis: { type: 'category', data: labels, ...axisStyle(p), splitLine: { show: false } },
        yAxis: { type: 'value', ...axisStyle(p), axisLine: { show: false } },
        series: keys.map((k, i) => ({
          name: k.label,
          type: 'bar',
          stack: 'total',
          data: rows.map((r) => r.counts[i]),
          itemStyle: {
            color: colors[i],
            // 2px of surface between the segments: the separator is a gap, not
            // a drawn border.
            borderColor: p.card,
            borderWidth: 1,
            borderRadius: i === keys.length - 1 ? BAR_RADIUS : 0,
          },
          barMaxWidth: 26,
          barCategoryGap: '22%',
          emphasis: { focus: 'series' },
        })),
      },
      { notMerge: true }
    );

    if (onSelect) {
      chart.off('click');
      chart.on('click', (e) => {
        const k = keys[e.seriesIndex];
        if (k) onSelect(k.key, rows[e.dataIndex].key);
      });
    }
  });
}

/* ------------------------------------------------------------------ bars */

/**
 * A ranked horizontal bar chart. One series, one colour.
 *
 * Horizontal because the categories are names (towns, districts, enum
 * values), and a name reads along a bar instead of being rotated under one.
 */
export function bars(el, { onSelect = null, labelKey = 'label' } = {}) {
  return handle(el, (chart, groups, opts = {}) => {
    const p = palette();
    const { measure = null, unit = '', color = null } = opts;
    const data = [...groups].reverse();
    const values = data.map((d) => (measure ? d.v || 0 : d.n));
    const colors = data.map((d) => (d.none || d.other ? p.ink3 : color || p.series[0]));

    chart.setOption(
      {
        ...chartBase(),
        grid: { left: 4, right: 52, top: 4, bottom: 4, containLabel: true },
        tooltip: {
          ...chartBase().tooltip,
          trigger: 'item',
          formatter: (i) => {
            const d = data[i.dataIndex];
            const rows = [`<b>${d[labelKey]}</b>`, `${fmt(d.n)} record${d.n === 1 ? '' : 's'}`];
            if (d.v != null && measure !== true) rows.push(`${fmtMeasure(d.v, unit)} ${unit}`);
            if (d.other) rows.push(`<span style="color:${p.ink3}">folded from ${d.members.length} values</span>`);
            return rows.join('<br>');
          },
        },
        xAxis: { type: 'value', show: false },
        yAxis: {
          type: 'category',
          data: data.map((d) => d[labelKey]),
          ...axisStyle(p),
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: p.ink2, fontSize: 11, width: 150, overflow: 'truncate' },
        },
        series: [
          {
            type: 'bar',
            data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
            itemStyle: { borderRadius: BAR_RADIUS_H },
            barMaxWidth: 16,
            barCategoryGap: '34%',
            // Every bar is labelled here, which is the one place it is right:
            // the chart has no value axis, so the number at the end of the bar
            // *is* the axis.
            label: {
              show: true,
              position: 'right',
              color: p.ink2,
              fontSize: 11,
              formatter: (d) => fmtMeasure(d.value, measure ? unit : ''),
            },
            cursor: onSelect ? 'pointer' : 'default',
          },
        ],
      },
      { notMerge: true }
    );

    if (onSelect) {
      chart.off('click');
      chart.on('click', (e) => {
        const d = data[e.dataIndex];
        if (d && !d.other) onSelect(d.key, d);
      });
    }
  });
}

/* ------------------------------------------------------------------ donut */

/**
 * Part-to-whole, at a glance, for six slices at most.
 *
 * A donut is the wrong form for comparing close values, so this one carries its
 * figures in the centre and in the legend rather than asking anyone to judge an
 * angle. Past six values the caller should use `bars` instead.
 */
export function donut(el, { onSelect = null } = {}) {
  return handle(el, (chart, groups, opts = {}) => {
    const p = palette();
    const { measure = null, unit = '', centreLabel = 'records' } = opts;
    const colors = colorsFor(groups);
    const total = groups.reduce((s, d) => s + (measure ? d.v || 0 : d.n), 0);

    chart.setOption(
      {
        ...chartBase(),
        tooltip: {
          ...chartBase().tooltip,
          trigger: 'item',
          formatter: (i) => {
            const d = groups[i.dataIndex];
            const share = total ? ((measure ? d.v || 0 : d.n) / total) * 100 : 0;
            const rows = [
              `<b>${d.label}</b>`,
              `${fmt(d.n)} record${d.n === 1 ? '' : 's'} · ${share.toFixed(share < 10 ? 1 : 0)}%`,
            ];
            if (d.v != null) rows.push(`${fmtMeasure(d.v, unit)} ${unit}`);
            return rows.join('<br>');
          },
        },
        legend: {
          orient: 'vertical',
          right: 0,
          top: 'middle',
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 10,
          icon: 'roundRect',
          textStyle: { color: p.ink2, fontSize: 11 },
          formatter: (name) => {
            const d = groups.find((g) => g.label === name);
            return d ? `${name}  ${fmt(d.n)}` : name;
          },
        },
        series: [
          {
            type: 'pie',
            radius: ['56%', '80%'],
            center: ['27%', '50%'],
            avoidLabelOverlap: true,
            // A 2px ring of surface between the arcs, not a stroke round each.
            itemStyle: { borderColor: p.card, borderWidth: 2, borderRadius: 3 },
            label: {
              show: true,
              position: 'center',
              formatter: () => `{v|${fmtMeasure(total, measure ? unit : '')}}\n{l|${centreLabel}}`,
              rich: {
                v: { fontSize: 22, fontWeight: 650, color: p.ink1, lineHeight: 26 },
                l: { fontSize: 11, color: p.ink3 },
              },
            },
            emphasis: { label: { show: true }, scaleSize: 4 },
            labelLine: { show: false },
            data: groups.map((d, i) => ({
              name: d.label,
              value: measure ? d.v || 0 : d.n,
              itemStyle: { color: colors[i] },
            })),
            cursor: onSelect ? 'pointer' : 'default',
          },
        ],
      },
      { notMerge: true }
    );

    if (onSelect) {
      chart.off('click');
      chart.on('click', (e) => {
        const d = groups[e.dataIndex];
        if (d && !d.other) onSelect(d.key, d);
      });
    }
  });
}

/* ------------------------------------------------------------------ weeks */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 to 15 Mar 2026", or "1 Mar 2026" for a one-day week. */
function weekSpan(first, last) {
  const [y, m, d] = first.split('-').map(Number);
  const e = Number(last.slice(8, 10));
  const tail = `${MONTH_SHORT[m - 1]} ${y}`;
  return d === e ? `${d} ${tail}` : `${d} to ${e} ${tail}`;
}

/** A month's weeks as the statistics count them: its 1st, then every Monday. */
function weeksOf(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d) => `${month}-${String(d).padStart(2, '0')}`;
  const starts = [1];
  for (let d = 2; d <= days; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) starts.push(d);
  return starts.map((d, i) => ({ first: iso(d), last: iso((starts[i + 1] || days + 1) - 1) }));
}

function monthsFromTo(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Week by week: one row per month, one cell per week of the month.
 *
 * The site publishes records counted by week, a week cut at the turn of a
 * month so every month is exact, and this is the finest grain it holds: no
 * figure here is a day. It shows what a monthly bar hides, whether a month's
 * count came from one heavy week or from four ordinary ones. An empty week is
 * drawn too, in grey, because it is a finding. One hue, light to dark, because
 * the value is a magnitude.
 *
 * `series` is `Dataset.series(selection, { grain: 'day' })`: on the published
 * statistics that is one bucket per week, keyed by the week's first day (a
 * Monday, or the 1st of the month).
 *
 * The export is still called `calendar`, so older embeds keep working.
 */
export function calendar(el, { onSelect = null } = {}) {
  return handle(el, (chart, series, opts = {}) => {
    const p = palette();
    const { measure = null, unit = '' } = opts;
    const byKey = new Map(series.map((d) => [d.key, d]));
    const keys = series.filter((d) => (measure ? d.v : d.n)).map((d) => d.key).sort();

    if (!keys.length) {
      chart.setOption(
        {
          ...chartBase(),
          graphic: [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: { text: 'No records in view', fill: p.ink3, fontSize: 12 },
            },
          ],
        },
        { notMerge: true }
      );
      return;
    }

    const months = monthsFromTo(keys[0].slice(0, 7), keys[keys.length - 1].slice(0, 7));
    const rows = months.map(weeksOf);
    const columns = Math.max(...rows.map((r) => r.length));
    const cells = [];
    rows.forEach((weeks, y) =>
      weeks.forEach((w, x) => {
        const b = byKey.get(w.first);
        const v = b ? (measure ? b.v || 0 : b.n) : 0;
        cells.push({ x, y, v, week: w, n: b ? b.n : 0 });
      })
    );
    const positive = cells.map((d) => d.v).filter((v) => v > 0);
    const peak = Math.max(...positive);
    const low = measure ? Math.min(...positive) : 1;
    // The weeks with a figure take the ramp; an empty week is a second series
    // in grey, outside the ramp, so it reads as "none" and not as "a few".
    const full = cells.filter((d) => d.v > 0);
    const none = cells.filter((d) => !(d.v > 0));
    // Dark cells carry white figures, light cells dark ones. The ramp is
    // linear from the lowest week to the highest, its middle a strong red.
    const share = (v) => (peak > low ? (v - low) / (peak - low) : 1);
    const ink = (v) => (share(v) >= 0.42 ? '#ffffff' : p.ink1);

    chart.setOption(
      {
        ...chartBase(),
        grid: { left: 8, right: 14, top: 24, bottom: 34, containLabel: true },
        tooltip: {
          ...chartBase().tooltip,
          formatter: (i) => {
            const d = (i.seriesIndex === 0 ? full : none)[i.dataIndex];
            if (!d) return '';
            const lines = [`<b>${weekSpan(d.week.first, d.week.last)}</b>`, `${fmt(d.n)} record${d.n === 1 ? '' : 's'}`];
            if (measure && d.v) lines.push(`${fmtMeasure(d.v, unit)} ${unit}`);
            return lines.join('<br>');
          },
        },
        xAxis: {
          type: 'category',
          position: 'top',
          data: Array.from({ length: columns }, (_, i) => `Week ${i + 1}`),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.ink3, fontSize: 10 },
          splitArea: { show: false },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: months.map(monthLabel),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.ink2, fontSize: 11 },
        },
        visualMap: {
          type: 'continuous',
          seriesIndex: 0,
          min: low,
          max: Math.max(peak, low),
          orient: 'horizontal',
          right: 6,
          bottom: 0,
          itemWidth: 11,
          itemHeight: 80,
          text: [measure ? fmtMeasure(peak, unit) : fmt(peak), measure ? fmtMeasure(low, unit) : fmt(low)],
          textStyle: { color: p.ink3, fontSize: 10 },
          inRange: { color: [p.sequential[0], p.sequential[3], p.sequential[6]] },
          calculable: false,
        },
        series: [
          {
            type: 'heatmap',
            data: full.map((d) => ({
              value: [d.x, d.y, d.v],
              label: { color: ink(d.v) },
            })),
            label: {
              show: !measure,
              formatter: (d) => fmt(d.value[2]),
              fontSize: 10,
              fontWeight: 600,
            },
            itemStyle: { borderColor: p.card, borderWidth: 2, borderRadius: 3 },
            emphasis: { itemStyle: { borderColor: p.ink2, borderWidth: 1 } },
            cursor: onSelect ? 'pointer' : 'default',
          },
          {
            type: 'heatmap',
            data: none.map((d) => [d.x, d.y, 0]),
            itemStyle: { color: p.hairline, borderColor: p.card, borderWidth: 2, borderRadius: 3 },
            emphasis: { itemStyle: { borderColor: p.ink2, borderWidth: 1 } },
          },
        ],
      },
      { notMerge: true }
    );

    const needed = 24 + months.length * 30 + 44;
    if (Math.abs(el.clientHeight - needed) > 8) {
      el.style.height = `${needed}px`;
      chart.resize();
    }

    if (onSelect) {
      chart.off('click');
      chart.on('click', (e) => {
        const d = (e.seriesIndex === 0 ? full : none)[e.dataIndex];
        if (d) onSelect(d.week.first);
      });
    }
  });
}

/* ------------------------------------------------------------------ lanes */

/**
 * Several types on one time axis, as separate lanes.
 *
 * This is how the corpus's types may be shown together: side by side, each on
 * its own row with its own scale, and never stacked or added. The lanes answer
 * "what was happening at once", which is a real question; a single stacked bar
 * would answer "how many incidents in all", which this corpus cannot.
 *
 * Each lane wears its kind of record's own colour, the one it has on every
 * map and legend of the site.
 */
export function lanes(el) {
  return handle(el, (chart, series, opts = {}) => {
    const p = palette();
    const { months = [], highlight = null } = opts;
    const laneColor = (s, i) => (s.code ? typeColor(s.code) : p.series[i % 8]);
    const labels = months.map(monthLabel);
    const rows = series.length;
    const laneHeight = 54;
    const top = 8;

    chart.setOption(
      {
        ...chartBase(),
        tooltip: {
          ...chartBase().tooltip,
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: (items) => {
            const i = items[0].dataIndex;
            const body = series
              .map((s, n) => {
                const v = s.counts[i] || 0;
                if (!v) return null;
                return (
                  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;` +
                  `background:${laneColor(s, n)};margin-inline-end:6px"></span>` +
                  `${s.label} <b>${fmt(v)}</b>`
                );
              })
              .filter(Boolean);
            return (
              `<b>${labels[i]}</b><br>` +
              (body.length ? body.join('<br>') : `<span style="color:${p.ink3}">no records</span>`) +
              `<br><span style="color:${p.ink3};font-size:11px">counted apart, never added</span>`
            );
          },
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: p.axis } },
        grid: series.map((_, i) => ({
          left: 120,
          right: 56,
          top: top + i * laneHeight,
          height: laneHeight - 16,
          containLabel: false,
        })),
        xAxis: series.map((_, i) => ({
          gridIndex: i,
          type: 'category',
          data: labels,
          axisLine: { show: i === rows - 1, lineStyle: { color: p.axis } },
          axisTick: { show: false },
          axisLabel: { show: i === rows - 1, color: p.ink3, fontSize: 10, hideOverlap: true },
          splitLine: { show: false },
        })),
        yAxis: series.map((s, i) => ({
          gridIndex: i,
          type: 'value',
          // Each lane carries its own scale. That is the point: a lane with 40
          // records a month and one with 3 are both legible, and nothing about
          // the drawing invites adding them.
          max: Math.max(1, ...s.counts),
          show: false,
        })),
        series: series.map((s, i) => ({
          name: s.label,
          type: 'bar',
          xAxisIndex: i,
          yAxisIndex: i,
          data: s.counts,
          itemStyle: {
            color: highlight && highlight !== s.code ? p.hairline : laneColor(s, i),
            borderRadius: [2, 2, 0, 0],
          },
          barMaxWidth: 14,
          barCategoryGap: '26%',
        })),
        graphic: series.flatMap((s, i) => [
          {
            type: 'text',
            left: 6,
            top: top + i * laneHeight + 2,
            style: {
              text: s.label,
              fill: p.ink1,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
            },
          },
          {
            type: 'text',
            left: 6,
            top: top + i * laneHeight + 19,
            style: {
              text: `${fmt(s.total)} records · peak ${fmt(Math.max(0, ...s.counts))}/month`,
              fill: p.ink3,
              fontSize: 10,
              fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
            },
          },
        ]),
      },
      { notMerge: true }
    );

    const needed = top + rows * laneHeight + 26;
    if (Math.abs(el.clientHeight - needed) > 8) {
      el.style.height = `${needed}px`;
      chart.resize();
    }
  });
}

/* ------------------------------------------------------------------ spark */

/** A bare monthly sparkline for a card. No axes, no tooltip, no legend. */
export function spark(el) {
  return handle(el, (chart, series) => {
    const p = palette();
    chart.setOption(
      {
        animation: false,
        grid: { left: 1, right: 1, top: 3, bottom: 1 },
        xAxis: { type: 'category', show: false, data: series.map((d) => d.key) },
        yAxis: { type: 'value', show: false },
        series: [
          {
            type: 'bar',
            data: series.map((d) => d.n),
            itemStyle: { color: `${p.series[0]}cc`, borderRadius: [2, 2, 0, 0] },
            barCategoryGap: '18%',
            silent: true,
          },
        ],
      },
      { notMerge: true }
    );
  });
}
