import { describe, expect, it } from 'vitest';
import { PlayScreenLayout } from '../../src/game/looks/PlayScreenLayout';
import { ScreenMetrics } from '../../src/game/looks/ScreenMetrics';

/** 有理数（分子・分母のBigInt）。laneCellsの真の値を、浮動小数の誤差なしで求めるために使う。 */
interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

const ratio = (n: bigint, d: bigint): Rational => ({ n, d });
const smaller = (a: Rational, b: Rational): Rational => (a.n * b.d < b.n * a.d ? a : b);
const times = (a: Rational, k: bigint): Rational => ratio(a.n * k, a.d);
const minus = (a: Rational, b: Rational): Rational => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const plus = (a: Rational, b: Rational): Rational => ratio(a.n * b.d + b.n * a.d, a.d * b.d);

/**
 * PlayScreenLayout.laneCellsと同じ式を有理数で解いたもの。ScreenMetricsのuも、
 * フィールドエリアの幅（横型は画面幅からダッシュボード列478uと右サイドバーを引いたもの、
 * 縦型は画面幅そのもの）も、割り切れない値のまま持ち回る。
 *
 * 横型のサイドバーは、広げる前（120u）の枚数が6枚を超えるときだけ240uになる（ScreenLayout.md
 * 10.1節）。判定に使うのも同じ式なので、ここでも同じ順に2度解く。
 */
function exactLaneCells(width: number, height: number): number {
  const w = BigInt(width);
  const h = BigInt(height);
  const landscape = width >= height;
  const u = landscape ? smaller(ratio(h, 1080n), ratio(w, 1683n)) : smaller(ratio(w, 1080n), ratio(h, 1920n));

  // レーンに使える幅 ＝ フィールドエリアの幅 − 外周マージン（横型は左右、縦型は左だけ）。
  // これにギャップ1つ分を足したものを、カードのピッチ217uで割る。
  const cellsBeside = (sidebar: bigint): bigint => {
    const usable = landscape
      ? minus(ratio(w, 1n), times(u, 478n + sidebar + 12n))
      : minus(ratio(w, 1n), times(u, 6n));
    const numerator = plus(usable, times(u, 12n));
    const pitch = times(u, 217n);
    const cells = (numerator.n * pitch.d) / (numerator.d * pitch.n);
    return cells < 0n ? 0n : cells;
  };

  const narrow = cellsBeside(120n);
  return Number(landscape && narrow > 6n ? cellsBeside(240n) : narrow);
}

describe('ScreenMetrics', () => {
  it('uは画面短辺の1/1080になる', () => {
    expect(new ScreenMetrics(1080, 1920).u).toBe(1);
    expect(new ScreenMetrics(1920, 1080).u).toBe(1);
    expect(new ScreenMetrics(540, 960).u).toBe(0.5);
  });

  it('9:16より正方形に近い縦型は、uを縮めて設計上の高さ1920uを確保する', () => {
    // 短辺基準のままだと縦に積み切れず、3レーンが収まらない（PlayScreenLayoutの縦型の積み上げ）。
    expect(new ScreenMetrics(1080, 1440).u, '3:4').toBe(1440 / 1920);
    expect(new ScreenMetrics(1536, 2048).u, '3:4のタブレット').toBe(2048 / 1920);
  });

  it('16:9より正方形に近い横型は、uを縮めて設計上の幅1683uを確保する', () => {
    // 短辺基準のままだと横に3列（ダッシュボード478 + カード5枚ぶん1085 + サイドバー120）が並ばない。
    expect(new ScreenMetrics(1440, 1080).u, '4:3').toBe(1440 / 1683);
    expect(new ScreenMetrics(1080, 1080).u, '正方形').toBe(1080 / 1683);
    // 16:9以上に横長なら幅は余るので、短辺基準のまま。
    expect(new ScreenMetrics(2560, 1080).u, '21:9').toBe(1);
  });

  it('正方形は横型として扱う', () => {
    expect(new ScreenMetrics(1080, 1080).isLandscape).toBe(true);
    expect(new ScreenMetrics(1079, 1080).isLandscape).toBe(false);
  });
});

