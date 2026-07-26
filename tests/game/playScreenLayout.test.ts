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
    expect(layout.situationArea.height).toBe(128);
    // キャラクターエリア（キャラクター表示＋ステータス）は1080×472。
    expect(layout.characterDisplay.height).toBe(472);
    expect(layout.characterDisplay.width).toBe(460);
    expect(layout.statusArea.width).toBe(620);
  });

  it('縦型では天候の帯を使わず、天候チップは状況エリアに同居する', () => {
    expect(new PlayScreenLayout(new ScreenMetrics(1080, 1920)).weatherRow).toBeUndefined();
  });

  it('横型1920×1080はダッシュボード540・フィールド1260・サイドバー120に分かれる', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1920, 1080));

    expect(layout.fieldArea).toEqual({ x: 540, y: 0, width: 1260, height: 1080 });
    expect(layout.optionsBar).toEqual({ x: 1800, y: 0, width: 120, height: 444 });
    expect(layout.filterBar).toEqual({ x: 1800, y: 444, width: 120, height: 636 });
    expect(layout.weatherRow).toEqual({ x: 0, y: 112, width: 540, height: 112 });
    expect(layout.characterDisplay).toEqual({ x: 0, y: 224, width: 540, height: 352 });
    expect(layout.statusArea).toEqual({ x: 0, y: 576, width: 540, height: 504 });
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

  it('9:16より縦長でない縦型ではフィールドエリアを縮めてダッシュボード列を確保する', () => {
    const layout = new PlayScreenLayout(new ScreenMetrics(1080, 1400));

    expect(layout.fieldArea.height).toBeLessThan(1080);
    expect(layout.characterDisplay.height).toBeGreaterThan(0);
    expect(layout.filterBar.y + layout.filterBar.height).toBe(1400);
  });
});
