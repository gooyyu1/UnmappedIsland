import type { BalanceTables, ChainRoute, NamedAmount, PlaceBalance } from './balanceTables';
import { buildBalanceTables, MINUTES_PER_DAY, TICKS_PER_DAY, WHOLE_ISLAND } from './balanceTables';
import type { CodexView } from './CodexView';
import { escapeHtml, inlineArtHtml } from './CodexView';

/**
 * 収支のページ（`#/balance`）。1ページに全部を並べ、`#/balance/<場所>` で節の頭へ送る
 * （タグ別一覧と同じ形）。
 *
 * **狭い画面で読めることを優先する。** 連鎖表は列が9つあり、経路の文字列だけで90字を超えるので、
 * 表にはせず「経路の絵 + 1日ぶん」だけの1行にして、残りは開いたときに出す。絵で経路を出せるのが
 * Markdownのスナップショットに対するこちらの取り柄（docs/diagnostics/BalanceStats.md）。
 */

/** 1日の必要量を取る代表キャラクタ（docs/world/Characters.md）。 */
const SAMPLE_CHARACTER = 'medic';

export function renderBalancePage(view: CodexView): string {
  const tables = buildBalanceTables(view.codex, SAMPLE_CHARACTER);

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>収支</h1>` +
    `<p class="muted">定義だけから計算した「時間あたりの収支」。時間はすべて<b>労働時間</b>で、` +
    `待ち時間（罠の周期など）は含まない。` +
    `同じ内容は <code>docs/diagnostics/BalanceStats.md</code> にも書き出される。</p>` +
    methodHtml() +
    indexHtml(view, tables) +
    chainsHtml(view, tables) +
    devicesHtml(view, tables) +
    consumptionHtml(view, tables) +
    supplyHtml(view, tables)
  );
}

/** 場所の見出しに出す名前。島全体だけは型ではないので、表示名の引き当てをしない。 */
function placeLabel(view: CodexView, name: string): string {
  return name === WHOLE_ISLAND ? name : view.objectLabel(name);
}

/** 場所の節のid（main.tsが`#/balance/<場所>`で使う）。 */
export function balanceSectionId(place: string): string {
  return `balance-${place}`;
}

function methodHtml(): string {
  return (
    `<details class="balance-method"><summary>計測方法</summary>` +
    `<ul>` +
    `<li>1 tick = 15分、1日 = ${TICKS_PER_DAY} tick = ${MINUTES_PER_DAY}分。</li>` +
    `<li><code>pick</code> の分岐は <code>weight</code> から期待値を取る。</li>` +
    `<li><b>1つの工程が複数の値を返す場合、時間は按分せず全額を各値に計上する。</b>` +
    `按分には水と満腹の交換レートが要るが、それこそこの表が探しているもの。` +
    `代わりに「同時に返す値」を添えた——それらを足すと二重計上になる。</li>` +
    `<li><b>道具の入手時間は単位あたりの時間に含めない。</b>「何回使うか」の仮定が数字を支配するため。` +
    `代わりに「前提」へ、1度だけ払う時間として並べる。</li>` +
    `<li><b>待ち時間は単位あたりの時間に足さない。</b>待っている間に他のことができるため。` +
    `ただし設備は待つ間も朽ちるので、1周期で使い切る割合（周期÷寿命）を製作労働の按分として計上する。</li>` +
    `<li>資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の` +
    `<b>${WHOLE_ISLAND}</b>を先頭に置く。土地の間の移動時間は数えていない。</li>` +
    `<li>† は素材を所要時間0分の工程で得ている経路（時間を数えられていない）。` +
    `前提に入手経路が無い経路は末尾へ回す。</li>` +
    `</ul></details>`
  );
}

function indexHtml(view: CodexView, tables: BalanceTables): string {
  const places = tables.places
    .filter((place) => place.properties.length > 0)
    .map(
      (place) =>
        `<a class="chip" href="#/balance/${encodeURIComponent(place.name)}">` +
        `${escapeHtml(placeLabel(view, place.name))}</a>`,
    )
    .join(' ');

  return (
    `<nav class="balance-index">` +
    `<p><b>連鎖</b> ${places}</p>` +
    `<p>` +
    `<a class="chip" href="#/balance/${encodeURIComponent(DEVICES_SECTION)}">待ち生産</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(CONSUMPTION_SECTION)}">消費</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(SUPPLY_SECTION)}">供給</a>` +
    `</p></nav>`
  );
}

const DEVICES_SECTION = '待ち生産';
const CONSUMPTION_SECTION = '消費';
const SUPPLY_SECTION = '供給';

function chainsHtml(view: CodexView, tables: BalanceTables): string {
  return (
    `<h2>連鎖（素材から摂取まで）</h2>` +
    `<p class="muted">1日ぶんの必要量は ${escapeHtml(SAMPLE_CHARACTER)} のもの。` +
    `行を開くと内訳・同時に返す値・前提が出る。</p>` +
    tables.places
      .filter((place) => place.properties.length > 0)
      .map((place) => placeHtml(view, place))
      .join('')
  );
}

function placeHtml(view: CodexView, place: PlaceBalance): string {
  const properties = place.properties
    .map(
      (chains) =>
        `<h4>${escapeHtml(chains.propertyName)}` +
        `<span class="muted"> 1日 ${formatNumber(chains.dailyNeed, 0)}</span></h4>` +
        `<ol class="routes">` +
        chains.routes.map((route) => routeHtml(view, route, chains.dailyNeed)).join('') +
        `</ol>`,
    )
    .join('');

  return `<h3 id="${balanceSectionId(place.name)}">${escapeHtml(placeLabel(view, place.name))}</h3>${properties}`;
}

function routeHtml(view: CodexView, route: ChainRoute, dailyNeed: number): string {
  const daily = route.perUnitMinutes * dailyNeed;
  const share = (daily * 100) / MINUTES_PER_DAY;

  const icons = route.steps
    .map((step) => {
      const art = inlineArtHtml(step.objectName);
      const label = `${view.objectLabel(step.objectName)}.${step.stepName}`;
      const body = art === '' ? escapeHtml(view.objectLabel(step.objectName)) : art;
      return `<a href="${view.objectHref(step.objectName)}" title="${escapeHtml(label)}">${body}</a>`;
    })
    .join('<span class="route-arrow">›</span>');

  return (
    `<li class="route${route.blocked ? ' route-blocked' : ''}"><details><summary>` +
    `<span class="route-icons">${icons}</span>` +
    `<span class="route-daily">${formatNumber(daily, 0)}分${route.untimed ? ' †' : ''}` +
    `<span class="muted"> / 日 ${formatNumber(share, 0)}%</span></span>` +
    `</summary>` +
    `<dl class="route-detail">` +
    `<dt>1単位あたり</dt><dd>${formatNumber(route.perUnitMinutes, 2)}分` +
    `<span class="muted">（探索 ${formatNumber(route.exploreMinutes, 2)} ／ ` +
    `加工 ${formatNumber(route.craftMinutes, 2)}）</span></dd>` +
    (route.deviceCount === undefined ? '' : `<dt>設備数</dt><dd>${formatNumber(route.deviceCount, 1)}</dd>`) +
    `<dt>同時に返す値</dt><dd>${amountListHtml(route.coProducts)}</dd>` +
    `<dt>前提</dt><dd>${prerequisitesHtml(view, route)}</dd>` +
    `<dt>工程</dt><dd class="route-steps">` +
    route.steps
      .map(
        (step) =>
          `${escapeHtml(view.objectLabel(step.objectName))}.<code>${escapeHtml(step.stepName)}</code>`,
      )
      .join(' › ') +
    `</dd></dl></details></li>`
  );
}

function prerequisitesHtml(view: CodexView, route: ChainRoute): string {
  if (route.prerequisites.length === 0) return '<span class="muted">なし</span>';
  return route.prerequisites
    .map(({ label, objectName, minutes }) => {
      const shown =
        objectName === undefined
          ? escapeHtml(label)
          : `<a href="${view.objectHref(objectName)}">${inlineArtHtml(objectName)}` +
            `${escapeHtml(view.objectLabel(objectName))}</a>`;
      const cost =
        minutes === undefined
          ? `<span class="warn">入手経路なし</span>`
          : `<span class="muted">${formatNumber(minutes)}分</span>`;
      return `${shown} ${cost}`;
    })
    .join('、');
}

function devicesHtml(view: CodexView, tables: BalanceTables): string {
  const rows = tables.places.flatMap((place) =>
    place.devices.map((device) => [
      escapeHtml(placeLabel(view, place.name)),
      objectLinkHtml(view, device.deviceName),
      `${objectLinkHtml(view, device.productName)} ` +
        `<span class="muted">×${formatNumber(device.perCycle, 3)}</span>`,
      `${formatNumber(device.periodMinutes, 0)}分`,
      formatNumber(device.perDay, 2),
      device.lifetimeDays === undefined ? '朽ちない' : `${formatNumber(device.lifetimeDays, 1)}日`,
      device.overLifetime === undefined ? '—' : formatNumber(device.overLifetime, 1),
      device.buildMinutes === undefined
        ? '<span class="warn">入手経路なし</span>'
        : `${formatNumber(device.buildMinutes)}分`,
      device.laborPerUnit === undefined ? '—' : formatNumber(device.laborPerUnit, 2),
    ]),
  );
  if (rows.length === 0) return '';

  return (
    `<h2 id="${balanceSectionId(DEVICES_SECTION)}">待ち生産</h2>` +
    `<p class="muted">仕掛けてから時間が経つと産物が返るもの。周期は単位あたりの労働に足していないので、` +
    `ここが代わりに周期とレートを出す。「生涯」は設備1つが朽ちるまでに返す総数で、これが並列度の上限。` +
    `場所で違うのは掛かる動物の重みだけなので、1つの表に並べる。</p>` +
    tableHtml(['場所', '設備', '産物', '周期', '個/日', '寿命', '生涯', '製作', '分/個'], rows, true)
  );
}

function consumptionHtml(view: CodexView, tables: BalanceTables): string {
  const rows = tables.consumption.map((row) => [
    escapeHtml(row.propertyName),
    `<span class="muted">${escapeHtml(row.condition)}</span>`,
    ...row.perTickByCharacter.map((amount) =>
      amount === undefined
        ? '—'
        : `${formatNumber(amount, 2)}<span class="muted"> / 日 ${formatNumber(amount * TICKS_PER_DAY, 0)}</span>`,
    ),
  ]);

  return (
    `<h2 id="${balanceSectionId(CONSUMPTION_SECTION)}">消費</h2>` +
    `<p class="muted">キャラクタが自分のプロパティをtick毎にどれだけ動かすか。` +
    `<b>連鎖の「1日 N」の出どころ</b>で、個体差はそのまま列に出る。</p>` +
    tableHtml(
      ['プロパティ', '条件', ...tables.characterNames.map((name) => escapeHtml(view.objectLabel(name)))],
      rows,
      true,
    )
  );
}

function supplyHtml(view: CodexView, tables: BalanceTables): string {
  const rows = tables.supply.map((row) => [
    objectLinkHtml(view, row.ownerName),
    `<code>${escapeHtml(row.stepName)}</code>` +
      (row.kind === 'periodic' ? ' <span class="muted">periodic</span>' : ''),
    `${formatNumber(row.laborMinutes, 0)}${row.unresolved ? ' <span class="warn" title="定義だけでは決まらない">?</span>' : ''}`,
    row.elapsedMinutes === row.laborMinutes ? '—' : formatNumber(row.elapsedMinutes, 0),
    row.spawns.length === 0
      ? '—'
      : row.spawns
          .map(
            ({ name, amount }) =>
              `${objectLinkHtml(view, name)} <span class="muted">×${formatNumber(amount, 2)}</span>`,
          )
          .join(' '),
    [amountListHtml(row.actorDeltas), amountListHtml(row.selfDeltas, 'self')]
      .filter((text) => text !== '—')
      .join('、') || '—',
  ]);

  return (
    `<h2 id="${balanceSectionId(SUPPLY_SECTION)}">供給</h2>` +
    `<p class="muted">何かを生むか、値を動かす工程すべて。産出は1回あたりの期待個数。` +
    `同じ宣言は各オブジェクトのページにもあるので、ここは横断して見比べるための一覧。</p>` +
    tableHtml(['宣言元', '工程', '労働', '周期', '期待産出', '値の増減'], rows)
  );
}

function objectLinkHtml(view: CodexView, objectName: string): string {
  return (
    `<a href="${view.objectHref(objectName)}">${inlineArtHtml(objectName)}` +
    `${escapeHtml(view.objectLabel(objectName))}</a>`
  );
}

function amountListHtml(amounts: readonly NamedAmount[], prefix?: string): string {
  if (amounts.length === 0) return '—';
  return amounts
    .map(
      ({ name, amount }) =>
        `${prefix === undefined ? '' : `<span class="muted">${prefix}.</span>`}` +
        `${escapeHtml(name)} ${signed(amount)}`,
    )
    .join('、');
}

/**
 * 表。nowrapは、数値が並ぶ表で折り返しを止めて横スクロールへ送る指定——狭い画面では、
 * 折り返すと列が1文字ぶんまで潰れて縦書きになる。
 */
function tableHtml(headers: readonly string[], rows: readonly (readonly string[])[], nowrap = false): string {
  return (
    `<div class="table-scroll${nowrap ? ' nowrap' : ''}"><table><thead><tr>` +
    headers.map((header) => `<th>${header}</th>`).join('') +
    `</tr></thead><tbody>` +
    rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('') +
    `</tbody></table></div>`
  );
}

function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = value.toFixed(digits);
  return rounded === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : rounded;
}

function signed(amount: number): string {
  return `${amount >= 0 ? '+' : ''}${formatNumber(amount, 2)}`;
}
