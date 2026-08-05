/**
 * 天気ごとの雨の見え方（ScreenLayout.md 雨の演出節）。強くなるほど、多く・長く・速く・斜めになる。
 * 値はu単位（ScreenMetrics）とミリ秒。
 *
 * **暗さはここが持たない。** 明るさは日射（skyTint.ts）が一手に決める——雨が暗いのは雨雲が
 * 陽を遮っているからで、それは天気からsunlightへの寄与（core.yaml）として既に表されている。
 */
export interface RainStyle {
  /** 1周期ぶんの帯に降らせる雨粒の数。 */
  readonly drops: number;
  /** 鉛直からの傾き（度）。雨粒の向きと落ちる向きは常に一致する。 */
  readonly slantDegrees: number;
  /** 雨粒の長さ・太さ（u）。 */
  readonly length: number;
  readonly thickness: number;
  /** 雨粒の濃さ（0〜1）。 */
  readonly alpha: number;
  /** 画面の高さぶん落ちるのにかかる時間（ミリ秒）。短いほど速い。 */
  readonly fallMs: number;
  /** 吹き付ける風の筋の数。0なら風は描かない。 */
  readonly gusts: number;
}

/**
 * 天気の識別子ごとの雨の見え方。**ここに無い天気では雨を降らせない**ので、天気が増えても
 * 画面は壊れない（増えた雨天をここへ足すまで降らないだけ）。
 *
 * 見え方はWorldCodexではなくUIが持つ。WorldCodexは表示に関わる値を一切持たない方針
 * （Localization.md）で、液体の色（LiquidContainerSystem.md 4.1節）のようにドメインが
 * 意味を持つ値でもないため。
 */
const RAIN_STYLES: Readonly<Record<string, RainStyle>> = {
  light_rain: {
    drops: 70,
    slantDegrees: 6,
    length: 26,
    thickness: 2,
    alpha: 0.45,
    fallMs: 900,
    gusts: 0,
  },
  heavy_rain: {
    drops: 160,
    slantDegrees: 18,
    length: 42,
    thickness: 2.5,
    alpha: 0.55,
    fallMs: 620,
    gusts: 0,
  },
  storm: {
    drops: 200,
    slantDegrees: 34,
    length: 62,
    thickness: 3,
    alpha: 0.65,
    fallMs: 420,
    gusts: 3,
  },
};

/** その天気の雨の見え方。雨が降らない天気（と、天気が分からないとき）ならundefined。 */
export function rainStyleFor(weather: string | undefined): RainStyle | undefined {
  return weather === undefined ? undefined : RAIN_STYLES[weather];
}
