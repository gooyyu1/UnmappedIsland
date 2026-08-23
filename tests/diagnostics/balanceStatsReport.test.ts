import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type {
  BalanceTables,
  ChainRoute,
  NamedAmount,
  PlaceBalance,
  PropertyChains,
  PropertyRoute,
  RoutePrerequisite,
  RouteStep,
} from '../../src/analysis/balanceTables';
import {
  buildBalanceTables,
  MINUTES_PER_DAY,
  MINUTES_PER_TICK,
  TICKS_PER_DAY,
  WHOLE_ISLAND,
} from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義から計算した収支表（`src/analysis/balanceTables.ts`）を`docs/diagnostics/BalanceStats.md`へ書き出す。
 *
 * 同じ表はコーデックスビューア（`src/codex-viewer/balancePage.ts`）でも見られる。**Markdownを残すのは
 * 差分のため**——数値を触ったときに何がどう動いたかは`git diff`でしか読めず、ビューアはその瞬間の
 * 姿しか見せられない。
 *
 * 通常のテストスイート（`npm test`）には含めない: 合否判定を目的とした回帰テストではなく、
 * 数値を触るたびに差分で影響を見るための再計算が目的のため、`RUN_BALANCE_STATS`環境変数が
 * 立っているときだけ実行する。定義の数値を変えた後に再生成する: `npm run stats:balance`
 */

function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = value.toFixed(digits);
  return rounded === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : rounded;
}

function signed(amount: number): string {
  return `${amount >= 0 ? '+' : ''}${formatNumber(amount, 2)}`;
}

function amountList(amounts: readonly NamedAmount[]): string {
  return amounts.map(({ name, amount }) => `${name} ${signed(amount)}`).join('、');
}

function routeText(route: ChainRoute): string {
  return stepsText(route.steps);
}

function prerequisiteText({ label, minutes, imported }: RoutePrerequisite): string {
  if (minutes === undefined) return `${label}（入手経路なし）`;
  return `${label}（${formatNumber(minutes)}分${imported ? '・他の土地で' : ''}）`;
}

function stepsText(steps: readonly RouteStep[]): string {
  return steps.map((step) => `${step.objectName}.${step.stepName}`).join(' → ');
}

function buildReport(tables: BalanceTables): string {
  const lines: string[] = [];
  const append = (line = ''): void => {
    lines.push(line);
  };

  append('# アイテム収支レポート');
  append();
  append('`tests/diagnostics/balanceStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）');
  append('だけから計算した「時間あたりの収支」。定義の数値を変えたら以下で再生成する。');
  append();
  append('```');
  append('npm run stats:balance');
  append('```');
  append();
  append('同じ表はコーデックスビューアの「収支」ページでも見られる（アイコンつき）。');
  append();

  appendMethod(append);
  appendChains(append, tables);
  appendObjectCosts(append, tables);
  appendDevices(append, tables);
  appendConsumption(append, tables);
  appendSupply(append, tables);

  return lines.join('\n') + '\n';
}

