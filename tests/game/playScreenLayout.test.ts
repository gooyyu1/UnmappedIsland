import { describe, expect, it } from 'vitest';
import { PlayScreenLayout } from '../../src/game/looks/PlayScreenLayout';
import { ScreenMetrics } from '../../src/game/looks/ScreenMetrics';

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

  it('どの画面比でもレーンにカードが5枚見える', () => {
    // 5枚見えていないと、場に何があるかを見比べるより先に送る操作が要る（ScreenLayout.md 3.1節）。
    // レーンは外周マージン（6u）の内側から送る。横型はその外側の左右に区切りの帯がかぶるので、
    // 見えるのは送り幅だけ。縦型の右端は画面の端そのもので、はみ出したカードもそのまま見える。
    const cards = 205 * 5 + 12 * 4;
    for (const [width, height] of [
      [1080, 1920], // 9:16（縦型の基準）
      [1080, 1440], // 3:4
      [1920, 1080], // 16:9（横型の基準）
      [1440, 1080], // 4:3
      [1152, 1080], // 16:15
      [1080, 1080], // 正方形
      [2560, 1080], // 21:9
    ]) {
      const layout = new PlayScreenLayout(new ScreenMetrics(width, height));
      const hidden = layout.metrics.isLandscape ? 12 : 6;
      const visible = layout.fieldArea.width / layout.metrics.u - hidden;
      // 1u未満の差はuを掛けて割り戻す途中の丸め。
      expect(visible, `${width}×${height}`).toBeGreaterThan(cards - 1);
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
