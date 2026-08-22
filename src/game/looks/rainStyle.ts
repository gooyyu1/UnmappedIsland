/**
 * 天気ごとの雨の見え方（ScreenLayout.md 7.5.3節 雨の演出）。強くなるほど、多く・長く・速く・斜めになる。
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

/** 風の筋の、雨粒に対する長さ・太さ・濃さ・速さの倍率。 */
const GUST_LENGTH_SCALE = 5;
const GUST_THICKNESS_SCALE = 2.2;
const GUST_ALPHA_SCALE = 0.35;
const GUST_SPEED_SCALE = 0.55;

/** 同じ向き・同じ速さで落ちる筋のひと組。降らせる側（WeatherOverlay）はこれを1層として敷く。 */
export interface RainLayer {
  /** 1周期ぶんの帯に見えている筋の数。 */
  readonly count: number;
  readonly slantDegrees: number;
  readonly length: number;
  readonly thickness: number;
  readonly alpha: number;
  readonly fallMs: number;
}

/**
 * その見え方を、奥から順に敷く層へ分ける。風の筋は雨粒と同じ向き・同じ形で、長さ・太さ・濃さ・
 * 速さだけが違う——同じ層の作り方に倍率を掛けたものとして出す。
 */
export function rainLayersOf(style: RainStyle): readonly RainLayer[] {
  const drops: RainLayer = {
    count: style.drops,
    slantDegrees: style.slantDegrees,
    length: style.length,
    thickness: style.thickness,
    alpha: style.alpha,
    fallMs: style.fallMs,
  };
  if (style.gusts <= 0) return [drops];
  return [
    drops,
    {
      count: style.gusts,
      slantDegrees: style.slantDegrees,
      length: style.length * GUST_LENGTH_SCALE,
      thickness: style.thickness * GUST_THICKNESS_SCALE,
      alpha: style.alpha * GUST_ALPHA_SCALE,
      fallMs: style.fallMs * GUST_SPEED_SCALE,
    },
  ];
}
