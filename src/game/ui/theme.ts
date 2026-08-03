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
  conditionButton: 64,
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
  equipmentButton: 0xd6fff0,
  injuryButton: 0xffe0d6,
  mapButton: 0xdbe7ff,

  /** 日時の桁の紙。画像（flip_digit.png）が読めなかったときの図形フォールバックにも使う。 */
  flipDigit: 0xffffff,
  flipDigitRing: 0x6b6b6b,
  weatherChip: 0xfff2e0,

  statusBarTrack: 0xdddddd,
  statusBarTrackBorder: 0x999999,
  // ステータスバーの塗りは、域（alert）の深刻さで安全域の緑から致命的域の茶へ寄っていく。
  // 満たされ具合の向きはステータスによって逆なので、塗りの長さではなく色が良し悪しを表す。
  statusBarFillSafe: 0x4caf50,
  statusBarFillFatal: 0x9c6b3f,
  /** 減った分を遅れて縮める帯（ProgressBar）。 */
  statusBarLag: 0xd93025,
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
  const mix = (shift: number): number => {
    const from = (COLOR.statusBarFillSafe >> shift) & 0xff;
    const to = (COLOR.statusBarFillFatal >> shift) & 0xff;
    return Math.round(from + (to - from) * severity) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

/** Phaserのテキストスタイルは色を文字列で受け取るため、16進数値をCSS色へ直す。 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const FONT_FAMILY = '"Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