function appendMethod(append: (line?: string) => void): void {
  append('## 計測方法');
  append();
  append(`- 1 tick = ${MINUTES_PER_TICK}分、1日 = ${TICKS_PER_DAY} tick = ${MINUTES_PER_DAY}分。`);
  append('- `pick` の分岐は `weight` から期待値を取る。入れ子の `pick` は確率の積まで畳んである。');
  append('- **1つの工程が複数の値を返す場合、所要時間は按分せず全額を各値に計上する。** 按分には');
  append('  水と満腹の交換レートが要るが、そのレートこそこの表が見つけようとしているもの。');
  append('  代わりに「同時に返す値」を添えた——それらを縦に足すと二重計上になる。');
  append('- **道具（消費されない入力）の入手時間は単位あたりの時間に含めない。** 繰り返し使えるものを');
  append('  1個あたりへ按分するには「何回使うか」の仮定が要り、その仮定が数字を支配するため。');
  append('  代わりに「前提」へ、1度だけ払う入手時間として別に並べる。');
  append('- 連鎖の起点は探索。土地ごとに得られる物が違うので、連鎖表は土地ごとに出す。');
  append('  ただし資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の');
  append(`  **${WHOLE_ISLAND}**を先頭に置く——各資源を最も得やすい土地で得て、移動時間は数えない場合。`);
  append();
  append('### 待って得る生産の数え方');
  append();
  append('罠のように、仕掛けてから時間が経つと産物が返るものは、**待っている間に他のことができる**。');
  append('そこで工程の時間を2本に分けて数える。');
  append();
  append('- **労働時間**: プレイヤーが払う分。他の行動と直接競合するのはこれだけで、');
  append('  各表の「分」はすべてこちら。');
  append('- **周期**: 経過するだけの分。単位あたりの時間には**足さない**。');
  append();
  append('では待ち時間が無コストかというと、そうではない。**設備は待っている間も朽ちる**ので、');
  append('1周期で使い切る設備の割合（周期 ÷ 寿命）が、そのまま製作労働の按分になる——罠1回の判定は');
  append('「罠を作る労働の、周期÷寿命ぶん」を払っている。連鎖表の数字はこの按分を含む。');
  append();
  append('この数え方が成り立つのは**並列度に上限があるとき**だけ。いくらでも並べられて朽ちもしない');
  append('設備は、待つだけで無限に得られることになるので按分できず、連鎖表から外して待ち生産表へ回す。');
  append();
  append('### 隣の物に押されて起こる作り替え');
  append();
  append('焼くのも失血死も、**自分では動かない値を隣の物が動かす**。炉は火にかけた物の');
  append('`cooking_progress` を進め（`add: {child: ...}`）、刺さった傷は持ち主の `blood` を奪う');
  append('（`add: {parent: ...}`）。値が range の端へ届いた瞬間に、その型自身の `on_max`/');
  append('`on_min` が生肉を焼けた肉へ、獲物を死体へ置き換える。');
  append();
  append('どちらも「1回で終わる待ち生産」なので、労働0・経過時間ありの工程として連鎖表に載せ、');
  append('押し手（炉・傷）は**要る道具**として前提の列に出す。誰が誰の隣に立てるかは、枠の');
  append('`accept` だけで判断する——炉の火の枠が `roastable` を受けるから、そこへ入る物は焼ける。');
  append();
  append('**押し手が止まるまでに動かせる総量**も数える。出血は傷の `bleeding` が尽きれば止まるので、');
  append('罠の傷（-15/tick × 2 tick = 30mL）ではネズミ（血6mL）は死ぬがヤケイ（80mL）は死なない。');
  append('届かない組み合わせはその工程を立てない。');
  append();
  append('一撃で端まで押す効果も同じ引き金を引く。仕留めの一撃（`set: {self: {blood: 0}}`）は');
  append('血を空にするだけで、死体を生むのは `blood` の `on_min` ——工程の結果にこれを');
  append('畳まないと、イノシシの死体（血4,600mLで失血死には届かない）の作り方がどこにも無くなる。');
  append('確率でしか消えない入力は、**その確率ぶんだけ**消費されるものとして数える（21回に1回');
  append('しか仕留められないなら、1回の実行に要る獲物は0.048匹）。');
  append();
  append('### この表が数えていないもの');
  append();
  append('- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。');
  append('  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。');
  append('- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは');
  append('  宣言値だけなので、罠のレートは**餌なし**の値。');
  append('- **雨で溜まる水を汲む労働。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、');
  append('  工程ではない。そのため水を汲む経路は労働0分になる——1節の「数えられない経路」へ分けて');
  append('  ある。溜まる量そのものは3節に出す（労働ではなく、季節ごとの mL/日）。');
  append('- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。');
  append('- **炉の薪。** 焼くには火を保たなければならないが、そのぶんの薪は数えていない。炉は');
  append('  前提（道具）としてだけ出る。');
  append('- **どの武器を重ねたか。** 一撃の当たり所の配分は武器が宣言する（`{subject: dragged}` の');
  append('  重み）ので、重ねる相手を決めないと配分が決まらない。ここでは**その値を最も高く宣言して');
  append('  いる型を重ねた**として読むため、配分は「分岐ごとに最も良い武器を選べる場合」のものになる');
  append('  ——1本の武器では出ない配分で、仕留めの確率は実際より低く出る。');
  append();
  append('### 何を「1日に要る量」と数えるか');
  append();
  append('**輸送で減る値は需要にしない。** `carbohydrate`/`protein`/`lipid` はtick毎に体脂肪へ流れるが、');
  append('あの速さ（合計3.5/tick）は在庫がある間の流量であって、要る量ではない。体が実際に燃やすのは');
  append('受け皿側の `body_fat` の減りだけで、三大栄養素はそこへ注ぐ原資（DigestionSystem.md 3節）。');
  append('流量を要求量として数えると、必要な3.5倍を食べさせることになる。');
  append();
  append('**段で減る速さが変わる値は、初期値が入る段の速さを採る。** 体脂肪は段ごとに -0.5〜-1.6/tick と');
  append('違うので、全部を足すとどの段にも当てはまらない量になる。');
  append();
  append('`satiety` は胃のかさであってエネルギーではない（同2節）。尽きても死なず、食べれば同時に');
  append('埋まるので、献立では他の値を賄うついでに満たされることが多い。');
  append();
}

