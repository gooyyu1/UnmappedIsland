import type {
  BalanceTables,
  ChainRoute,
  NamedAmount,
  ObjectCost,
  PlaceBalance,
  PropertyRoute,
} from '../analysis/balanceTables';
import {
  MINUTES_PER_DAY,
  MINUTES_PER_TICK,
  TICKS_PER_DAY,
  WHOLE_ISLAND,
  buildBalanceTables,
  menuFor,
} from '../analysis/balanceTables';
import { CodexPage } from './CodexPage';
import type { CodexView } from './CodexView';
import { escapeHtml, inlineArtHtml } from './html';
import { objectLinkHtml } from './pages';

/**
 * 収支のページ（`#/balance`）。1ページに全部を並べ、`#/balance/<場所>` で節の頭へ送る
 * （タグ別一覧と同じ形）。
 *
 * **狭い画面で読めることを優先する。** 連鎖表は列が9つあり、経路の文字列だけで90字を超えるので、
 * 表にはせず「経路の絵 + 1日ぶん」だけの1行にして、残りは開いたときに出す。絵で経路を出せるのが
 * YAMLのスナップショット（stats/balance.yaml）に対するこちらの取り柄。
 */

/** 1日の必要量を取る代表キャラクタ（docs/world/Characters.md）。 */
const SAMPLE_CHARACTER = 'medic';

/** 収支のページ（`#/balance`、`#/balance/<場所>` でその節まで送る）。 */
export class BalancePage extends CodexPage {
  readonly route = 'balance';

  /** 最後に描いた表。献立の選び替えが、描き直さずに合計だけ計算し直すために持つ。 */
  private tables: BalanceTables | undefined;

  render(view: CodexView): string {
    this.tables = buildBalanceTables(view.codex, SAMPLE_CHARACTER);
    return renderBalancePage(view, this.tables);
  }

  override wire(): void {
    wireImportFilter();
    if (this.tables !== undefined) wireBalanceMenu(this.tables);
  }

  protected override sectionId(name: string): string {
    return balanceSectionId(name);
  }
}

function renderBalancePage(view: CodexView, tables: BalanceTables): string {
  return (
    `<div class="balance">` +
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>収支</h1>` +
    `<p class="muted">定義だけから計算した「時間あたりの収支」。時間はすべて<b>労働時間</b>で、` +
    `待ち時間（罠の周期など）は含まない。` +
    `同じ内容は <code>stats/balance.yaml</code> にも書き出される。</p>` +
    measurementMethodHtml() +
    placeIndexHtml(view, tables) +
    chainsHtml(view, tables) +
    gapsHtml(view, tables) +
    objectCostsHtml(view, tables) +
    devicesHtml(view, tables) +
    consumptionHtml(view, tables) +
    supplyHtml(view, tables) +
    `</div>`
  );
}

/** 場所の見出しに出す名前。島全体だけは型ではないので、表示名の引き当てをしない。 */
function placeLabel(view: CodexView, name: string): string {
  return name === WHOLE_ISLAND ? name : view.objectLabel(name);
}

/** 収支ページの節のid（土地の名前か、節名の定数）。 */
function balanceSectionId(section: string): string {
  return `balance-${section}`;
}

function measurementMethodHtml(): string {
  return (
    `<details class="balance-method"><summary>計測方法</summary>` +
    `<ul>` +
    `<li>1 tick = ${MINUTES_PER_TICK}分、1日 = ${TICKS_PER_DAY} tick = ${MINUTES_PER_DAY}分。</li>` +
    `<li><code>pick</code> の分岐は <code>weight</code> から期待値を取る。</li>` +
    `<li><b>1つの工程が複数の値を返す場合、時間は按分せず全額を各値に計上する。</b>` +
    `按分には水と満腹の交換レートが要るが、それこそこの表が探しているもの。` +
    `代わりに「同時に返す値」を添えた——それらを足すと二重計上になる。</li>` +
    `<li><b>道具の入手時間は単位あたりの時間に含めない。</b>「何回使うか」の仮定が数字を支配するため。` +
    `代わりに「前提」へ、1度だけ払う時間として並べる。</li>` +
    `<li><b>待ち時間は単位あたりの時間に足さない。</b>待っている間に他のことができるため。` +
    `ただし設備は待つ間も朽ちるので、1周期で使い切る割合（周期÷寿命）を製作労働の按分として計上する。</li>` +
    `<li><b>隣の物に押されて起こる作り替えも工程として数える。</b>炉は火にかけた物の加熱を進め、` +
    `刺さった傷は持ち主の血を奪う——値が range の端を割れば、生肉は焼けた肉に、獲物は死体になる。` +
    `押し手（炉・傷）は要る道具として前提に出す。炉の薪は数えていない。</li>` +
    `<li>一撃の当たり所の配分は武器が宣言するので、<b>その値を最も高く宣言している型を重ねた</b>` +
    `として読む。1本の武器では出ない配分で、仕留めの確率は実際より低く出る。</li>` +
    `<li>資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の` +
    `<b>${WHOLE_ISLAND}</b>を先頭に置く。土地の間の移動時間は数えていない。</li>` +
    `<li>† は素材を所要時間0分の工程で得ている経路（時間を数えられていない）。` +
    `前提に入手経路が無い経路は末尾へ回す。</li>` +
    `</ul></details>`
  );
}

function placeIndexHtml(view: CodexView, tables: BalanceTables): string {
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
    `<a class="chip" href="#/balance/${encodeURIComponent(GAPS_SECTION)}">入手経路なし</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(COSTS_SECTION)}">総コスト</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(DEVICES_SECTION)}">待ち生産</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(CONSUMPTION_SECTION)}">消費</a> ` +
    `<a class="chip" href="#/balance/${encodeURIComponent(SUPPLY_SECTION)}">供給</a>` +
    `</p></nav>`
  );
}

