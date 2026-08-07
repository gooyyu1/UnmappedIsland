import type { AlertLevel } from '../../domain/defs/AlertLevel';
import { ALERT_LEVELS } from '../../domain/defs/AlertLevel';

/**
 * docs/ui のモック（ScreenLayout_Mock.html・StartScreen_Mock.html）のCSSに対応する
 * 配色・寸法トークン。モック側の値を変えたときはここも合わせる。
 */

/** カードのアスペクト比は58:89（ポーカーサイズ）。寸法は全てu単位（ScreenLayout.md 寸法トークン節）。 */
export const SIZE = {
  cardWidth: 205,
  cardHeight: 320,
  laneHeight: 352,
  gap: 12,
  margin: 6,
  /** オプション・フィルターボタンの間隔。誤タップを防ぐためカード間ギャップより広い。 */
  barGap: 20,
  iconButton: 88,
  /** 状況アイコン（条件）。今の状態を示すだけなので、押せるボタンの中では最も小さい。 */
  conditionButton: 48,
  /**
   * 地図・装備・怪我のボタン。ポートレイトの右の列に縦積みする。
   *
   * **列の高さを3等分せず、内容量ぶんに留める。** 文字を持たないボタンなので、絵より広い面を
   * 取ると、絵ではなく面の方が目に入る。
   */
  slotButton: { width: 168, height: 84 },
  /**
   * 地図・装備・怪我のボタンに載せるアイコンのキャンバス。ボタンの中央へ置く。
   *
   * **3枚とも同じ大きさで敷く。** 物の大小——開いた地図 > Tシャツ > 巻いた包帯——は絵の側が持ち、
   * UIはそれを測らない（測って揃えると差が消える）。**正方形にしないのも同じ理由**で、正方形だと
   * 平たい物ほど小さくしか描けない（地図が高さの半分しか使えなかった）。
   */
  slotButtonIcon: { width: 136, height: 60 },
  radius: 12,
  /**
   * スクロールバーの厚みと、送られるカードの下端との間隔（ScreenLayout.md スクロールバー節）。
   * レーンではこの位置がカードの下の余白（16u）に収まり、区切りの帯がかぶる3uにも掛からない。
   */
  scrollBar: 8,
  scrollBarGap: 3,
} as const;

export const COLOR = {
  screenBackground: 0xf6f6f6,
  /** 画面の外側（Phaserのキャンバスの地の色）。UIを置かない余りをここで塗り潰す。 */
  outsideScreen: 0x101418,
  optionsBar: 0xf5e9d5,
  filterBar: 0xe6dcf5,
  fieldArea: 0xd6d6ff,
  fixtureLane: 0xffe1b3,
  itemLane: 0xd9ffd5,
  handLane: 0xe1dbff,
  /** 情報エリアの下地。背景画像（本のページ）の紙の色で、絵が届かない範囲を埋める。 */
  informationPaper: 0xf5f0e1,

  /** スロットの子ウィンドウ（装備・怪我・コンテナ）の中身を並べる帯。 */
  slotWindowLane: 0xf2eee6,

  cardFace: 0xffffff,
  cardBorder: 0x000000,
  /** カードの端を押している間だけ被せる、移動操作のオーバーレイ。 */
  cardEdgeOverlay: 0x1b3a4b,
  /** ドラッグ中に、落とせる先を示す枠。 */
  cardDropTarget: 0x1b7a5c,
  /** ドラッグ中に、受け入れられるカードのふちを光らせる色。今の落とし先（緑）とは色相を分ける。 */
  cardDropAccept: 0xffc23e,
  laneDivider: 0x000000,
  /**
   * レーンのスクロールバー。明るい地にも暗い地にも敷かれるので、暗いトラックに明るいつまみを
   * 載せて、地の明るさに関わらずつまみが読めるようにする。
   */
  scrollBarTrack: 0x101418,
  scrollBarThumb: 0xffffff,

  button: 0xffffff,
  buttonBorder: 0x000000,
  buttonActive: 0x3a3a3a,
  /** 実行中などで今は押せないボタン。 */
  buttonDisabled: 0xdedede,
  /**
   * 地図・装備・怪我のボタンの地。**カードの紙を敷いたうえに、この色を乗算で載せる**（染めた紙）。
   * 平らな塗りに淡い色を置くとパステルに見え、汚れと滲みのある他の絵から浮くため。色は染みが
   * 見える程度にくすませる。絵が読めなかったときは、この色の平らな塗りに落ちる。
   */
  equipmentButton: 0xb9c9b2,
  injuryButton: 0xc9b2a4,
  mapButton: 0xb2bfcd,

  /** 日時の桁の紙。画像（flip_digit.png）が読めなかったときの図形フォールバックにも使う。 */
  flipDigit: 0xffffff,
  flipDigitRing: 0x6b6b6b,
  /**
   * 空の絵がまだ無い天気で、状況エリアの窓に敷く板。天気そのものは表さないが、白い天候名と
   * 白い桁の紙がどちらも読める暗さにする（絵が入れば空の暗さがその役目を引き継ぐ）。
   */
  weatherPanel: 0x7d94a4,
  weatherPanelBorder: 0x000000,

  /** 雨の筋と、日射に応じてフィールドエリアへかぶせる翳り・輝き（WeatherOverlay）。 */
  rain: 0xe8f2ff,
  skyShade: 0x0a1420,
  skyGlow: 0xfff0c8,

  statusBarTrack: 0xdddddd,
  statusBarTrackBorder: 0x999999,
  // ステータスバーの塗りは、域（alert）の深刻さで安全域の緑から致命的域の茶へ寄っていく。
  // 満たされ具合の向きはステータスによって逆なので、塗りの長さではなく色が良し悪しを表す。
  statusBarFillSafe: 0x4caf50,
  statusBarFillFatal: 0x9c6b3f,
  /** 減った分の帯（ProgressBar。増えた分はfadedFillが塗りから引く）。 */
  statusBarLag: 0xd93025,

  // 耐久度バーの塗り（durabilityColorFor）。満タンの緑から尽きる直前の赤へ、琥珀を経て寄せる。
  durabilityFull: 0x4caf50,
  durabilityHalf: 0xf2b01e,
  durabilityEmpty: 0xd93025,
  /**
   * 色（colorプロパティ）を宣言していない液体の、中身のバーの塗り。何色か分からなくても、
   * 中身があること自体は見えるようにする。
   */
  cardFillUnknown: 0x9aa0a6,
  /** 直前の行動でその値が増えた／減ったことを示す三角（StatusBar）。 */
  statusIncreased: 0x2ecc40,
  statusDecreased: 0xd93025,
  /** 危険域のバーの枠と、致命的域のバー・画面全体の枠（明滅させる、ScreenLayout.md ステータスエリア節）。 */
  statusAlertDanger: 0xffc400,
  statusAlertFatal: 0xd93025,
  // 警戒の枠の下に敷く暗い線。塗りの色が濃いと明るい枠が沈むため、必ず暗い線の上に載せる。
  statusAlertOutline: 0x1b1b1b,

  /** 時間経過のドーナツグラフ（画面に重ねて出すため、暗い輪に明るい塗りを載せる）。 */
  progressRingTrack: 0x1b3a4b,
  progressRingFill: 0x4caf50,

  headerBar: 0xf5e9d5,
  slotPortrait: 0xffe5d1,
  slotDelete: 0xfff0f0,
  randomButton: 0xfff2e0,
  primaryButton: 0xffd77a,
  primaryButtonText: 0x1b3a4b,
  footerBar: 0xf0f0f0,
  selectedOptionBorder: 0x1b7a5c,
  selectedOptionFace: 0xe3fff0,
  dangerButton: 0xff5252,
  modalOverlay: 0x000000,
  /** 場面転換の暗幕（Curtain）。画面の外側と同じ暗さで落とす。 */
  curtain: 0x101418,

  titleGradientTop: 0x123544,
  titleGradientMiddle: 0x2f7480,
  titleGradientBottom: 0xd9c48a,

  text: 0x111111,
  textOnDark: 0xffffff,
  textMuted: 0x666666,
} as const;

