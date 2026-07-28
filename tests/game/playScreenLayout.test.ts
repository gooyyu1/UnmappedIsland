import { describe, expect, it } from 'vitest';
import { PlayScreenLayout } from '../../src/game/layout/PlayScreenLayout';
import { ScreenMetrics } from '../../src/game/layout/ScreenMetrics';

describe('ScreenMetrics', () => {
  it('uは画面短辺の1/1080になる', () => {
    expect(new ScreenMetrics(1080, 1920).u).toBe(1);
    expect(new ScreenMetrics(1920, 1080).u).toBe(1);
    expect(new ScreenMetrics(540, 960).u).toBe(0.5);
  });

  it('正方形は横型として扱う', () => {
    expect(new ScreenMetrics(1080, 1080).isLandscape).toBe(true);
    expect(new ScreenMetrics(1079, 1080).isLandscape).toBe(false);
  });
});

describe('PlayScreenLayout(ScreenLayout.md エリア構成)', () => {
  it('縦型1080×1920はScreenLayout.mdの表どおりの高さに分かれる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 1920));

    expect(layout.optionsBar).toEqual({ x: 0, y: 0, width: 1080, height: 120 });
    expect(layout.fieldArea).toEqual({ x: 0, y: 720, width: 1080, height: 1080 });
    expect(layout.filterBar).toEqual({ x: 0, y: 1800, width: 1080, height: 120 });
    expect(layout.situationArea.height).toBe(148);
    // キャラクターエリア（キャラクター表示＋ステータス）は1080×472。
    expect(layout.characterDisplay.height).toBe(452);
    expect(layout.characterDisplay.width).toBe(460);
    expect(layout.statusArea.width).toBe(620);
  });

  it('縦型では天候の帯を使わず、天候チップは状況エリアに同居する', () => {
    expect(new PlayScreenLayout(new ScreenMetrics(1080, 1920)).weatherRow).toBeUndefined();
  });

  it('横型1920×1080はダッシュボード540・フィールド1260・サイドバー120に分かれる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1920, 1080));

    expect(layout.fieldArea).toEqual({ x: 592, y: 0, width: 1208, height: 1080 });
    expect(layout.optionsBar).toEqual({ x: 1800, y: 0, width: 120, height: 444 });
    expect(layout.filterBar).toEqual({ x: 1800, y: 444, width: 120, height: 636 });
    expect(layout.weatherRow).toEqual({ x: 0, y: 112, width: 592, height: 112 });
    expect(layout.characterDisplay).toEqual({ x: 0, y: 224, width: 592, height: 352 });
    expect(layout.statusArea).toEqual({ x: 0, y: 576, width: 592, height: 504 });
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
    const landscape = new PlayScreenLayout(new ScreenMetrics(1920, 1080));
    expect(landscape.informationArea).toEqual({ x: 0, y: 0, width: landscape.fieldArea.x, height: 1080 });

    const portrait = new PlayScreenLayout(new ScreenMetrics(1080, 1920));
    expect(portrait.informationArea).toEqual({ x: 0, y: 0, width: 1080, height: portrait.fieldArea.y });
    // 縦型はオプションバーも情報エリアの中に入る（背景のページの上に載る）。
    expect(portrait.optionsBar.y + portrait.optionsBar.height).toBeLessThanOrEqual(
      portrait.informationArea.height,
    );
  });

  it('9:16より縦長でない縦型ではフィールドエリアを縮めてダッシュボード列を確保する', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 1400));

    expect(layout.fieldArea.height).toBeLessThan(1080);
    expect(layout.characterDisplay.height).toBeGreaterThan(0);
    expect(layout.filterBar.y + layout.filterBar.height).toBe(1400);
  });
});