function appendChains(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 1. 連鎖表（素材から摂取までの総時間）');
  append();
  append(`1日ぶんの必要量は ${SAMPLE_CHARACTER} のもの（消費表から）。`);
  append('時間はすべて労働時間で、待ち時間は含まない（待ち生産の設備は、周期÷寿命ぶんの製作労働と');
  append('して計上する）。「1日の割合」は、1日ぶんを賄うのに要る労働が1日（1440分）に占める割合。');
  append('「設備数」は、待ち生産の経路で1日ぶんを賄うのに同時に要る設備の数。');
  append();
  append('**土地ごとの表は可否を判定しない。** 答えるのは「この土地を起点にすると単位あたり何分か」');
  append('だけで、ある経路が載らないのはできないからではなく**その表の対象ではない**から。');
  append('入手できるかどうかは島全体でだけ判定し、島のどこにも経路が無いものは末尾の');
  append('「島全体で入手経路が無いもの」へまとめる。');
  append();
  append('**‡ は、他の土地で用意した材料・道具が要る経路。** AとBの土地で集めた物を合わせて作るのは');
  append('普通の遊び方なので可否は分けないが、土地の間の移動時間を数えていない以上、‡ の付いた経路は');
  append('実際にはこの表より不利になる。');
  append();
  append('**時間を数えられない経路（労働0で値が返るもの）はこの表に混ぜず、末尾の「数えられない経路」');
  append('へ分けた。** 注記は読み飛ばされるが順位は読み飛ばされないので、0分の行を最安として');
  append('並べると「水はタダ」と読めてしまう。');
  append();

  for (const place of tables.places) {
    if (place.properties.length === 0) continue;

    append(`### ${place.name}`);
    append();
    appendMenu(append, place);

    for (const chains of place.properties) {
      const counted = chains.routes.filter((entry) => !entry.route.untimed);
      if (counted.length === 0) continue;

      append(`#### ${headingOf(chains)}`);
      append();
      append(
        '| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |',
      );
      append('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const entry of counted) append(chainRow(entry));
      append();
    }
  }

  appendUncounted(append, tables);
  appendGaps(append, tables);
}

/**
 * 島のどこにも入手経路が無いもの。**土地の性質ではなく内容の穴**なので、土地ごとに繰り返さず
 * ここへ1度だけ出す。この一覧がそのまま、埋めるべきものになる。
 */
function appendGaps(append: (line?: string) => void, tables: BalanceTables): void {
  if (tables.gaps.length === 0) return;

  append('### 島全体で入手経路が無いもの');
  append();
  append('島のどこを探しても作れも見つかりもしないもの。定義の穴で、これが下の経路を塞いでいる。');
  append();
  for (const gap of tables.gaps) {
    append(`- **${gap.label}** — ${gap.blockedRoutes.length}経路を塞いでいる`);
    for (const route of gap.blockedRoutes)
      append(`  - \`${stepsText(route.steps)}\`（${amountList(route.deltas) || '—'}）`);
  }
  append();
}

/** 需要の見出し。何で埋まるか（体脂肪なら三大栄養素）と、尽きると死ぬかを添える。 */
function headingOf(chains: PropertyChains): string {
  const supplied =
    chains.suppliedByNames.length === 0 ? '' : `／${chains.suppliedByNames.join('・')}で埋まる`;
  return (
    `${chains.propertyName}（1日 ${formatNumber(chains.dailyNeed, 0)}` +
    `${chains.lethal ? '・尽きると死ぬ' : ''}${supplied}）`
  );
}

function chainRow(entry: PropertyRoute): string {
  const prerequisites = entry.route.prerequisites.map(prerequisiteText).join('、');

  return (
    `| ${routeText(entry.route)}${entry.route.needsImport ? ' ‡' : ''} | ${formatNumber(entry.perUnitMinutes, 2)} |` +
    ` ${formatNumber(entry.route.exploreMinutes / entry.gain, 2)} |` +
    ` ${formatNumber(entry.route.craftMinutes / entry.gain, 2)} |` +
    ` ${formatNumber(entry.dailyMinutes, 0)} | ${formatNumber(entry.dailyShare, 1)}% |` +
    ` ${entry.simultaneousDeviceCount === undefined ? '—' : formatNumber(entry.simultaneousDeviceCount, 1)} |` +
    ` ${amountList(entry.route.deltas) || '—'} | ${prerequisites || '—'} |`
  );
}

/**
 * 1日を賄う最小労働（貪欲解）。**この数字がこのレポートで最も追いたいもの**なので、
 * 差分で動きが見えるように献立ごと出す。
 */
function appendMenu(append: (line?: string) => void, place: PlaceBalance): void {
  const { menu } = place;
  if (menu.entries.length === 0 && menu.unmet.length === 0) return;

  append(
    `> **1日を賄う最小労働: ${formatNumber(menu.totalMinutes, 0)} 分**` +
      `（1440分の ${formatNumber((menu.totalMinutes * 100) / MINUTES_PER_DAY, 1)}%）`,
  );
  if (menu.unmet.length > 0)
    append(`> この土地を起点にできない値: ${menu.unmet.join('、')}（島全体の節を参照）`);
  append();

  if (menu.entries.length === 0) return;
  append('| 献立 | 回数 | 労働（分） |');
  append('| --- | --- | --- |');
  for (const entry of menu.entries)
    append(
      `| ${routeText(entry.route)} | ${formatNumber(entry.repetitions, 2)} |` +
        ` ${formatNumber(entry.minutes, 0)} |`,
    );
  append();
}

/**
 * 時間を数えられない経路。**別の節にする**——同じ並びに0分として混ぜると、注記を読まない限り
 * 最安の手段に見える。
 */
function appendUncounted(append: (line?: string) => void, tables: BalanceTables): void {
  const rows: string[] = [];
  for (const place of tables.places)
    for (const chains of place.properties)
      for (const entry of chains.routes)
        if (entry.route.untimed)
          rows.push(
            `| ${place.name} | ${chains.propertyName} | ${routeText(entry.route)} |` +
              ` ${amountList(entry.route.deltas) || '—'} |`,
          );
  if (rows.length === 0) return;

  append('### 数えられない経路');
  append();
  append('労働0で値が返る経路。**上の表には混ぜていない**——時間を数えられていないだけで、');
  append('本当にタダなわけではない（雨で水が溜まるのはtick毎の持続効果で、工程ではない）。');
  append();
  append('| 場所 | 値 | 経路 | 同時に返す値 |');
  append('| --- | --- | --- | --- |');
  for (const row of rows) append(row);
  append();
}

/**
 * オブジェクトごとの総コスト。**生存に要る値だけを見ていると、筏のような物のコストがどこにも
 * 出ない**（issue #568）。入手経路が無いものは先に挙げる——そこが定義の穴になる。
 */
function appendObjectCosts(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 2. オブジェクトの総コスト');
  append();
  append('1つ手に入れるまでの労働を、素材の採集から数えたもの。組み立ての時間だけではない');
  append('——筏は組むのに420分だが、丸太と縄を揃えるところから数えると桁が変わる。');
  append();
  append('「日数」は、生存に要る労働を引いた残り（1日の余剰時間）で割った日数。**目標までに');
  append('何日かかるか**がこれで出る。道具（前提）の時間は総コストに含めない（#550のまま）。');
  append();
  append('土地・キャラクタ・単独で存在できない物（怪我・道）・製作中オブジェクト・軸の値の型');
  append('（液体の種類。世界に現れるのは中身入りの容器という変種のほうで、`water_liquid` そのものの');
  append('インスタンスは作られない）は、手に入れるという言い方が成り立たないので対象外。');
  append();

  const missing = tables.objectCosts.filter((cost) => cost.minutes === undefined);
  if (missing.length > 0) {
    append('### 入手経路が無いもの');
    append();
    append('島のどこにも作り方も見つけ方も無い。**足りない入力**まで出すので、そのまま埋めるべき穴になる。');
    append();
    append('| オブジェクト | 足りない入力 |');
    append('| --- | --- |');
    for (const cost of missing)
      append(`| ${cost.objectName} | ${cost.missing.join('、') || '作る工程が無い'} |`);
    append();
  }

  const toolBlocked = tables.objectCosts.filter((cost) => cost.blockedByTool);
  if (toolBlocked.length > 0) {
    append('### 道具が無くて作れないもの');
    append();
    append('材料は揃うが、要る道具に入手経路が無い。**総コストは出るが、実際には作れない**');
    append('——道具の時間を総コストへ按分しない決まり（#550）の裏返しなので、ここで別に出す。');
    append();
    append('| オブジェクト | 総労働（分） | 無い道具 |');
    append('| --- | --- | --- |');
    for (const cost of toolBlocked)
      append(
        `| ${cost.objectName} | ${formatNumber(cost.minutes ?? 0)} |` +
          ` ${cost.prerequisites
            .filter(({ minutes }) => minutes === undefined)
            .map(({ label }) => label)
            .join('、')} |`,
      );
    append();
  }

  append('### 総コスト');
  append();
  append('| オブジェクト | 総労働（分） | 探索 | それ以外 | 日数 | 作り方 | 前提 |');
  append('| --- | --- | --- | --- | --- | --- | --- |');
  for (const cost of tables.objectCosts) {
    if (cost.minutes === undefined) continue;
    append(
      `| ${cost.objectName} | ${formatNumber(cost.minutes)} |` +
        ` ${formatNumber(cost.exploreMinutes ?? 0)} | ${formatNumber(cost.craftMinutes ?? 0)} |` +
        ` ${cost.days === undefined ? '—' : formatNumber(cost.days, 2)} |` +
        ` ${stepsText(cost.steps) || '—'} |` +
        ` ${cost.prerequisites.map(prerequisiteText).join('、') || '—'} |`,
    );
  }
  append();
}

function appendDevices(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 3. 待ち生産表（設備が時間をかけて返す分）');
  append();
  append('仕掛けてから時間が経つと産物が返るもの。**周期は単位あたりの労働時間には足していない**');
  append('（計測方法の「待って得る生産の数え方」参照）ので、この表が代わりに周期とレートを出す。');
  append();
  append('- **設備あたり（個/日）**: 1日は24時間まるごと回る。眠っている間も進むのが待ち生産の取り柄。');
  append('- **寿命の間に（個）**: 設備1つが朽ちるまでに返す総数。これが並列度の上限を決める。');
  append('- **労働（分/個）**: 製作労働 ÷ 寿命の間に返す数。連鎖表に載るのはこの値。');
  append();

  for (const place of tables.places) {
    if (place.devices.length === 0) continue;

    append(`### ${place.name}`);
    append();
    append(
      '| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |',
    );
    append('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const device of place.devices)
      append(
        `| ${device.deviceName} | ${device.stepName} | ${formatNumber(device.periodMinutes, 0)} |` +
          ` ${device.productName} ×${formatNumber(device.perCycle, 3)} | ${formatNumber(device.perDay, 2)} |` +
          ` ${device.lifetimeDays === undefined ? '—（朽ちない）' : formatNumber(device.lifetimeDays, 1)} |` +
          ` ${device.overLifetime === undefined ? '—' : formatNumber(device.overLifetime, 1)} |` +
          ` ${device.buildMinutes === undefined ? '入手経路なし' : formatNumber(device.buildMinutes)} |` +
          ` ${device.laborPerUnit === undefined ? '—' : formatNumber(device.laborPerUnit, 2)} |`,
      );
    append();
  }

  appendRainWater(append, tables);
}

/**
 * 雨で溜まる水。設備ではないが、**仕掛けて待つと値が返る**点は待ち生産と同じで、しかも労働が
 * 一切要らない。連鎖表には乗らない（工程ではないので労働0分になる）ので、量が出るのはここだけ。
 */
function appendRainWater(append: (line?: string) => void, tables: BalanceTables): void {
  if (tables.rainWater.length === 0) return;

  append('### 雨で溜まる水');
  append();
  append('空けたまま置いた容器が、1日に受ける水と失う水（`LiquidContainerSystem.md` 6・7節）。');
  append('降雨も蒸発も気候の実測値から出している（`ClimateSystemStats.md`）。');
  append();
  append('**単一の平均は出さない。** 雨季とそれ以外では降る時間が1桁違い、平均するとどの季節にも');
  append('存在しない中間の状態を測ることになる。読みたいのは差引の符号——**雨だけで水を賄えるのは');
  append('雨季だけ**で、それ以外の季節は置いておくだけでは減る。');
  append();
  append('- **蒸発は中身がある間しか効かない。** 空になった容器は素の型へ戻って蒸発も止まるので、');
  append('  この「1日に失う水」は満杯を保った場合の上限。実際の減りはこれより小さい。');
  append('- **容量を超えた分は捨てられる。** 雨季のヤシの器は容量250mLに対して1日1300mL近く降るので、');
  append('  汲み替えなければそのほとんどが失われる。差引はその損失を含まない。');
  append();
  append('| 容器 | 季節 | 容量（mL） | 降雨（mL/日） | 蒸発（mL/日） | 差引（mL/日） |');
  append('| --- | --- | --- | --- | --- | --- |');
  for (const row of tables.rainWater)
    append(
      `| ${row.containerName} | ${row.seasonName} | ${formatNumber(row.capacity, 0)} |` +
        ` ${formatNumber(row.rainPerDay, 0)} | ${formatNumber(row.evaporationPerDay, 0)} |` +
        ` ${row.netPerDay > 0 ? '+' : ''}${formatNumber(row.netPerDay, 0)} |`,
    );
  append();
}

function appendConsumption(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 4. 消費表（1日あたり何が要るか）');
  append();
  append('キャラクタが自分のプロパティをtick毎にどれだけ動かすか（`passives` の `add` と `transfer`）。');
  append('括弧内は1日ぶん（×96）。個体差はそのまま列に出る。**連鎖表の「1日 N」の出どころ**。');
  append();
  append(`| プロパティ | 条件 | ${tables.characterNames.join(' | ')} |`);
  append(`| --- | --- | ${tables.characterNames.map(() => '---').join(' | ')} |`);
  for (const row of tables.consumption) {
    const cells = row.perTickByCharacter.map((amount) =>
      amount === undefined ? '—' : `${formatNumber(amount, 2)}（${formatNumber(amount * TICKS_PER_DAY, 0)}）`,
    );
    append(`| ${row.propertyName} | ${row.condition} | ${cells.join(' | ')} |`);
  }
  append();
}

function appendSupply(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 5. 供給表（1工程あたり）');
  append();
  append('何かを生むか、値を動かす工程すべて。産出は1回の実行あたりの期待個数。');
  append('各オブジェクトのページにも同じ宣言があるので、ここは横断して見比べるための一覧。');
  append();
  append('`?` は、所要時間か分岐の重みが**定義だけでは決まらない**工程（相手の持ち物を見る');
  append('`{subject: dragged, prop: ...}` 参照など）。解けない重みは0として扱うので、その行の期待値は');
  append('残った候補へ寄っている——例えば `strike` の当たり方は武器が決めるため、ここでは出せない。');
  append();
  append('種別 `periodic` は時間で回る工程（罠の判定）。労働は0で、周期だけが経過する。');
  append('`transfer` の増減は宣言された上限で、実際に動く量は在庫と空きで目減りする。');
  append();
  append('| 宣言元 | 工程 | 種別 | 労働（分） | 周期（分） | 期待産出 | 値の増減 |');
  append('| --- | --- | --- | --- | --- | --- | --- |');

  for (const row of tables.supply) {
    const spawnText = row.spawns.map(({ name, amount }) => `${name} ×${formatNumber(amount, 2)}`).join('、');
    const deltaText = [
      amountList(row.actorDeltas),
      row.selfDeltas.map(({ name, amount }) => `（self）${name} ${signed(amount)}`).join('、'),
    ]
      .filter(Boolean)
      .join('、');

    append(
      `| ${row.ownerName} | ${row.stepName} | ${row.kind} |` +
        ` ${formatNumber(row.laborMinutes, 0)}${row.hasUnresolvedReferences ? ' ?' : ''} |` +
        ` ${formatNumber(row.elapsedMinutes, 0)} | ${spawnText || '—'} | ${deltaText || '—'} |`,
    );
  }
  append();
}

describe.runIf(process.env.RUN_BALANCE_STATS === '1')('アイテム収支レポート', () => {
  it('定義から収支を計算してBalanceStats.mdを再生成する', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);

    const report = buildReport(tables);
    const outPath = join('docs', 'diagnostics', 'BalanceStats.md');
    writeFileSync(outPath, report, 'utf8');
    console.log(`Report written to: ${outPath}`);

    expect(report).toContain('# アイテム収支レポート');
    expect(tables.places[0].name).toBe(WHOLE_ISLAND);

    // 雨で溜まる水は、時間を数えられていないだけで内容の穴ではない（issue #660）。
    expect(report).toContain('### 数えられない経路');
    expect(tables.gaps.filter((gap) => gap.label.includes('water_liquid'))).toEqual([]);

    // 汲む労働は数えられなくても、溜まる量は季節ごとに出る（issue #662）。**符号が結論**なので、
    // 値ではなくこれを見る——雨だけで水を賄えるのは雨季だけで、それ以外の季節は置くだけでは減る。
    expect(report).toContain('### 雨で溜まる水');
    for (const row of tables.rainWater) {
      const label = `${row.containerName} / ${row.seasonName}`;
      if (row.seasonName === 'wet') expect(row.netPerDay, label).toBeGreaterThan(0);
      else expect(row.netPerDay, label).toBeLessThan(0);
    }
  }, 600_000);
});
