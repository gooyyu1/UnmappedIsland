/**
 * Documents/UI のモック（ScreenLayout_Mock.html・StartScreen_Mock.html）のCSSに対応する
 * 配色・寸法トークン。モック側の値を変えたときはここも合わせる。
 */

/** カードのアスペクト比は58:89（ポーカーサイズ）。寸法は全てu単位（ScreenLayout.md 寸法トークン節）。 */
export const SIZE = {
  cardWidth: 210,
  cardHeight: 322,
  laneHeight: 352,
  gap: 12,
  margin: 6,
  /** オプション・フィルターボタンの間隔。誤タップを防ぐためカード間ギャップより広い。 */
  barGap: 20,
  iconButton: 88,
  conditionButton: 64,
  radius: 12,
} as const;

export const COLOR = {
  screenBackground: 0xf6f6f6,
  optionsBar: 0xf5e9d5,
  filterBar: 0xe6dcf5,
  fieldArea: 0xd6d6ff,
  locationLane: 0xffe1b3,
  fieldItemLane: 0xd9ffd5,
  handLane: 0xe1dbff,
  characterDisplay: 0xd9f6ff,
  statusArea: 0xe3ffe0,
  situationArea: 0xe8e2d4,

  cardFace: 0xffffff,
  cardBorder: 0x000000,
  /** カードの端を押している間だけ被せる、移動操作のオーバーレイ。 */
  cardEdgeOverlay: 0x1b3a4b,
  laneDivider: 0x000000,

  button: 0xffffff,
  buttonBorder: 0x000000,
  buttonActive: 0x3a3a3a,
  equipmentButton: 0xd6fff0,
  injuryButton: 0xffe0d6,

  flipDigit: 0x3a3a3a,
  flipDigitRing: 0x6b6b6b,
  weatherChip: 0xfff2e0,

  statusBarTrack: 0xdddddd,
  statusBarTrackBorder: 0x999999,
  statusBarFill: 0x4caf50,

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

  titleGradientTop: 0x123544,
  titleGradientMiddle: 0x2f7480,
  titleGradientBottom: 0xd9c48a,

  text: 0x111111,
  textOnDark: 0xffffff,
  textMuted: 0x666666,
} as const;

/** Phaserのテキストスタイルは色を文字列で受け取るため、16進数値をCSS色へ直す。 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const FONT_FAMILY = '"Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
