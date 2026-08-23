import type { AlertLevel } from '../../domain/AlertLevel';
import type { BoxStyle, ShapeDefaults } from '../../ui/shapes';
import type { ScreenMetrics } from './ScreenMetrics';
import { ALERT_LEVELS } from '../../domain/AlertLevel';
import type { GaugeEnd } from '../../domain/PropertyDef';

/**
 * docs/ui のモック（ScreenLayout_Mock.html・StartScreen_Mock.html）のCSSに対応する
 * 配色・寸法トークン。モック側の値を変えたときはここも合わせる。
 */

/**
 * 汎用の図形（src/ui/shapes）へ起動時に入れる意匠（main.ts）。
 *
 * **落ち影は2枚重ねる。** ぼかせないので1枚だと輪郭がそのまま出て貼り絵に見える。ずらし幅の1倍と
 * 2倍の位置に、濃さを落としながら置く。
 */
export const SHAPE_LOOK: ShapeDefaults = {
  shadowLayers: [
    [1, 0.3],
    [2, 0.12],
  ],
  dashLengthRatio: 6,
};

/** カードのアスペクト比は58:89（ポーカーサイズ）。寸法は全てu単位（ScreenLayout.md 2節 寸法トークン）。 */
export const SIZE = {
  cardWidth: 205,
  cardHeight: 320,
  laneHeight: 352,
  gap: 12,
  margin: 6,
  /**
   * 横型のダッシュボード列幅（ScreenLayout.md 10節 横型レイアウト）。日時のフリップカード（406u）が
   * 背景のページの紙の内側に収まる幅で決まる。左右パディング20u×2と、フィールドエリア側の紙の余白
   * （INFORMATION_PAPER_INSET.field）を足した幅が下限。
   */
  dashboardColumn: 478,
  /**
   * 横型の右サイドバー幅（オプション／フィルター共用）。バーの厚み（アイコンボタン88 + 左右パディング
   * 16×2）と同じにして、ボタン左右の余白が広くなりすぎないようにする。
   */
  sidebar: 120,
  /** オプション・フィルターボタンの間隔。誤タップを防ぐためカード間ギャップより広い。 */
  barGap: 20,
  iconButton: 88,
  /**
   * オプション・フィルターボタンに載せる絵のキャンバス（正方形）。ボタンが正方形なので、
   * スロットボタンの横長キャンバスと違って縦横で使える量が変わらない。
   */
  iconButtonArt: 80,
  /** 状況アイコン（条件）。今の状態を示すだけなので、押せるボタンの中では最も小さい。 */
  conditionButton: 48,
  /**
   * 地図・装備・怪我・レシピのボタン。ポートレイトの右の列に縦積みする。
   *
   * **列の高さを等分せず、内容量ぶんに留める。** 文字を持たないボタンなので、絵より広い面を
   * 取ると、絵ではなく面の方が目に入る。
   */
  slotButton: { width: 168, height: 72 },
  /**
   * 4つのボタンの列が、上下に空ける余白。**間隔はこの余白の残りから決まる**（PlayScene.addSlotButtonColumn）。
   *
   * 隣のポートレイトは上端から10.5u（FRAME_INSET + FRAME_SIDE）を枠に使うので、**人はカードの
   * 上端ではなく枠の内側を上端として読む**。余白を持たないとボタンだけが先に始まり、列が高く
   * はみ出して見えた。枠と同じ10.5uでは揃うだけなので、内側へ入る量まで空ける。
   */
  slotButtonColumnInset: 16,
  /**
   * 地図・装備・怪我・レシピのボタンに載せるアイコンのキャンバス。ボタンの中央へ置く。
   *
   * **4枚とも同じ大きさで敷く。** 物の大小——開いた地図 > 開いた本 > Tシャツ > 巻いた包帯——は絵の側が持ち、
   * UIはそれを測らない（測って揃えると差が消える）。**正方形にしないのも同じ理由**で、正方形だと
   * 平たい物ほど小さくしか描けない（地図が高さの半分しか使えなかった）。
   *
   * **大きさの上限は一番背の高い開いた地図（104×58u）が決める。** 4枚共通の倍率なので、地図が
   * ボタンからはみ出す手前で頭打ちになる。
   */
  slotButtonIcon: { width: 145, height: 64 },
  radius: 12,
  /**
   * スクロールバーの厚みと、送られるカードの下端との間隔（ScreenLayout.md 7.4節 スクロールバー）。
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
  /**
   * 製作中オブジェクトのカードにかぶせる青（CardView.md 10節 製作中オブジェクトのカード）。
   * 濃さはCardが持つ（IN_PROGRESS_VEIL_ALPHA）。
   *
   * **どのカードにも同じ色をかぶせるので、物の色として読まれない色相を選ぶ。** 木にも石にも
   * 掛かる覆いなので、素材の色（茶・灰・緑）と重なる色相だと「そういう物」に見えてしまう。
   *
   * **下地より明るい青にする。** 暗い覆いは押下中の陰（pressedShade・cardEdgeOverlay）と同じ
   * 見え方になり、そのカードの性質ではなく今の操作を表しているように読める。
   */
  cardInProgress: 0x6ec1ff,
  /**
   * 加熱されているカードにかぶせる覆い（CardView.md 15節）。濃さはCardが持つ（COOKING_VEIL_ALPHA）。
   *
   * **青写真の青とは逆に、暗い熾の色にする。** 火にかかっている物は炉の中で暗く沈んで見えるもので、
   * 「まだ物になっていない」を言う青と違い、こちらは覆いそのものが火の中を表す。暗いので、上に
   * 載る残り時間の文字は白（textOnDark）になる。
   */
  cardCooking: 0x3f1c07,
  /**
   * 状態を言う覆いの文字の色（気を失った動物の「気絶」）。**警告の赤をそのまま使う**——放っておくな
   * ではなく「今こうなっている」を言うものだが、一目で異常だと分かる強さが要る（CardView.md 9.1節）。
   */
  cardOverlayText: 0xd6303a,
  /** カードの端を押している間だけ被せる、移動操作のオーバーレイ。 */
  cardEdgeOverlay: 0x1b3a4b,
  /** ドラッグ中に、落とせる先を示す枠。 */
  cardDropTarget: 0x1b7a5c,
  /** ドラッグ中に、受け入れられるカードのふちを光らせる色。今の落とし先（緑）とは色相を分ける。 */
  cardDropAccept: 0xffc23e,
  laneDivider: 0x000000,
  /**
   * 材料の枠の縁（CardView.md 13節 製作中オブジェクトの材料）。今の工程で要る枠を暖色、後の工程で
   * 要る枠を寒色にして、どちらを先に埋めればよいかを色相で分ける。
   *
   * **落とし先の枠（cardDropTarget・cardDropAccept）とは色相を分ける。** ドラッグ中は両方が同時に
   * 出るので、同じ色相だと「今どこへ落ちるか」と「何の枠か」が混ざる。
   */
  cellCurrentStep: 0xe2571f,
  cellLaterStep: 0x5a6b8c,
  /** カードへ重ねる文字の下に敷く板。地の明るさによらず文字が読めるよう、暗い板に明るい文字を載せる。 */
  cellOverlayPlate: 0x101418,
  /**
   * レーンのスクロールバー。明るい地にも暗い地にも敷かれるので、暗いトラックに明るいつまみを
   * 載せて、地の明るさに関わらずつまみが読めるようにする。
   */
  scrollBarTrack: 0x101418,
  scrollBarThumb: 0xffffff,

  button: 0xffffff,
  buttonBorder: 0x000000,
  /**
   * 紙の上に置かれるボタンの枠線。スロットボタン（染めた紙）とオプションバー（生成りの帯）が使う。
   *
   * **黒は使わない。** 黒い細線を引くと、紙の絵の中に画面部品の線が1本混じって見える。カードの縁の
   * 線が種別ごとの暗い色であるのと同じで、地に合う暗い色にする。
   */
  paperButtonBorder: 0x5a4632,
  /** 同じ枠線の、フィルターバー（藤色）用。暖色のままでは地から浮くので、色相だけを地へ寄せる。 */
  filterButtonBorder: 0x4a4258,
  /** 押下中のボタンへ重ねる覆い。濃さはButtonが持つ（PRESSED_SHADE）。 */
  pressedShade: 0x000000,
  buttonActive: 0x3a3a3a,
  /** 実行中などで今は押せないボタン。 */
  buttonDisabled: 0xdedede,
  /**
   * 地図・装備・怪我・レシピのボタンの地。**カードの紙をこの色で染めた絵**を敷く（染めた紙）。平らな塗りに
   * 淡い色を置くとパステルに見え、汚れと滲みのある他の絵から浮くため。
   *
   * くすませる度合いは**染みが見えて、かつ押せるボタンに見える**あいだで決める。暗くしすぎると、
   * 本のページに刷られた図版のように見えて押せる物に見えない。
   *
   * **染めは絵に焼いてある**（recipes/slot_button_paper.json の tint）。ここの値はその絵と揃え、
   * 変えるときは絵も作り直す。ここに残す平らな塗りは、絵が読めなかったときの地になる。
   */
  equipmentButton: 0xc7d4c1,
  injuryButton: 0xd7c2b5,
  mapButton: 0xc2cdd8,
  recipeButton: 0xd4cdb2,

  /** 日時の桁の紙。画像（flip_digit.png）が読めなかったときの図形フォールバックにも使う。 */
  flipDigit: 0xffffff,
  flipDigitRing: 0x6b6b6b,
  /**
   * 空の絵がまだ無い天気で、状況エリアの窓に敷く板。天気そのものは表さないが、白い天候名と
   * 白い桁の紙がどちらも読める暗さにする（絵が入れば空の暗さがその役目を引き継ぐ）。
   */
  weatherPanel: 0x7d94a4,

  /** 海図風の下地（羊皮紙の薄茶）と、島の輪郭のごく薄い線（MapWindow）。 */
  chartPaper: 0xf3ead4,
  chartLine: 0xcdbb92,

  /** 地図に引く道のインク（MapWindow）。 */
  roadInk: 0x8a6f4f,

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

  // ゲージの塗り（gaugeColorFor）。満ち足りた端の緑から尽きた端の赤へ、琥珀を経て寄せる。
  // neutralは良し悪しを言わない端（工程の進捗）の1色。
  durabilityFull: 0x4caf50,
  durabilityHalf: 0xf2b01e,
  durabilityEmpty: 0xd93025,
  gaugeNeutral: 0x4caf50,
  /**
   * 色（colorプロパティ）を宣言していない液体の、中身のバーの塗り。何色か分からなくても、
   * 中身があること自体は見えるようにする。
   */
  cardFillUnknown: 0x9aa0a6,
  /** 直前の行動でその値が増えた／減ったことを示す三角（StatusBar）。 */
  statusIncreased: 0x2ecc40,
  statusDecreased: 0xd93025,
  /** 危険域のバーの枠と、致命的域のバー・画面全体の枠（明滅させる、StatusArea.md）。 */
  statusAlertDanger: 0xffc400,
  statusAlertFatal: 0xd93025,
  // 警戒の枠の下に敷く暗い線。塗りの色が濃いと明るい枠が沈むため、必ず暗い線の上に載せる。
  statusAlertOutline: 0x1b1b1b,

  /** 時間経過のドーナツグラフ（画面に重ねて出すため、暗い輪に明るい塗りを載せる）。 */
  progressRingTrack: 0x1b3a4b,
  progressRingFill: 0x4caf50,

  /**
   * 経過時間の数字。移動の暗転中も輪ごと暗幕の手前に残る（CardInteraction.md 9節）ので、
   * 明るいカードの上でも暗幕の上でも読めるよう、塗りと縁取りの明暗を離す。
   * 塗りが純白ではなくヘッダと同じ生成りなのは、画面全体が古い紙の色で組まれているため。
   */
  progressRingElapsed: 0xf5e9d5,
  progressRingElapsedOutline: 0x1b3a4b,

  headerBar: 0xf5e9d5,
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
 * ステータス（荷重）が同じ画面に並ぶので、長さだけでは良し悪しが読めません（StatusArea.md 7節）。深刻さを引くのは値の位置ではなく域なので、まだ安全域なら満タンでなくても緑のままです。
 */
export function statusFillColorFor(alert: AlertLevel): number {
  const severity = ALERT_LEVELS.indexOf(alert) / (ALERT_LEVELS.length - 1);
  return mixColor(COLOR.statusBarFillSafe, COLOR.statusBarFillFatal, severity);
}

/**
 * 域に応じた警戒の枠の色（StatusArea.md）。明滅させない域ではundefinedで、枠そのものを出さない。
 * 塗り（statusFillColorFor）が深刻さを連続的に表すのに対し、枠は危険域から上でだけ立つ。
 */
export function alertBorderColorFor(alert: AlertLevel): number | undefined {
  if (alert === 'danger') return COLOR.statusAlertDanger;
  if (alert === 'fatal') return COLOR.statusAlertFatal;
  return undefined;
}

/** 増えた分の帯を、塗りからどれだけトラック寄りへ薄めるか（fadedFill）。 */
const BAND_FADE = 0.55;

/**
 * 増えた分の帯の色（StatusArea.md）。塗りそのものをトラック側へ薄めた色にするのは、
 * **これから満ちる分**を表すためです。固定の1色を置くと、塗りの色が別々のバー——水は青、油は黄色——で
 * 帯だけが同じ色になり、何が増える途中なのか読めなくなります。減った分の赤（statusBarLag）が塗りの色に
 * よらず同じなのは対照的ですが、失われたものはもう塗りではないので、こちらは色を共有しません。
 */
export function fadedFill(fill: number): number {
  return mixColor(fill, COLOR.statusBarTrack, BAND_FADE);
}

/** 琥珀へ寄せ切る位置。ここを境に、端の色→琥珀と琥珀→もう一方の端の2区間へ分ける。 */
const GAUGE_HALF_RATIO = 0.5;

/** ゲージの端の見せ方（GaugeEnd）に対応する色。 */
function gaugeEndColor(end: GaugeEnd): number {
  return end === 'good' ? COLOR.durabilityFull : end === 'bad' ? COLOR.durabilityEmpty : COLOR.gaugeNeutral;
}

/**
 * ゲージ（CardView.md 8節）の塗りの色。**両端の見せ方（GaugeEnd）と今の割合だけで決まる**ので、
 * 耐久度・炉の残り薪・残っている傷・意識・工程の進捗が1つの関数で塗れる。
 *
 * ステータスバーと違って域（alert）ではなく値そのものから引く。ゲージが映すのは「どちらの端へ
 * どれだけ寄っているか」で、段を分けても同じ順序にしかならないため。
 *
 * **両端が同じ見せ方なら1色**（工程の進捗のように良し悪しを言わない量）。違うときは中間に琥珀を
 * 通す——両端を直接混ぜると中間が濁った茶になり、致命的域のステータスバーと見分けが付かなくなる。
 */
export function gaugeColorFor(ratio: number, atMin: GaugeEnd, atMax: GaugeEnd): number {
  const from = gaugeEndColor(atMin);
  const to = gaugeEndColor(atMax);
  if (from === to) return from;

  const clamped = Math.min(1, Math.max(0, ratio));
  return clamped < GAUGE_HALF_RATIO
    ? mixColor(from, COLOR.durabilityHalf, clamped / GAUGE_HALF_RATIO)
    : mixColor(COLOR.durabilityHalf, to, (clamped - GAUGE_HALF_RATIO) / (1 - GAUGE_HALF_RATIO));
}

/** 2色の間をtの割合で混ぜる（成分ごとの線形補間）。 */
export function mixColor(from: number, to: number, t: number): number {
  const channel = (shift: number): number => {
    const start = (from >> shift) & 0xff;
    const end = (to >> shift) & 0xff;
    return Math.round(start + (end - start) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * カードの枠の色を決める種別（CardView.md 2節 枠の色は種別で変える）。
 *
 * **場所を映す札（現在地・道）は、設置物と別の色にする。** どちらも土地の名前と絵を出すので、同じ
 * レーンに並ぶ設置物とは形では見分けが付かない。現在地と道は同じ色でよい——**歩いて行けるかどうかは
 * 桟の矢印が言い、色は「場所の札か」だけを言う**。
 *
 * **アイテムは用途で分ける**（食事・入れ物・道具）。ゲーム内の物の大半はアイテムなので、1色のままだと
 * レーンが同じ色で埋まる。素材に色を当てないのは、素材が物の性質ではなくレシピの中での役割だから
 * ——尖った石は道具でありながら石斧の素材でもある。**残り全部が素材**で、それがitemの色になる。
 */
export type CardKind =
  'location' | 'fixture' | 'item' | 'food' | 'container' | 'tool' | 'injury' | 'animal' | 'character';

/**
 * 枠の色を決める見た目の分類。種別に、製作中オブジェクトの**青写真**を足したもの。
 *
 * 青写真は種別と並ぶ選択肢ではなく、**種別を覆って**掛かる（作りかけの籠は青写真であってアイテムの
 * 枠を持たない）。物の型が決める種別（CardKind）とは別の型にしてあるのはそのため。
 */
export type CardFrameKind = CardKind | 'blueprint';

/** 分類ごとの枠の面と縁の色。タイトルの板と文字の色はここから引く（cardFrameColors）。 */
const CARD_FRAME_FACE: Readonly<Record<CardFrameKind, { readonly face: number; readonly line: number }>> = {
  // 場所を映す札（現在地と道）の琥珀。
  location: { face: 0xce943e, line: 0x7a5018 },
  fixture: { face: 0x68804e, line: 0x3a4a2a },
  item: { face: 0xa88a64, line: 0x6e563a },
  // 食事は黄。空いていた色相であるうえ、実りの色として意味も持てる（動物の紫と違う点）。**道の琥珀
  // （H36）から色相を離す**——設置物レーンへ置いた食料が道と並ぶため。彩度で開ける茶（S0.40）と違い、
  // 琥珀とは彩度も明度も近いので、離せるのは色相だけ。
  food: { face: 0xd2be40, line: 0x7a6414 },
  // 入れ物は青緑。液体の容器も同じ色で、水が入っているかは中身のバーが液体自身の色で言う（8.3節）。
  container: { face: 0x3f7f76, line: 0x1f453f },
  // 道具は石と鋼の灰。色相を1つも使わずに済むので、他の色を圧迫しない。
  tool: { face: 0x8a8a86, line: 0x4a4a47 },
  injury: { face: 0xae5c54, line: 0x68302c },
  // 動物であることを言い当てる色は無い（血の赤は怪我、毛皮の茶はアイテム、緑は設置物、青は
  // キャラクタが既に取っている）ので、残っている色相のうち他の4色から最も遠い紫を取る。
  // ここで要るのは意味ではなく、同じレーンに並んだときに一目で違うことなので。
  animal: { face: 0x7d5a86, line: 0x452f4c },
  character: { face: 0x6c7c9c, line: 0x38445e },
  // キャラクタの青より彩度を上げる。並んだときに「くすんだ青」と「青写真の青」が混ざらない差を取る。
  blueprint: { face: 0x3f7ec2, line: 0x1d4374 },
};

/**
 * タイトルの板を、枠の面から縁の側へどれだけ暗くするか。**枠より暗くする**——枠から強調したいのは
 * 絵であって、名前は枠の一部（CardView.md 2節 枠の色は種別で変える）。
 */
const CARD_PLATE_SHADE = 0.55;

/** 板の文字を、紙の白から枠の面の側へどれだけ染めるか（板の上で浮かせないため）。 */
const CARD_PLATE_INK_TINT = 0.15;

/** カードの紙の地の色（card_frame.pngの実測）。板の文字はこれを枠の色で染めた色になる。 */
const CARD_PAPER = 0xfcf8e6;

/** 枠1つぶんの色（cardFrameColors）。 */
export interface CardFrameColors {
  /** 桟の面。 */
  readonly face: number;
  /** 枠と窓の縁をなぞる線。 */
  readonly line: number;
  /** タイトルの板。 */
  readonly plate: number;
  /** 板に載せる名前の文字。 */
  readonly ink: number;
}

export function cardFrameColors(kind: CardFrameKind): CardFrameColors {
  const { face, line } = CARD_FRAME_FACE[kind];
  return {
    face,
    line,
    plate: mixColor(face, line, CARD_PLATE_SHADE),
    ink: mixColor(CARD_PAPER, face, CARD_PLATE_INK_TINT),
  };
}

export const FONT_FAMILY = '"Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif';

/**
 * 一覧の行として押せる台紙の見た目（シナリオ選択・保存スロット・設定）。**画面をまたいで同じ行に
 * 見えていること自体が意匠**なので、色も縁も1箇所で決める。破線や薄さを足す行は、これを広げて使う。
 */
export function rowPlateStyle(metrics: ScreenMetrics): BoxStyle {
  return {
    fill: COLOR.cardFace,
    border: COLOR.cardBorder,
    borderWidth: metrics.linePx(2),
    radius: metrics.px(SIZE.radius),
  };
}