describe('PlayScreenLayout(ScreenLayout.md 9〜11節 エリア構成)', () => {
  it('縦型1080×1920はScreenLayout.md 9節の表どおりの高さに分かれる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 1920));

    expect(layout.optionsBar).toEqual({ x: 0, y: 4, width: 1080, height: 120 });
    expect(layout.fieldArea).toEqual({ x: 0, y: 720, width: 1080, height: 1080 });
    expect(layout.filterBar).toEqual({ x: 0, y: 1800, width: 1080, height: 120 });
    expect(layout.situationArea.height).toBe(128);
    // キャラクターエリア（キャラクター表示＋ステータス）は1032×444。
    expect(layout.characterDisplay.height).toBe(444);
    expect(layout.characterDisplay.width).toBe(460);
    expect(layout.statusArea.width).toBe(572);
  });

  it('縦型はオプションバー・状況エリア・本の順に積み、本の中はキャラクターエリアだけになる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 1920));

    // 状況エリアは本の外。オプションバーの直下に幅いっぱいで載る。
    expect(layout.situationArea).toEqual({ x: 0, y: 124, width: 1080, height: 128 });
    expect(layout.situationArea.y).toBe(layout.optionsBar.y + layout.optionsBar.height);
    expect(layout.informationArea.y).toBe(layout.situationArea.y + layout.situationArea.height);

    expect(layout.characterDisplay.y).toBe(layout.informationContent.y);
    expect(layout.statusArea.y).toBe(layout.characterDisplay.y);
    // 下端はフィールドエリアの手前。表紙の縁を避ける余白はキャラクター表示エリアの内側が受け持つ。
    expect(layout.characterDisplay.y + layout.characterDisplay.height).toBe(layout.fieldArea.y);
  });

  it('横型1920×1080はダッシュボード478・フィールド1322・サイドバー120に分かれる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1920, 1080));

    expect(layout.fieldArea).toEqual({ x: 478, y: 0, width: 1322, height: 1080 });
    expect(layout.optionsBar).toEqual({ x: 1800, y: 0, width: 120, height: 444 });
    expect(layout.filterBar).toEqual({ x: 1800, y: 444, width: 120, height: 636 });
    // 状況エリアは本の外なので、紙の内側（446）ではなく列の幅いっぱい（478）を取る。
    expect(layout.situationArea).toEqual({ x: 0, y: 0, width: 478, height: 184 });
    expect(layout.characterDisplay).toEqual({ x: 0, y: 208, width: 446, height: 412 });
    expect(layout.statusArea).toEqual({ x: 0, y: 620, width: 446, height: 436 });
  });

  it('3レーンは向きによらずフィールドエリアを外周マージン込みで埋める', () => {
    for (const metrics of [new ScreenMetrics(1080, 1920), new ScreenMetrics(1920, 1080)]) {
      const layout = new PlayScreenLayout(metrics);
      expect(layout.lanes).toHaveLength(3);
      expect(layout.lanes[0].y).toBe(layout.fieldArea.y + 6);
      expect(layout.lanes[2].y + layout.lanes[2].height).toBe(
        layout.fieldArea.y + layout.fieldArea.height - 6,
      );
      for (const lane of layout.lanes) expect(lane.height).toBe(352);
    }
  });

  it('区切りの帯は4本あり、中央半分がレーンの隙間にちょうど重なる', () => {
    for (const metrics of [new ScreenMetrics(1080, 1920), new ScreenMetrics(1920, 1080)]) {
      const layout = new PlayScreenLayout(metrics);
      const gaps = [
        { top: layout.fieldArea.y, bottom: layout.lanes[0].y },
        ...layout.lanes.slice(0, 2).map((lane, i) => ({
          top: lane.y + lane.height,
          bottom: layout.lanes[i + 1].y,
        })),
        {
          top: layout.lanes[2].y + layout.lanes[2].height,
          bottom: layout.fieldArea.y + layout.fieldArea.height,
        },
      ];
      expect(layout.laneSeparators, '設置物レーンの上・レーン間×2・ハンドレーンの下').toHaveLength(4);

      for (const [i, separator] of layout.laneSeparators.entries()) {
        const gap = gaps[i];
        // 絵の中央半分（上下1/4ずつを除いた範囲）が隙間そのものに一致する。
        expect(separator.height / 2, `${i}本目の中央半分は隙間の高さ`).toBe(gap.bottom - gap.top);
        expect(separator.y + separator.height / 4, `${i}本目の中央半分の上端`).toBe(gap.top);
        expect(separator.width).toBe(layout.fieldArea.width);
      }
    }
  });

  it('情報エリアはフィールドエリアの左（横型）・上（縦型）を隙間なく占める', () => {
    // 横型は状況エリアが本の外なので、情報エリアはその下から画面の下端まで。
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    expect(landscape.informationArea).toEqual({ x: 0, y: 184, width: landscape.fieldArea.x, height: 896 });
    expect(landscape.informationArea.y).toBe(landscape.situationArea.height);

    // 縦型はオプションバーと状況エリアが背景のページの外側なので、情報エリアはその下から。
    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    expect(portrait.informationArea).toEqual({ x: 0, y: 252, width: 1080, height: 468 });
    expect(portrait.informationArea.y).toBe(portrait.situationArea.y + portrait.situationArea.height);
    expect(portrait.informationArea.y + portrait.informationArea.height).toBe(portrait.fieldArea.y);
  });

  it('情報エリアの中身は、本の縁のぶん内側へ収まる', () => {
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    // 右は表紙の縁（食い込ませる分を引いた32u）、上下はページの縁（24u）。
    expect(landscape.informationContent).toEqual({ x: 0, y: 208, width: 446, height: 848 });
    for (const area of [landscape.characterDisplay, landscape.statusArea]) {
      expect(area.x + area.width, '中身の右端は紙の内側').toBeLessThanOrEqual(446);
    }

    // 縦型は左右に加えて上辺にも縁を見せる（状況エリアを外へ出して上端が画面の途中に来たため）。
    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    expect(portrait.informationContent).toEqual({ x: 24, y: 276, width: 1032, height: 444 });
    expect(portrait.informationContent.y - portrait.informationArea.y, '上辺の縁').toBe(24);
    expect(portrait.characterDisplay.x, '中身の左端は紙の内側').toBeGreaterThanOrEqual(24);
    expect(portrait.statusArea.x + portrait.statusArea.width).toBe(1056);
  });

  it('極端に縦長の縦型はキャラクターエリアを引き伸ばさず、オプションバーの上を余らせる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 2400));

    expect(layout.characterDisplay.height, '内容量ぶんのまま').toBe(444);
    expect(layout.situationArea.height).toBe(128);
    expect(layout.optionsBar.y, '余りはオプションバーの上へ').toBe(484);
    expect(layout.informationArea.y, '情報エリアは状況エリアの下から').toBe(732);
    // 下から順に、フィルターバー・フィールドエリア・情報エリアが隙間なく積まれている。
    expect(layout.filterBar.y + layout.filterBar.height).toBe(2400);
    expect(layout.fieldArea.y + layout.fieldArea.height).toBe(layout.filterBar.y);
    expect(layout.informationArea.y + layout.informationArea.height).toBe(layout.fieldArea.y);
  });

  it('縦型は、本の外に並ぶ帯どうしと、帯と本の境目に区切りを置く', () => {
    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    const boundaries = [
      {
        separator: portrait.optionsBarSeparator,
        at: portrait.optionsBar.y + portrait.optionsBar.height,
        label: 'オプションバーと状況エリア',
      },
      {
        separator: portrait.situationSeparator,
        at: portrait.situationArea.y + portrait.situationArea.height,
        label: '状況エリアと本',
      },
    ];

    for (const { separator, at, label } of boundaries) {
      expect(separator, label).toBeDefined();
      expect(separator?.height, `${label}: レーンの区切りと同じ厚み`).toBe(12);
      expect((separator?.y ?? 0) + (separator?.height ?? 0) / 2, `${label}: 境目が帯の中心`).toBe(at);
      expect(separator?.width, `${label}: 幅は画面いっぱい`).toBe(1080);
    }

    // 横型のオプションバーは右サイドバーで状況エリアと接しておらず、状況エリアと本も上下に並ばない。
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    expect(landscape.optionsBarSeparator).toBeUndefined();
    expect(landscape.situationSeparator).toBeUndefined();
  });

  it('横型はフィールドエリアの左右の辺に区切りを置く', () => {
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    // 左は状況エリアと本、右は右サイドバーと接する。**どちらもフィールドエリアの辺として置く**ので、
    // 高さはフィールドエリアいっぱい。左の帯が本の縁で終わって見えるのは、ページが手前から覆うため。
    const edges = [
      { separator: landscape.fieldLeftSeparator, at: landscape.fieldArea.x, label: '左' },
      {
        separator: landscape.sidebarSeparator,
        at: landscape.fieldArea.x + landscape.fieldArea.width,
        label: '右',
      },
    ];

    for (const { separator, at, label } of edges) {
      expect(separator, label).toBeDefined();
      expect(separator?.width, `${label}: レーンの区切りと同じ厚み（縦向きなので幅）`).toBe(12);
      expect((separator?.x ?? 0) + (separator?.width ?? 0) / 2, `${label}: 境目が帯の中心`).toBe(at);
      expect(separator?.height, `${label}: 高さはフィールドエリアいっぱい`).toBe(landscape.fieldArea.height);
    }

    // 縦型はフィールドエリアと2つのバーが上下に並び、左右では接していない。
    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    expect(portrait.fieldLeftSeparator).toBeUndefined();
    expect(portrait.sidebarSeparator).toBeUndefined();
  });

  it('どの画面比でもレーンにカード5枚ぶんの幅があり、laneCellsがその枚数を返す', () => {
    // 5枚見えていないと、場に何があるかを見比べるより先に送る操作が要る（ScreenLayout.md 3.1節）。
    // laneCellsは下限（LANE_MIN_CARDS）を持っていて必ず5以上を返すので、5枚の規則を見るのは
    // **幾何のほう**——レーンに使える幅がカード5枚ぶん1073u以上あること。保証を持っているのは
    // 寸法の側（ScreenMetrics）なので、そちらを見れば下限が本当の退行を隠すことはない。
    // laneCellsの値そのものは期待値ちょうどで見る。6が出るかどうかが、手持ちの6枠目が隠れるか
    // （＝前へ詰めるか、7.3節）を分ける。
    for (const [width, height, expected] of [
      [1080, 1920, 5], // 9:16（縦型の基準）
      [540, 960, 5], // 9:16の小さな端末
      [1080, 1440, 6], // 3:4
      [1920, 1080, 6], // 16:9（横型の基準）
      [1440, 1080, 5], // 4:3
      [1152, 1080, 5], // 16:15
      [1080, 1080, 5], // 正方形
      [2560, 1080, 8], // 21:9（6枚を超えた分の幅はサイドバーへ回るので、9枚ではなく8枚）
      // ここから下は、幅で決まる横型（商がちょうど5.0000）で誤差により4を返していた寸法。
      [721, 720, 5],
      [1083, 1080, 5],
      [1090, 1080, 5],
      // 商が6以上の側でも、割り切れる寸法では同じ誤差が出ていた。
      [1945, 900, 7],
      [3030, 900, 13],
    ]) {
      const layout = new PlayScreenLayout(new ScreenMetrics(width, height));
      const { u, isLandscape } = layout.metrics;
      // レーンに使える幅＝フィールドエリアの幅から外周マージンを引いたもの。横型は左右とも区切りの
      // 帯がかぶるので12u、縦型の右端は画面の端そのものなので左の6uだけ（laneCells）。
      const usable = (layout.fieldArea.width - layout.metrics.px(isLandscape ? 12 : 6)) / u;

      // 幾何のほうも浮動小数なので、比較にはlaneCellsと同じだけの遊びを持たせる。
      expect(usable + 1e-6, `${width}×${height}: カード5枚ぶん1073u`).toBeGreaterThanOrEqual(1073);
      expect(layout.laneCells, `${width}×${height}`).toBe(expected);
    }
  });

  it('横型で高さが余ったら、レーンが背を伸ばしてフィールドエリアを埋める', () => {
    // 幅に合わせてuを縮めた横型（ScreenMetrics）では、3レーン分（1080u）より高さが余る。余りを
    // 外に残すと、区切りの帯で囲った枠が画面の端から離れて見える。
    const layout = new PlayScreenLayout(new ScreenMetrics(1440, 1080));
    const { u } = layout.metrics;

    expect(layout.fieldArea.height / u, 'フィールドエリアは画面高そのもの').toBeCloseTo(1262.25);
    for (const lane of layout.lanes) expect(lane.height / u).toBeCloseTo((1262.25 - 24) / 3);
    expect((layout.lanes[0].y - layout.fieldArea.y) / u, '上端の外周マージン').toBeCloseTo(6);
    expect(
      (layout.fieldArea.y + layout.fieldArea.height - layout.lanes[2].y - layout.lanes[2].height) / u,
      '下端の外周マージン',
    ).toBeCloseTo(6);
    // カードはレーンの中央に並ぶので（CardLane）、伸びた分は上下の余白になる。
    expect(layout.lanes[0].height / u).toBeGreaterThan(320);
  });

  it('横型のフィルターバーは9個を縮めずに並べ、はみ出した分を送れる長さとして返す', () => {
    // ボタンは「すべて」＋card_filtersの8個で9個（ScreenLayout.md 8節）。横型のサイドバーは
    // 設計の基準（1920×1080）でも636uしかなく、9個（952u）＋前後の余白は初めから収まらない。
    const layout = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    const row = layout.filterBarIcons(9);

    expect(row.icons).toHaveLength(9);
    for (const icon of row.icons) {
      expect(icon.height, '収まらなくてもボタンは最小タップ領域のまま').toBe(88);
      expect(icon.width).toBe(88);
    }
    // バーより長い分だけ送れる（PlayScene.buildIconBar → ScrollArea）。
    expect(row.axis, '横型は縦積みなので縦に送る').toBe('y');
    expect(row.length).toBe(16 + 88 * 9 + 20 * 8 + 16);
    expect(row.length).toBeGreaterThan(layout.filterBar.height);

    // 送り切った先で、最後のボタンが末尾の余白ぶんだけ内側に収まる。
    const last = row.icons[8];
    expect(last.y + last.height + 16).toBe(layout.filterBar.y + row.length);
  });

  it('十分に横長な画面は、サイドバーを2列に広げてフィルター9個を送らずに出す', () => {
    // 19.5:9。フィールドエリアが1742u＝8枚ぶんあり、手持ちの6枠を超えた分を使う相手が居ない
    // （ScreenLayout.md 10.1節）。回すのは1列（120u）ぶん。
    const layout = new PlayScreenLayout(new ScreenMetrics(2340, 1080));

    expect(layout.fieldArea).toEqual({ x: 478, y: 0, width: 1622, height: 1080 });
    // 2列とも画面の高さいっぱい。フィルターはフィールドエリア寄りの左、オプションが右端（10.2節）。
    expect(layout.filterBar).toEqual({ x: 2100, y: 0, width: 120, height: 1080 });
    expect(layout.optionsBar).toEqual({ x: 2220, y: 0, width: 120, height: 1080 });
    // 境目の帯はフィールドエリアの右辺（＝広げたサイドバーの左辺）に、中心を合わせて敷く。
    expect(layout.sidebarSeparator).toEqual({ x: 2094, y: 0, width: 12, height: 1080 });

    // 9個は1080uの列に収まるので、送り先を持たない（PlayScene.buildIconBar）。
    expect(layout.filterBarIcons(9).length).toBe(16 + 88 * 9 + 20 * 8 + 16);
    expect(layout.filterBarIcons(9).length).toBeLessThanOrEqual(layout.filterBar.height);
  });

  it('広げるかは広げる前の幅で決め、広げた後もカード6枚は割らない', () => {
    // 広げた後の幅で測ると、広げる→6枚になる→余剰が無くなる→戻す、を繰り返す（10.2節）。
    // 120u（回す幅）はカード1枚のピッチ217uより狭いので、広げても6枚を下回ることは無い。
    for (const [width, height, widened, cells] of [
      [1920, 1080, false, 6], // 16:9（横型の基準。ここが変わると#1092の設計が崩れる）
      [2116, 1080, false, 6], // 広げる前が6枚。1uの差でも回さない
      [2117, 1080, true, 6], // 広げる前が7枚ちょうど（1519u = 217×7）
      [2340, 1080, true, 7], // 19.5:9。回した後も1枚余るが、足す先が無い
      [2560, 1080, true, 8], // 21:9
      [1440, 1080, false, 5], // 4:3（uを縮めて幅を作っている側。余剰は無い）
    ] as const) {
      const layout = new PlayScreenLayout(new ScreenMetrics(width, height));
      const label = `${width}×${height}`;

      expect(layout.filterBar.x < layout.optionsBar.x, `${label}: 2列に広げるか`).toBe(widened);
      expect(layout.laneCells, label).toBe(cells);
      expect(layout.laneCells, `${label}: 手持ちの6枠を割らない`).toBeGreaterThanOrEqual(widened ? 6 : 5);
    }
  });

  it('収まる並びは送り先を持たない（オプションバーと、縦型のフィルターバー）', () => {
    for (const [width, height] of [
      [1080, 1920], // 9:16（縦型の基準）
      [1920, 1080], // 16:9（横型の基準）
      [1440, 1080], // 4:3
    ]) {
      const layout = new PlayScreenLayout(new ScreenMetrics(width, height));
      const label = `${width}×${height}`;
      const along = (bar: { width: number; height: number }): number =>
        layout.metrics.isLandscape ? bar.height : bar.width;

      expect(layout.optionsBarIcons(4).length, `${label}: オプション4個`).toBeLessThanOrEqual(
        along(layout.optionsBar),
      );
      if (!layout.metrics.isLandscape) {
        expect(layout.filterBarIcons(9).length, `${label}: フィルター9個`).toBeLessThanOrEqual(
          along(layout.filterBar),
        );
      }
    }
  });

  it('収まらない並びは、寄せ方によらずバーの先頭から始まる', () => {
    // 中央寄せ・末尾寄せのまま溢れさせると、送り切っても先頭のボタンがバーの外に残る。
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    expect(landscape.optionsBarIcons(20).icons[0].y, '横型は中央寄せ').toBe(landscape.optionsBar.y);

    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    expect(portrait.optionsBarIcons(20).icons[0].x, '縦型は右寄せ').toBe(portrait.optionsBar.x + 24);
  });

  it('laneCellsは、どの画面寸法でも有理数で求めた厳密な値と一致する', () => {
    // 設計寸法が「カード5枚ぴったり」なので、幅で決まる横型はどれも境界（ちょうど5.0000）に載る。
    // 浮動小数で数えると、丸めの目次第でMath.floorが1つ落ちる。真の値は有理数（BigInt）で求める。
    const mismatches: string[] = [];
    for (const height of [720, 900, 1080, 1920]) {
      for (let width = 320; width <= 3840; width++) {
        const { laneCells } = new PlayScreenLayout(new ScreenMetrics(width, height));
        const exact = exactLaneCells(width, height);
        if (laneCells !== exact) mismatches.push(`${width}×${height}: 厳密${exact} → ${laneCells}`);
      }
    }

    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it('どの縦型でもフィールドエリアは3レーン分（1080u）を確保する', () => {
    // 3レーンが無いとプレイ自体が成り立たないため、9:16より正方形に近い画面では全体を縮めて
    // でも高さを取る（ScreenMetrics）。
    for (const [width, height] of [
      [1080, 1920], // 9:16（設計の基準）
      [1080, 2400], // 9:20（余りはオプションバーの上へ）
      [1080, 1440], // 3:4
      [1536, 2048], // 3:4のタブレット
      [1080, 1152], // ほぼ正方形
    ]) {
      const layout = new PlayScreenLayout(new ScreenMetrics(width, height));
      const label = `${width}×${height}`;

      expect(layout.fieldArea.height / layout.metrics.u, label).toBeCloseTo(1080);
      const handLane = layout.lanes[2];
      expect(
        handLane.y + handLane.height,
        `${label}: ハンドレーンがフィールドエリアに収まる`,
      ).toBeLessThanOrEqual(layout.fieldArea.y + layout.fieldArea.height);
      expect(layout.filterBar.y + layout.filterBar.height, `${label}: 最下部はフィルターバー`).toBe(height);
    }
  });
});