const GAPS_SECTION = '入手経路なし';
const COSTS_SECTION = '総コスト';
const DEVICES_SECTION = '待ち生産';
const CONSUMPTION_SECTION = '消費';
const SUPPLY_SECTION = '供給';

function chainsHtml(view: CodexView, tables: BalanceTables): string {
  return (
    `<h2>連鎖（素材から摂取まで）</h2>` +
    `<p class="muted">1日ぶんの必要量は ${escapeHtml(SAMPLE_CHARACTER)} のもの。` +
    `行を開くと内訳・同時に返す値・前提が出る。</p>` +
    // 他の土地で用意した材料が要っても可否は分けない（普通の遊び方なので）。ただし移動時間を
    // 数えていない以上そのぶん不利になるので、その土地だけで回るかを見たいときはここで絞る。
    `<p><label class="balance-filter">` +
    `<input type="checkbox" data-balance-import-filter> その土地だけで完結する経路だけ` +
    `</label></p>` +
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
      : `<p class="warn">この土地を起点にできない値: ` + `${escapeHtml(place.menu.unmet.join('、'))}</p>`) +
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
      const art = inlineArtHtml(view.codex.artNameOf(step.objectName));
      const label = `${view.objectLabel(step.objectName)}.${step.stepName}`;
      const body = art === '' ? escapeHtml(view.objectLabel(step.objectName)) : art;
      return `<a href="${view.objectHref(step.objectName)}" title="${escapeHtml(label)}">${body}</a>`;
    })
    .join('<span class="route-arrow">›</span>');

  return (
    `<li class="route${route.blocked ? ' route-blocked' : ''}` +
    `${route.needsImport ? ' route-import' : ''}"><details><summary>` +
    `<span class="route-icons">${icons}</span>` +
    `<span class="route-daily">${formatNumber(entry.dailyMinutes, 0)}分` +
    `<span class="muted"> / 日 ${formatNumber(entry.dailyShare, 0)}%</span></span>` +
    `</summary>` +
    `<dl class="route-detail">` +
    `<dt>1単位あたり</dt><dd>${formatNumber(entry.perUnitMinutes, 2)}分` +
    `<span class="muted">（探索 ${formatNumber(route.exploreMinutes / entry.gain, 2)} ／ ` +
    `それ以外 ${formatNumber(route.craftMinutes / entry.gain, 2)}）</span></dd>` +
    (entry.simultaneousDeviceCount === undefined
      ? ''
      : `<dt>設備</dt><dd>同時に${formatNumber(entry.simultaneousDeviceCount, 1)}個` +
        `<span class="muted">（条件が成立し続けた場合）</span>` +
        `<ul class="plain">${routeDevicesHtml(view, route)}</ul></dd>`) +
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

/**
 * 経路が待つ設備（上流から下流の順）。**数と条件を離さない**——周期を進めるのはtick毎の増減なので、
 * 条件が成立しなければ何個並べても1 tickも進まず、数だけでは「その数だけ置けば回る」としか
 * 読めない（issue #981）。周期とレートは待ち生産の節が持つ。
 */
function routeDevicesHtml(view: CodexView, route: ChainRoute): string {
  return route.devices
    .map(
      (device) =>
        `<li>${objectLinkHtml(view, device.deviceName, true)}` +
        `.<code>${escapeHtml(device.stepName)}</code> ` +
        `<span class="muted">${escapeHtml(device.condition)}</span></li>`,
    )
    .join('');
}

function prerequisitesHtml(view: CodexView, route: ChainRoute): string {
  if (route.prerequisites.length === 0) return '<span class="muted">なし</span>';
  return route.prerequisites
    .map(({ label, objectName, minutes, imported }) => {
      const shown =
        objectName === undefined
          ? escapeHtml(label)
          : `<a href="${view.objectHref(objectName)}">${inlineArtHtml(view.codex.artNameOf(objectName))}` +
            `${escapeHtml(view.objectLabel(objectName))}</a>`;
      const cost =
        minutes === undefined
          ? `<span class="warn">入手経路なし</span>`
          : `<span class="muted">${formatNumber(minutes)}分${imported ? '・他の土地で' : ''}</span>`;
      return `${shown} ${cost}`;
    })
    .join('、');
}

/**
 * 島のどこにも入手経路が無いもの。**土地の性質ではなく内容の穴**なので、土地ごとに繰り返さず
 * ここへ1度だけ出す。この一覧がそのまま、埋めるべきものになる。
 */
function gapsHtml(view: CodexView, tables: BalanceTables): string {
  if (tables.gaps.length === 0) return '';

  const items = tables.gaps
    .map(
      (gap) =>
        `<li><b>${escapeHtml(gapLabel(view, gap.label))}</b>` +
        `<span class="muted"> ${gap.blockedRoutes.length}経路を塞いでいる</span>` +
        `<ul class="plain">` +
        gap.blockedRoutes
          .map(
            (route) =>
              `<li>` +
              route.steps
                .map(
                  (step) =>
                    `<a href="${view.objectHref(step.objectName)}">` +
                    `${escapeHtml(view.objectLabel(step.objectName))}</a>` +
                    `.<code>${escapeHtml(step.stepName)}</code>`,
                )
                .join(' › ') +
              ` <span class="muted">${amountListHtml(route.deltas)}</span></li>`,
          )
          .join('') +
        `</ul></li>`,
    )
    .join('');

  return (
    `<h2 id="${balanceSectionId(GAPS_SECTION)}">島全体で入手経路が無いもの</h2>` +
    `<p class="muted">島のどこを探しても作れも見つかりもしないもの。定義の穴で、これが下の経路を` +
    `塞いでいる。土地ごとの表は可否を判定しないので、入手できないと言えるのはここだけ。</p>` +
    `<ul>${items}</ul>`
  );
}

/** 穴の見出し。型を指しているならその表示名にする（タグ指定はそのまま出す）。 */
function gapLabel(view: CodexView, label: string): string {
  return view.objectDef(label) === undefined ? label : view.objectLabel(label);
}

/**
 * オブジェクトごとの総コスト。**生存に要る値だけを見ていると、筏のような物のコストがどこにも
 * 出ない**（issue #568）。作れないものは先に挙げる——そこが定義の穴になる。
 */
function objectCostsHtml(view: CodexView, tables: BalanceTables): string {
  const missing = tables.objectCosts.filter((cost) => cost.minutes === undefined);
  const toolBlocked = tables.objectCosts.filter((cost) => cost.blockedByTool);
  const buildable = tables.objectCosts.filter((cost) => cost.minutes !== undefined);

  return (
    `<h2 id="${balanceSectionId(COSTS_SECTION)}">オブジェクトの総コスト</h2>` +
    `<p class="muted">1つ手に入れるまでの労働を、素材の採集から数えたもの。組み立ての時間だけでは` +
    `ない——筏は組むのに420分だが、材料を揃えるところから数えると桁が変わる。「日数」は生存に要る` +
    `労働を引いた残りで割った日数で、<b>目標までに何日かかるか</b>がこれで出る。</p>` +
    blockedListHtml(view, '入手経路が無いもの', missing, (cost) =>
      cost.missing.length === 0
        ? '作る工程が無い'
        : `足りない入力: ${escapeHtml(cost.missing.map((name) => gapLabel(view, name)).join('、'))}`,
    ) +
    blockedListHtml(
      view,
      '道具が無くて作れないもの',
      toolBlocked,
      (cost) =>
        `無い道具: ${escapeHtml(
          cost.prerequisites
            .filter(({ minutes }) => minutes === undefined)
            .map(({ label }) => gapLabel(view, label))
            .join('、'),
        )}`,
    ) +
    tableHtml(
      ['オブジェクト', '総労働', '探索', 'それ以外', '日数', '作り方', '前提'],
      buildable.map((cost) => [
        objectLinkHtml(view, cost.objectName, true),
        `${formatNumber(cost.minutes ?? 0)}分`,
        formatNumber(cost.exploreMinutes ?? 0),
        formatNumber(cost.craftMinutes ?? 0),
        cost.days === undefined ? '—' : `${formatNumber(cost.days, 2)}日`,
        cost.steps
          .map(
            (step) =>
              `${escapeHtml(view.objectLabel(step.objectName))}.<code>${escapeHtml(step.stepName)}</code>`,
          )
          .join(' › ') || '—',
        cost.prerequisites
          .map(
            ({ label, minutes }) =>
              `${escapeHtml(gapLabel(view, label))}` +
              (minutes === undefined
                ? ' <span class="warn">入手経路なし</span>'
                : ` <span class="muted">${formatNumber(minutes)}分</span>`),
          )
          .join('、') || '—',
      ]),
      true,
    )
  );
}

/** 作れないものの一覧。理由の出し方だけが違うので、見出しと理由を渡して共用する。 */
function blockedListHtml(
  view: CodexView,
  heading: string,
  costs: readonly ObjectCost[],
  reason: (cost: ObjectCost) => string,
): string {
  if (costs.length === 0) return '';
  return (
    `<h3>${escapeHtml(heading)}</h3>` +
    `<ul class="plain">` +
    costs
      .map(
        (cost) =>
          `<li>${objectLinkHtml(view, cost.objectName, true)} ` +
          `<span class="muted">${reason(cost)}</span></li>`,
      )
      .join('') +
    `</ul>`
  );
}

function devicesHtml(view: CodexView, tables: BalanceTables): string {
  const rows = tables.places.flatMap((place) =>
    place.devices.map((device) => [
      escapeHtml(placeLabel(view, place.name)),
      objectLinkHtml(view, device.deviceName, true),
      `<code>${escapeHtml(device.stepName)}</code>`,
      `${objectLinkHtml(view, device.productName, true)} ` +
        `<span class="muted">×${formatNumber(device.perCycle, 3)}</span>`,
      `<span class="muted">${escapeHtml(device.condition)}</span>`,
      `${formatNumber(device.periodMinutes, 0)}分`,
      formatNumber(device.perDay, 2),
      device.lifetimeProperty === undefined
        ? '—'
        : `<a href="${view.propertyHref(device.deviceName, device.lifetimeProperty)}">` +
          `${escapeHtml(view.propertyLabel(device.deviceName, device.lifetimeProperty))}</a>`,
      device.lifetimeDays === undefined ? '朽ちない' : `${formatNumber(device.lifetimeDays, 1)}日`,
      device.overLifetime === undefined ? '—' : formatNumber(device.overLifetime, 1),
      device.buildMinutes === undefined
        ? '<span class="warn">入手経路なし</span>'
        : `${formatNumber(device.buildMinutes)}分`,
      device.laborPerUnit === undefined ? '—' : formatNumber(device.laborPerUnit, 2),
    ]),
  );
  if (rows.length === 0 && tables.rainWater.length === 0) return '';

  return (
    `<h2 id="${balanceSectionId(DEVICES_SECTION)}">待ち生産</h2>` +
    `<p class="muted">仕掛けてから時間が経つと産物が返るもの。周期は単位あたりの労働に足していないので、` +
    `ここが代わりに周期とレートを出す。「生涯」は設備1つが朽ちるまでに返す総数で、これが並列度の上限。` +
    `場所で違うのは掛かる動物の重みだけなので、1つの表に並べる——` +
    `<b>その場所へ置けば働くという意味ではない。</b>周期を進めるのはtick毎の増減なので、` +
    `それがゲートで縛られていれば、条件が成立しない限り1 tickも進まない——「条件」がそれで、` +
    `<code>常時</code>は置くだけで進むもの、それ以外はゲートの中身をそのまま書き出したもの` +
    `（識別子は定義のまま）。行の数字はすべて条件が成立し続けた場合のレート。` +
    `1つの設備が周期を複数持つことがあるので、どの周期の行かは「工程」で見分ける。` +
    `「出どころ」は尽きると設備が終わるプロパティで、` +
    `その減る条件が周期の条件と別なら、「生涯」は同時には成立しない仮定の掛け算になる。</p>` +
    (rows.length === 0
      ? ''
      : tableHtml(
          [
            '場所',
            '設備',
            '工程',
            '産物',
            '条件',
            '周期',
            '個/日',
            '出どころ',
            '寿命',
            '生涯',
            '製作',
            '分/個',
          ],
          rows,
          true,
        )) +
    rainWaterHtml(view, tables)
  );
}

/**
 * 雨で溜まる水。設備ではないが、**仕掛けて待つと値が返る**点は待ち生産と同じで、しかも労働が要らない。
 * 連鎖には乗らない（工程ではないので労働0分になる）ので、量が出るのはここだけ。
 *
 * **単一の平均は出さない。** 雨季とそれ以外では降る時間が1桁違い、平均はどの季節にも存在しない
 * 中間の状態になる。読みたいのは差引の符号のほう。
 */
function rainWaterHtml(view: CodexView, tables: BalanceTables): string {
  if (tables.rainWater.length === 0) return '';

  const rows = tables.rainWater.map((row) => [
    objectLinkHtml(view, row.containerName, true),
    escapeHtml(row.seasonName),
    formatNumber(row.capacity, 0),
    formatNumber(row.rainPerDay, 0),
    formatNumber(row.evaporationPerDay, 0),
    `${row.netPerDay > 0 ? '+' : ''}${formatNumber(row.netPerDay, 0)}`,
  ]);

  return (
    `<h3>雨で溜まる水</h3>` +
    `<p class="muted">空けたまま置いた容器が1日に受ける水と失う水。降雨も蒸発も気候の実測値から。` +
    `<b>雨だけで水を賄えるのは雨季だけ</b>で、それ以外の季節は置いておくだけでは減る。` +
    `蒸発は中身がある間しか効かないので「失う水」は満杯を保った場合の上限、` +
    `容量を超えて降った分は捨てられるので差引はその損失を含まない。</p>` +
    tableHtml(['容器', '季節', '容量', '降雨', '蒸発', '差引'], rows, true)
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
    objectLinkHtml(view, row.ownerName, true),
    `<code>${escapeHtml(row.stepName)}</code>` +
      (row.kind === 'periodic' ? ' <span class="muted">periodic</span>' : ''),
    `${formatNumber(row.laborMinutes, 0)}${row.hasUnresolvedReferences ? ' <span class="warn" title="定義だけでは決まらない">?</span>' : ''}`,
    row.elapsedMinutes === row.laborMinutes ? '—' : formatNumber(row.elapsedMinutes, 0),
    row.spawns.length === 0
      ? '—'
      : row.spawns
          .map(
            ({ name, amount }) =>
              `${objectLinkHtml(view, name, true)} <span class="muted">×${formatNumber(amount, 2)}</span>`,
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
function wireBalanceMenu(tables: BalanceTables): void {
  for (const menu of document.querySelectorAll<HTMLElement>('[data-menu-place]')) {
    const place = tables.places.find((candidate) => candidate.name === menu.dataset.menuPlace);
    if (place === undefined) continue;

    const selects = [...menu.querySelectorAll<HTMLSelectElement>('select[data-menu-property]')];
    const update = (): void => {
      const chosen = new Map<number, ChainRoute>();
      for (const select of selects) {
        const dailyNeed = tables.dailyNeeds.find((r) => r.name === select.dataset.menuProperty);
        const chains = place.properties.find((c) => c.propertyName === select.dataset.menuProperty);
        if (dailyNeed === undefined || chains === undefined) continue;

        const usable = chains.routes.filter((entry) => !entry.route.untimed && !entry.route.blocked);
        // 選択の値はDOM由来なので、並びの中を指しているときだけ採る（.atは負やNaNを端の要素へ丸める）。
        const index = Number(select.value);
        const entry = index >= 0 && index < usable.length ? usable[index] : undefined;
        if (entry !== undefined) chosen.set(dailyNeed.propertyGlobalId, entry.route);
      }

      const result = menuFor(tables.dailyNeeds, chosen);
      const total = menu.querySelector<HTMLElement>('[data-menu-total]');
      const share = menu.querySelector<HTMLElement>('[data-menu-share]');
      if (total !== null) total.textContent = formatNumber(result.totalMinutes, 0);
      if (share !== null) share.textContent = formatNumber((result.totalMinutes * 100) / MINUTES_PER_DAY, 1);
    };

    for (const select of selects) select.addEventListener('change', update);
  }
}

/** 「持ち込みなしで完結する経路だけ」の絞り込み。隠すだけなので、組み立て直さずclassで切り替える。 */
function wireImportFilter(): void {
  const page = document.querySelector<HTMLElement>('.balance');
  const toggle = document.querySelector<HTMLInputElement>('[data-balance-import-filter]');
  if (page === null || toggle === null) return;

  toggle.addEventListener('change', () => {
    page.classList.toggle('hide-import', toggle.checked);
  });
}
