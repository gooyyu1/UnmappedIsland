import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { BalanceTables, ChainRoute, NamedAmount } from '../../src/codex/balanceTables';
import {
  buildBalanceTables,
  MINUTES_PER_DAY,
  MINUTES_PER_TICK,
  TICKS_PER_DAY,
  WHOLE_ISLAND,
} from '../../src/codex/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義から計算した収支表（`src/codex/balanceTables.ts`）を`docs/diagnostics/BalanceStats.md`へ書き出す。
 *
 * 同じ表はコーデックスビューア（`src/codex/balancePage.ts`）でも見られる。**Markdownを残すのは
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
  return route.steps.map((step) => `${step.objectName}.${step.stepName}`).join(' → ');
}

function minutesText(minutes: number | undefined): string {
  return minutes === undefined ? '入手経路なし' : `${formatNumber(minutes)}分`;
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
  append('### この表が数えていないもの');
  append();
  append('- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。');
  append('  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。');
  append('- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは');
  append('  宣言値だけなので、罠のレートは**餌なし**の値。');
  append('- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。');
  append('  そのため水を汲む経路は所要時間0分の工程として出る（† を付けた行）。');
  append('- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。');
  append('- **獲物が死体に変わるまで。** 罠に掛かった獲物を殺すのは、刺さった傷が**親へ**与える出血');
  append('  （`snare_laceration` の `add: {parent: {blood: -15}}`）で、しかも傷の `bleeding` が尽きる');
  append('  数tickだけ効く。「傷の勢い×効いている長さ」と「獲物の血の量」の勝負なので、tick毎の');
  append('  増減を1つ足すだけでは決まらない。そのため待ち生産表の産物（獲物）は連鎖表へ繋がっておらず、');
  append('  連鎖表の「設備数」列は今のところ全て空になる。');
  append();
}

function appendChains(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 1. 連鎖表（素材から摂取までの総時間）');
  append();
  append(`1日ぶんの必要量は ${SAMPLE_CHARACTER} のもの（消費表の常時効く減りから）。`);
  append('時間はすべて労働時間で、待ち時間は含まない（待ち生産の設備は、周期÷寿命ぶんの製作労働と');
  append('して計上する）。「1日の割合」は、1日ぶんを賄うのに要る労働が1日（1440分）に占める割合。');
  append('「設備数」は、待ち生産の経路で1日ぶんを賄うのに同時に要る設備の数。');
  append('† は、素材を所要時間0分の工程で得ている経路（この表が時間を数えられていない）。');
  append('前提の道具に入手経路が無い経路は、数字を出したうえで表の末尾へ回す。');
  append();

  for (const place of tables.places) {
    if (place.properties.length === 0) continue;

    append(`### ${place.name}`);
    append();

    for (const chains of place.properties) {
      append(`#### ${chains.propertyName}（1日 ${formatNumber(chains.dailyNeed, 0)}）`);
      append();
      append(
        '| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |',
      );
      append('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const route of chains.routes) {
        const daily = route.perUnitMinutes * chains.dailyNeed;
        const prerequisites = route.prerequisites
          .map(({ label, minutes }) => `${label}（${minutesText(minutes)}）`)
          .join('、');

        append(
          `| ${routeText(route)} | ${formatNumber(route.perUnitMinutes, 2)}${route.untimed ? ' †' : ''} |` +
            ` ${formatNumber(route.exploreMinutes, 2)} | ${formatNumber(route.craftMinutes, 2)} |` +
            ` ${formatNumber(daily, 0)} | ${formatNumber((daily * 100) / MINUTES_PER_DAY, 1)}% |` +
            ` ${route.deviceCount === undefined ? '—' : formatNumber(route.deviceCount, 1)} |` +
            ` ${amountList(route.coProducts) || '—'} | ${prerequisites || '—'} |`,
        );
      }
      append();
    }
  }
}

function appendDevices(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 2. 待ち生産表（設備が時間をかけて返す分）');
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
}

function appendConsumption(append: (line?: string) => void, tables: BalanceTables): void {
  append('## 3. 消費表（1日あたり何が要るか）');
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
  append('## 4. 供給表（1工程あたり）');
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
        ` ${formatNumber(row.laborMinutes, 0)}${row.unresolved ? ' ?' : ''} |` +
        ` ${formatNumber(row.elapsedMinutes, 0)} | ${spawnText || '—'} | ${deltaText || '—'} |`,
    );
  }
  append();
}

describe.runIf(process.env.RUN_BALANCE_STATS === '1')('アイテム収支レポート', () => {
  it('定義から収支を計算してBalanceStats.mdを再生成する', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);

    const report = buildReport(tables);
    const outPath = join('docs', 'diagnostics', 'BalanceStats.md');
    writeFileSync(outPath, report, 'utf8');
    console.log(`Report written to: ${outPath}`);

    expect(report).toContain('# アイテム収支レポート');
    expect(tables.places[0].name).toBe(WHOLE_ISLAND);
  }, 600_000);
});
