import { COLOR } from './theme';

/** フィールドエリア全体にかぶせる1枚の色（ScreenLayout.md 7.5.1節 空の明るさ）。 */
export interface SkyTint {
  readonly color: number;
  readonly alpha: number;
  /** 加算合成にするか。明るい側は加算にしないと、色が白く濁って明るく見えない。 */
  readonly additive: boolean;
}

/**
 * 翳りも輝きも足さない明るさ。曇りの正午（5,000 lx）がここに当たる。
 *
 * `ambient_brightness` は太陽高度と天気を1つに畳んだ実効値（core.yaml）。明るさをこの値から
 * 引くことで、**真夜中の快晴が明るくなる**ような取り違えが起きない。
 */
const NEUTRAL_BRIGHTNESS = 11;

/** 取りうる最大の明るさ。雲の無い空（125,000 lx）の正午。 */
const BRIGHTEST = 16;

/** 暗さの底（IlluminationSystem.md 4節）。夜はどの天気でもここへ均される。 */
const DARKEST = -6;

/** 底のときの翳りの濃さと、最も明るいときの輝きの強さ。 */
const MAX_DIM = 0.42;
const MAX_GLOW = 0.14;

/**
 * 翳りの効き方。1未満だと、明るさが下がり始めた側で速く濃くなる。**暗さは、光が少し減っただけで
 * 大きく効く**（正午の嵐と曇りの差は明るさでは5段だが、目にはそれ以上に暗く映る）。
 */
const DIM_CURVE = 0.5;

/**
 * その明るさのときにフィールドエリアへかぶせる色。かぶせるものが無ければundefined。
 *
 * 暗い側と明るい側で色が違うのは、翳りは影の色（青みのある暗色）、輝きは陽の色（暖色）だから。
 */
export function skyTintFor(ambientBrightness: number | undefined): SkyTint | undefined {
  if (ambientBrightness === undefined || ambientBrightness === NEUTRAL_BRIGHTNESS) return undefined;

  if (ambientBrightness < NEUTRAL_BRIGHTNESS) {
    const depth =
      (NEUTRAL_BRIGHTNESS - Math.max(DARKEST, ambientBrightness)) / (NEUTRAL_BRIGHTNESS - DARKEST);
    return { color: COLOR.skyShade, alpha: MAX_DIM * depth ** DIM_CURVE, additive: false };
  }

  const height =
    (Math.min(BRIGHTEST, ambientBrightness) - NEUTRAL_BRIGHTNESS) / (BRIGHTEST - NEUTRAL_BRIGHTNESS);
  return { color: COLOR.skyGlow, alpha: MAX_GLOW * height, additive: true };
}