/**
 * 域（GameElementDefinition.md 6.4節のalert）に応じたステータスバーの塗りの色。安全域の緑から、
 * 致命的域の茶へ深刻さのぶんだけ寄せる。
 *
 * **色が良し悪しを表すのは、塗りの長さでは表せないため。** 満タンが良いステータス（満腹度）と悪い
 * ステータス（荷重）が同じ画面に並ぶので、長さだけでは良し悪しが読めません（ScreenLayout.md
 * ステータスエリア節）。深刻さを引くのは値の位置ではなく域なので、まだ安全域なら満タンでなくても緑のままです。
 */
export function fillColorFor(alert: AlertLevel): number {
  const severity = ALERT_LEVELS.indexOf(alert) / (ALERT_LEVELS.length - 1);
  return mixColor(COLOR.statusBarFillSafe, COLOR.statusBarFillFatal, severity);
}

/** 増えた分の帯を、塗りからどれだけトラック寄りへ薄めるか（fadedFill）。 */
const BAND_FADE = 0.55;

/**
 * 増えた分の帯の色（ScreenLayout.md ステータスエリア節）。塗りそのものをトラック側へ薄めた色にするのは、
 * **これから満ちる分**を表すためです。固定の1色を置くと、塗りの色が別々のバー——水は青、油は黄色——で
 * 帯だけが同じ色になり、何が増える途中なのか読めなくなります。減った分の赤（statusBarLag）が塗りの色に
 * よらず同じなのは対照的ですが、失われたものはもう塗りではないので、こちらは色を共有しません。
 */
export function fadedFill(fill: number): number {
  return mixColor(fill, COLOR.statusBarTrack, BAND_FADE);
}

/** durabilityHalfへ寄せ切る耐久度。ここを境に、緑→琥珀と琥珀→赤の2区間へ分ける。 */
const DURABILITY_HALF_RATIO = 0.5;

/**
 * 耐久度（0〜1）に応じたバーの塗りの色（ScreenLayout.md カードの状態バー節）。
 *
 * ステータスバーと違って域（alert）ではなく値そのものから引く。耐久度は「どれだけ残っているか」が
 * そのまま深刻さで、段を分けても同じ順序にしかならないため。
 */
export function durabilityColorFor(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return clamped < DURABILITY_HALF_RATIO
    ? mixColor(COLOR.durabilityEmpty, COLOR.durabilityHalf, clamped / DURABILITY_HALF_RATIO)
    : mixColor(
        COLOR.durabilityHalf,
        COLOR.durabilityFull,
        (clamped - DURABILITY_HALF_RATIO) / (1 - DURABILITY_HALF_RATIO),
      );
}

/** 2色の間をtの割合で混ぜる（成分ごとの線形補間）。 */
function mixColor(from: number, to: number, t: number): number {
  const channel = (shift: number): number => {
    const start = (from >> shift) & 0xff;
    const end = (to >> shift) & 0xff;
    return Math.round(start + (end - start) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** Phaserのテキストスタイルは色を文字列で受け取るため、16進数値をCSS色へ直す。 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const FONT_FAMILY = '"Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
