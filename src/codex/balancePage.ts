import type { BalanceTables, ChainRoute, NamedAmount, PlaceBalance, PropertyRoute } from './balanceTables';
import { buildBalanceTables, menuFor, MINUTES_PER_DAY, TICKS_PER_DAY, WHOLE_ISLAND } from './balanceTables';
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

/**
 * 最後に描いた表。献立の選び替え（wireBalanceMenu）が、描き直さずに合計だけ計算し直すために持つ。
 * 一覧の絞り込み（wireObjectFilter）と同じ形。
 */
let lastTables: BalanceTables | undefined;

export function renderBalancePage(view: CodexView): string {
  const tables = buildBalanceTables(view.codex, SAMPLE_CHARACTER);
  lastTables = tables;

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
    .map((chains) => {
      const counted = chains.routes.filter((entry) => !entry.route.untimed);
      const uncounted = chains.routes.filter((entry) => entry.route.untimed);
      if (counted.length === 0 && uncounted.length === 0) return '';

      return (
        `<h4>${escapeHtml(chains.propertyName)}` +
        `<span class="muted"> 1日 ${formatNumber(chains.dailyNeed, 0)}` +
        `${chains.lethal ? '・尽きると死ぬ' : ''}` +
        `${chains.suppliedByNames.length === 0 ? '' : `／${escapeHtml(chains.suppliedByNames.join('・'))}で埋まる`}` +
        `</span></h4>` +
        `<ol class="routes">${counted.map((entry) => routeHtml(view, entry)).join('')}</ol>` +
        uncountedHtml(view, uncounted)
      );
    })
    .join('');

  return (
    `<h3 id="${balanceSectionId(place.name)}">${escapeHtml(placeLabel(view, place.name))}</h3>` +
    menuHtml(view, place) +
    properties
  );
}

/**
 * 時間を数えられない経路。**既定では畳む**——0分の行を同じ並びに置くと、注記を読まない限り
 * 最安の手段に見える（雨で水が溜まるのは工程ではないので、数えられていないだけ）。
 */
function uncountedHtml(view: CodexView, entries: readonly PropertyRoute[]): string {
  if (entries.length === 0) return '';
  return (
    `<details class="uncounted"><summary>時間を数えられない経路 ${entries.length}件</summary>` +
    `<ol class="routes">${entries.map((entry) => routeHtml(view, entry)).join('')}</ol>` +
    `</details>`
  );
}

/**
 * 1日を賄う献立。既定は貪欲解で、需要ごとに経路を選び替えると合計が動く（wireBalanceMenu）。
 * 合算はブラウザ側で行うが、労働も期待値も balanceTables が出した値をそのまま使う。
 *
 * 選択肢に添える数字は**1日ぶんを賄う労働**にする。合計と同じ物差しなので「これを選ぶと1日が
 * 何分になるか」がそのまま読める——単位あたりの時間だと、需要の大きさを掛け直さないと比べられない。
 */
function menuHtml(view: CodexView, place: PlaceBalance): string {
  if (place.properties.length === 0) return '';

  const selects = place.properties
    .map((chains) => {
      const preferred = place.menu.chosen.get(chains.propertyGlobalId);
      const options = chains.routes
        .filter((entry) => !entry.route.untimed && !entry.route.blocked)
        .map((entry, index) => {
          const selected =
            preferred === undefined
              ? index === 0
                ? ' selected'
                : ''
              : entry.route === preferred
                ? ' selected'
                : '';
          return (
            `<option value="${index}"${selected}>` +
            `${escapeHtml(routeText(view, entry.route))}（${formatNumber(entry.dailyMinutes, 0)}分）` +
            `</option>`
          );
        })
        .join('');
      if (options === '') return '';
      return (
        `<label class="menu-choice"><span>${escapeHtml(chains.propertyName)}</span>` +
        `<select data-menu-property="${escapeHtml(chains.propertyName)}">${options}</select></label>`
      );
    })
    .join('');

  return (
    `<div class="menu" data-menu-place="${escapeHtml(place.name)}">` +
    `<p class="menu-total">1日を賄う最小労働: ` +
    `<b data-menu-total>${formatNumber(place.menu.totalMinutes, 0)}</b> 分` +
    `<span class="muted">（1440分の <span data-menu-share>` +
    `${formatNumber((place.menu.totalMinutes * 100) / MINUTES_PER_DAY, 1)}</span>%）</span></p>` +
    (place.menu.unmet.length === 0
      ? ''
      : `<p class="warn">賄えない値: ${escapeHtml(place.menu.unmet.join('、'))}</p>`) +
    `<div class="menu-choices">${selects}</div>` +
    `<p class="muted menu-note">括弧内は、その経路だけで1日ぶんを賄った場合の労働。` +
    `合計はここより小さくなりうる——同時に返る値が他の需要を先に埋めるため。</p>` +
    `</div>`
  );
}

function routeText(view: CodexView, route: ChainRoute): string {
  return route.steps.map((step) => view.objectLabel(step.objectName)).join(' › ');
}

function routeHtml(view: CodexView, entry: PropertyRoute): string {
  const { route } = entry;
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
    `<span class="route-daily">${formatNumber(entry.dailyMinutes, 0)}分` +
    `<span class="muted"> / 日 ${formatNumber(entry.dailyShare, 0)}%</span></span>` +
    `</summary>` +
    `<dl class="route-detail">` +
    `<dt>1単位あたり</dt><dd>${formatNumber(entry.perUnitMinutes, 2)}分` +
    `<span class="muted">（探索 ${formatNumber(route.exploreMinutes / entry.gain, 2)} ／ ` +
    `それ以外 ${formatNumber(route.craftMinutes / entry.gain, 2)}）</span></dd>` +
    (entry.deviceCount === undefined ? '' : `<dt>設備数</dt><dd>${formatNumber(entry.deviceCount, 1)}</dd>`) +
    `<dt>1回で返る値</dt><dd>${amountListHtml(route.deltas)}</dd>` +
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

/**
 * 献立の選び替え。合計の計算は balanceTables の menuFor に委ね、ここは選択を集めて表示を差し替える
 * だけにする（同じ数字を2箇所で計算しない）。
 */
export function wireBalanceMenu(): void {
  const tables = lastTables;
  if (tables === undefined) return;

  for (const menu of document.querySelectorAll<HTMLElement>('[data-menu-place]')) {
    const place = tables.places.find((candidate) => candidate.name === menu.dataset.menuPlace);
    if (place === undefined) continue;

    const selects = [...menu.querySelectorAll<HTMLSelectElement>('select[data-menu-property]')];
    const update = (): void => {
      const chosen = new Map<number, ChainRoute>();
      for (const select of selects) {
        const requirement = tables.requirements.find((r) => r.name === select.dataset.menuProperty);
        const chains = place.properties.find((c) => c.propertyName === select.dataset.menuProperty);
        if (requirement === undefined || chains === undefined) continue;

        const usable = chains.routes.filter((entry) => !entry.route.untimed && !entry.route.blocked);
        const entry = usable[Number(select.value)];
        if (entry !== undefined) chosen.set(requirement.propertyGlobalId, entry.route);
      }

      const result = menuFor(tables.requirements, chosen);
      const total = menu.querySelector<HTMLElement>('[data-menu-total]');
      const share = menu.querySelector<HTMLElement>('[data-menu-share]');
      if (total !== null) total.textContent = formatNumber(result.totalMinutes, 0);
      if (share !== null) share.textContent = formatNumber((result.totalMinutes * 100) / MINUTES_PER_DAY, 1);
    };

    for (const select of selects) select.addEventListener('change', update);
  }
}
