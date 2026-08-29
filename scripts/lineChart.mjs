// 日付を横軸にした折れ線グラフを、SVGの文字列にする。
//
// 依存を足さずに描くため要素を直接組み立てる。読み手はブラウザ（GitHubと公開サイトの両方）で、
// `![](...)` から `<img>` として参照される。**スクリプトもCSSの外部参照も使えない**ので、
// 見た目は属性で書き切る。
//
// ## 1枚は「パネルの縦並び」
//
// パネルごとに独自のy軸を持ち、**横軸（日付）だけを共有する。** 桁の違う量を1つの枠へ重ねると
// 小さいほうが底に貼り付いて読めなくなるので、重ねずに段を分ける。系列を1本しか持たない
// パネルを並べれば2軸のグラフに、複数持たせれば1枚に重ねたグラフになる。
//
// ## 背景は塗る
//
// GitHubは読み手のテーマで、公開サイトは常に暗いテーマで表示する。**透明にすると、どちらかで
// 文字が背景に沈む。** 明るい背景を敷いて、その上だけで完結させる。

/** 系列の色。色覚の型によらず見分けられる並び（Okabe-Ito）から、明度の離れたものを取る。 */
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];

const WIDTH = 760;
const PLOT_HEIGHT = 190;
// 右の余白は、最後の点に付く日付ラベルの半分を収める幅。狭いとラベルが枠で切れる。
const MARGIN = { top: 34, right: 26, bottom: 14, left: 68 };
/** パネルの上に置く見出し（パネル名と凡例）の高さ。 */
const HEADER_HEIGHT = 22;
/** パネル同士の隙間。詰めると、下のパネルの見出しが上のパネルの `0` の目盛りに重なる。 */
const PANEL_GAP = 20;
/** 横軸の目盛りラベルを置く高さ（最下段のパネルの下だけに要る）。 */
const AXIS_HEIGHT = 24;

const INK = '#24292f';
const MUTED = '#6e7781';
const GRID = '#d8dee4';
const BACKGROUND = '#ffffff';

/** `&` `<` `>` だけを避ければ、属性でも本文でも安全に置ける。 */
function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 目盛りの本数の上限。これを超えない中で最も細かい刻みを選ぶ。 */
const MAX_TICKS = 5;

/**
 * 0からmax以上までを覆う、切りの良い目盛り。刻みは 1・2・2.5・5 の10のべき乗倍から選ぶ。
 *
 * **最後の目盛りは必ず max 以上**にする——ここが max を下回ると、折れ線が枠の外へはみ出す。
 */
function ticksTo(max) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(max, 1)) - 1);
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100]
    .map((factor) => factor * magnitude)
    .find((candidate) => Math.ceil(max / candidate) <= MAX_TICKS);
  const ticks = [];
  for (let value = 0; ; value += step) {
    ticks.push(value);
    if (value >= max) return ticks;
  }
}

function formatTick(value) {
  if (value >= 10000) return `${value / 1000}k`;
  return value.toLocaleString('en-US');
}

/** `YYYY-MM-DD`（日本時間の日付）を、横軸へ置くための数値にする。 */
function dayToTime(day) {
  return Date.parse(`${day}T00:00:00+09:00`);
}

/**
 * 折れ線グラフのSVG。
 *
 * @param {object} chart
 * @param {string} chart.title 図の題。図の中に書く（`![]()` の代替テキストは読み上げにしか出ない）。
 * @param {readonly string[]} chart.days 横軸の日付（`YYYY-MM-DD`）。間隔は実際の日数どおりに取る。
 * @param {readonly {label: string, series: readonly {name: string, values: readonly number[]}[]}[]} chart.panels
 */
export function lineChart({ title, days, panels }) {
  const times = days.map(dayToTime);
  const [firstTime, lastTime] = [Math.min(...times), Math.max(...times)];
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const xOf = (time) =>
    MARGIN.left + (lastTime === firstTime ? 0 : (plotWidth * (time - firstTime)) / (lastTime - firstTime));

  const panelHeight = HEADER_HEIGHT + PLOT_HEIGHT + PANEL_GAP;
  const axisY = MARGIN.top + panelHeight * panels.length - PANEL_GAP;
  const height = axisY + AXIS_HEIGHT + MARGIN.bottom;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="12">`,
    `<rect width="${WIDTH}" height="${height}" fill="${BACKGROUND}"/>`,
    `<text x="${MARGIN.left}" y="22" font-size="14" font-weight="600" fill="${INK}">${escapeText(title)}</text>`,
  ];

  let colorIndex = 0;
  panels.forEach((panel, panelIndex) => {
    const top = MARGIN.top + panelHeight * panelIndex + HEADER_HEIGHT;
    const bottom = top + PLOT_HEIGHT;
    const max = Math.max(...panel.series.flatMap((series) => series.values));
    const ticks = ticksTo(max);
    const yOf = (value) => bottom - (PLOT_HEIGHT * value) / ticks[ticks.length - 1];

    for (const tick of ticks) {
      parts.push(
        `<line x1="${MARGIN.left}" y1="${yOf(tick)}" x2="${WIDTH - MARGIN.right}" y2="${yOf(tick)}" stroke="${GRID}"/>`,
        `<text x="${MARGIN.left - 8}" y="${yOf(tick) + 4}" text-anchor="end" fill="${MUTED}">${formatTick(tick)}</text>`,
      );
    }
    parts.push(
      `<text x="${MARGIN.left}" y="${top - 8}" fill="${INK}" font-weight="600">${escapeText(panel.label)}</text>`,
    );

    // 凡例は、パネルの見出しの右へ横に並べる。線の色と名前が近いほど、目が往復しない。
    // **系列が1本のパネルには出さない**——パネルの見出しが既にその1本を名指ししている。
    const withLegend = panel.series.length > 1;
    let legendX = MARGIN.left + panel.label.length * 13 + 16;
    for (const series of panel.series) {
      const color = COLORS[colorIndex % COLORS.length];
      colorIndex += 1;
      if (withLegend) {
        parts.push(
          `<line x1="${legendX}" y1="${top - 12}" x2="${legendX + 18}" y2="${top - 12}" stroke="${color}" stroke-width="2.5"/>`,
          `<text x="${legendX + 24}" y="${top - 8}" fill="${INK}">${escapeText(series.name)}</text>`,
        );
        legendX += 24 + series.name.length * 13 + 18;
      }

      const points = series.values.map((value, index) => `${xOf(times[index])},${yOf(value)}`);
      parts.push(
        `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`,
      );
      for (const point of points) {
        const [cx, cy] = point.split(',');
        parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>`);
      }
    }
  });

  for (const [index, time] of times.entries()) {
    parts.push(
      `<text x="${xOf(time)}" y="${axisY + 16}" text-anchor="middle" fill="${MUTED}">${days[index].slice(5)}</text>`,
    );
  }

  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}
