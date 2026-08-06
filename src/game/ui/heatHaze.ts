/** 陽炎の強さ（ScreenLayout.md 空の演出節）。 */
export interface HeatHaze {
  /** ゆがみの量（Phaserの変位フィルタに渡す割合。画面幅の半分に対する比）。 */
  readonly strength: number;
  /** ゆらぎの片道の時間（ミリ秒）。 */
  readonly swayMs: number;
}

/**
 * 陽炎が立ち始める気温と、最も強くなる気温。
 *
 * `ambient_temperature` は基準20に日射（暗い-3／明るい+3）と季節（涼しい-5／暑い+8）が重なった
 * 実効値（core.yaml）なので、27以上になるのは**暑い季節の日中**だけ。天気ではなく気温で決めるのは、
 * 陽炎が立つのは地面が焼けているからで、灼熱という天気の名前そのものではないため。
 */
const HAZE_MIN_TEMPERATURE = 27;
const HAZE_MAX_TEMPERATURE = 31;

/**
 * 最も暑いときのゆがみの量と、ゆらぎの速さ。**動いて初めて分かる程度に留める**——地面が大きく
 * 歪むと、陽炎ではなく描画の壊れに見える。
 *
 * ゆがみの量は画素数ではなく、掛ける対象（レーンに敷いた地面）の一辺の半分に対する比。レーンは
 * 薄い帯なので、比の見た目は小さく出る。触るときは何pxずれるかで確かめること。
 */
const MAX_STRENGTH = 0.05;
const SWAY_MS = 1400;

/** その気温のときの陽炎。立たない気温（と、気温が分からないとき）ならundefined。 */
export function heatHazeFor(temperature: number | undefined): HeatHaze | undefined {
  if (temperature === undefined || temperature < HAZE_MIN_TEMPERATURE) return undefined;

  const heat = Math.min(
    1,
    (temperature - HAZE_MIN_TEMPERATURE) / (HAZE_MAX_TEMPERATURE - HAZE_MIN_TEMPERATURE),
  );
  // 立ち始めから最大までを線形に結ぶが、立った瞬間に消えるほど弱くはしない。
  return { strength: MAX_STRENGTH * (0.4 + 0.6 * heat), swayMs: SWAY_MS };
}
