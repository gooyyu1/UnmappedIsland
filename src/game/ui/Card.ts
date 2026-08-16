import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { CardFrameColors, CardKind } from '../looks/theme';
import { cssColor } from '../../util/cssColor';
import { COLOR, FONT_FAMILY, SIZE, cardFrameColors, gaugeColorFor } from '../looks/theme';
import { drawBox } from '../../ui/shapes';
import type { SlotRef } from '../../assets/backgroundArt';
import { cardBackgroundTexture } from '../../assets/backgroundArt';
import { CARD_ART_WIDTH, objectMultiplyTexture, objectTexture } from '../../assets/objectArt';
import { ProgressBar, TRACK_BORDER_WIDTH } from './ProgressBar';
import type { ProgressBarOptions } from './ProgressBar';
import type { AlertLevel } from '../../domain/defs/AlertLevel';
import type { GaugeEnd } from '../../domain/defs/PropertyDef';
import { noteOperation } from '../errorReport';
import { minutesText } from '../looks/durationText';
import { HoldRepeat } from '../../ui/holdRepeat';
import { onPressRelease } from '../../ui/tap';
import { cardFace } from './cardFace';

/**
 * カードの枠の画像のテクスチャキー（実体はsrc/assets/card_frame.png、BootSceneが読む）。
 * カードの寸法（SIZE.cardWidth/cardHeight）はこの画像の比率に合わせてある。
 */
export const CARD_FRAME_TEXTURE = 'card-frame';

/** 空き枠は同じ枠の画像を薄く敷いて表す。 */
const EMPTY_FRAME_ALPHA = 0.35;

/** 中身を持ち出されて、帰ってくる場所を示すだけになった姿の濃さ（CardInteraction.md 2節）。 */
const EMPTIED_ALPHA = 0.3;

/**
 * カードの絵の中で紙そのものが占める範囲（u単位）。絵は410x640pxで、紙は周囲に5pxの余白を空け、
 * 角の半径は20px。カードの実寸は絵の半分なので、u単位へは1/2で直せる
 * （tools/comfyui/card_frame.py の MARGIN / RADIUS、card_art.py の PAPER_RADIUS と揃えること）。
 */
const FRAME_INSET = 2.5;
const FRAME_RADIUS = 10;

/** 枠と、その内側の窓の縁をなぞる線の太さ（u単位）。 */
const BORDER_WIDTH = 1.5;

/**
 * 警戒を知らせる輪郭の太さ（u単位）と、明滅の片道の時間・最も薄いときの濃さ。
 * 枠の縁の線より太くして、明滅していることが形からも読めるようにする（値はProgressBarの警戒の枠と揃える）。
 */
const ALERT_OUTLINE_WIDTH = 5;
const ALERT_BLINK_DURATION_MS = 450;
const ALERT_BLINK_MIN_ALPHA = 0.15;

/**
 * 枠の桟の幅と、タイトルの板の高さ、窓の角の丸み（u単位。CardView.md 1節 カードの枠）。
 *
 * 左右と上は無地の桟で、板はその内側の窓の上端に乗る。下の桟だけは中身で高さが変わるので、
 * ここには持たない（railMetrics）。
 */
const FRAME_SIDE = 8;
const FRAME_HEAD = 22;
const WINDOW_RADIUS = 4;

/** タイトルの板に載せる名前の大きさ（u単位。板の高さの7割。これ以上大きくすると字が板の縁に触る）。 */
const NAME_SIZE = 16;

/**
 * 道のカードが桟に出す矢印の大きさと縁の太さ（u単位）。
 *
 * 絵文字（➡）ではなく図形で描く。字が無いフォントでは豆腐になるうえ、絵文字として描かれると
 * 環境ごとに色も形も変わってしまうため。線ではなく塗り潰した矢羽根にするのは、細い線だとカードを
 * 縮めて並べたときに何の形か読み取れなくなるため。
 */
const ROAD_ARROW_WIDTH = 22;
const ROAD_ARROW_HEIGHT = 11;
const ROAD_ARROW_STROKE = 1.5;

/**
 * 押下中に紙の縁へ重ねる黒枠の太さ（u単位。ドロップ先を示す枠と揃える）。
 * 半透明にはしない——札が透けるとカードらしさが損なわれるため。
 */
const PRESSED_BORDER_WIDTH = 6;

/** 端の操作エリアの高さ（カード高さに対する比）。 */
const EDGE_RATIO = 1 / 6;

/** 押している間だけ出す、端の操作エリアのオーバーレイの濃さと矢印の大きさ（u単位）。 */
const EDGE_OVERLAY_ALPHA = 0.55;
const EDGE_ARROW_SIZE = 44;

/**
 * スタック数を囲む丸の直径・縁の太さ・絵の右上の角から外へはみ出させる量（u単位）。
 * 中の数字の大きさはSTACK_COUNT_SIZE。
 *
 * **はみ出す量はカード間ギャップの半分**（SIZE.gap / 2）で固定する。丸を大きくするときも増やさない
 * ——増やすと隣のカードの側へ食い込む。丸が大きくなるぶんは内側（名前の板の上）へ伸びる。
 */
const STACK_BADGE_SIZE = 42;
const STACK_BADGE_BORDER = 4.5;
const STACK_BADGE_OVERHANG = SIZE.gap / 2;

/**
 * 状態を表す印（手当て済みの怪我など）の大きさと、窓の左下からの余白（u単位）。
 *
 * **絵を差し替えるのではなく、印を重ねる。** 手当ての有無で絵を差し替えると、怪我の部位 × 治療具の
 * 数だけ絵が要る（CardView.md 9節 カードの印）。
 */
const MARK_SIZE = 52;
const MARK_MARGIN = 12;

/**
 * 状態を言う覆いの文字（CardView.md 9.1節）。落ち着いた後の大きさ（u単位）と、白いふちの太さ。
 * ふちは、絵の濃淡の上でも字形が切れないように付ける。
 */
const OVERLAY_SIZE = 34;
const OVERLAY_STROKE = 5;

/**
 * 現れた瞬間の倍率と、大きいまま留まる時間・落ち着くまでの時間（ミリ秒）。**まず大きく出して気付かせ、
 * それから状態の表示として上部へ収まる**——出っぱなしで大きいと絵を潰し、初めから小さいと気付けない。
 */
const OVERLAY_BURST_SCALE = 2.8;
const OVERLAY_HOLD_MS = 900;
const OVERLAY_SETTLE_MS = 280;

/**
 * スタック数の数字の大きさ（u単位）。**名前（16u）にかぶってでも読める大きさを採る**——枚数は
 * カードを開かずに読む値で、小さい画面では名前より先に要る（CardView.md 6節）。
 */
const STACK_COUNT_SIZE = 24;

/**
 * 枠の強調（CellHighlight）の太さ（u単位）。カードの矩形のすぐ外側にある余白——カード間ギャップの
 * 半分であり、レーンの左右の余白（SIZE.margin）とも同じ——をちょうど埋める。
 *
 * **カードの外側へ出すことで、カードが入っても隠れない。** カードより手前へ上げる手もあるが、それだと
 * 縁がスタック数の丸（addStackBadge）を横切る。数字はそのカードが何個かを表すもので、枠がどれかより
 * 先に読めるべきなので、縁の方が下がる。
 */
const CELL_HIGHLIGHT_WIDTH = SIZE.gap / 2;

/** カードへ重ねる文字の大きさ・板の内側の余白・紙の下端からの浮かせ方（u単位）。 */
const CELL_OVERLAY_SIZE = 40;
const CELL_OVERLAY_PADDING = 14;
const CELL_OVERLAY_BOTTOM = 20;
const CELL_OVERLAY_PLATE_ALPHA = 0.72;

/**
 * 製作中オブジェクトのカードにかぶせる青の濃さ（CardView.md 10節 製作中オブジェクトのカード）。
 *
 * **絵の上から重ねる**——`setTint`はCanvasレンダラで効かず（DesignNotes.md PhaserのWebGL専用機能節）、
 * 型ごとに染めた絵を焼くと製作中オブジェクトの数だけ絵が要るため。濃さは、絵が何かは読めるまま
 * 「まだ物になっていない」と分かる境で決める。
 */
const IN_PROGRESS_VEIL_ALPHA = 0.42;

/**
 * 加熱されているカードにかぶせる覆いの色の濃さと、その上に出す残り時間の文字の大きさ・ふちの太さ、
 * 進み具合のバーの寸法と間隔（u単位。CardView.md 15節）。
 *
 * **絵は隠れてよい。** 火にかかっている物は炉の中で見えないもので、そこで読むべきは姿ではなく
 * 「あと何分で変わるか」だから。覆いはその数字を絵の濃淡から浮かせるためにも要る。
 *
 * 文字は名前（16u）よりずっと大きく取る。焦げるまでを測る数字なので、開かず流し見して読めなければ
 * 意味がない。バーは桟のバー（12u）より太い——絵の上に1本だけ出るので、細さで格を下げる相手がいない。
 */
const COOKING_VEIL_ALPHA = 0.62;
const COOKING_TEXT_SIZE = 30;
const COOKING_TEXT_STROKE = 5;
const COOKING_BAR_HEIGHT = 15;
const COOKING_BAR_MARGIN = 18;
const COOKING_BAR_GAP = 8;

/**
 * 桟に積む状態バーの高さ・間隔と、絵とバーの間の余白（u単位）。
 *
 * どの種類も同じ寸法にする。**どれが主要情報かはカードごとに違う**——道具にとっての耐久度と
 * 入れ物にとっての容量は、どちらもそのカードの主役なので、太さで格を付けない。
 *
 * 左右は持たない。バーは窓（windowSpan）に合わせて引く——桟とその上の絵は縦に隣り合うので、
 * 端が揃っていないと桟だけがはみ出して見える。バーの下も持たない（railMetrics）。
 */
const RAIL_BAR_HEIGHT = 12;
const RAIL_BAR_GAP = 2;
const RAIL_PAD = 4.5;

/** 移動先のレーンがカードのどちら側にあるか。 */
export type CardEdgeDirection = 'up' | 'down';

/** 端の向き（上が先）。カードが出す端はこの順で調べる。 */
export const EDGE_DIRECTIONS: readonly CardEdgeDirection[] = ['up', 'down'];

/**
 * カードの端（上下1/6）を押したときの操作。1回の呼び出しで束のうち1つが動く。
 * 押し続けている間は繰り返し呼ばれる（addEdge参照）。
 */
export interface CardEdgeAction {
  readonly direction: CardEdgeDirection;
  readonly onTap: () => void;
}

/**
 * 桟へ積むバー1本の内容（CardView.md 8節）。**カードのバーはすべてこの形**——プロパティが
 * `gauge`として宣言したもの（耐久度・炉の残り薪・残っている傷・意識・工程の進捗）も、入れ物と
 * 中身の関係から出るもの（中身の残量・詰まり具合・材料の充足）も、違うのは両端の見せ方と鍵だけ。
 * カード側はどれが何かを知らず、渡された順に積む。
 */
export interface CardGauge {
  /**
   * このバーが映しているものの識別子。**同じものを映すバーを差し替えの前後で同一と見なす鍵**で、
   * これが一致する間はバーを作り直さずに値だけを差し替える（変化の帯が途切れないようにするため）。
   *
   * プロパティのゲージはプロパティ名そのもの。入れ物と中身から出るバーは`@`で始まる名前を使う
   * （YAMLの識別子とは決して衝突しない、PlayScreenViewのBUILTIN_GAUGE_KEYS）。
   */
  readonly key: string;

  /** バーの満たされ具合（0〜1）。 */
  readonly ratio: number;

  /**
   * 端から引くのではなくこの色そのもので塗る（中身のバーのように、良し悪しではなく**物の色**を
   * 映すバーだけが渡す）。省略すると両端の見せ方から引く（gaugeColorFor）。
   */
  readonly color?: number;

  /** rangeの下限・上限に居るときの見せ方（GaugeDef）。塗りの色はこの2つだけで決まる。 */
  readonly atMin: GaugeEnd;
  readonly atMax: GaugeEnd;

  /** 増えるほど悪い値か（GaugeDef.worsensUpward）。増えた分の帯をどちら向きに出すかが変わる。 */
  readonly worsensUpward: boolean;
}

/**
 * 加熱が進んでいること（CardView.md 15節）。**進んでいる間だけ渡す**ので、持たないカードには
 * 覆いも数字も出ない——火から出せば消え、火が消えても消える。
 */
export interface CardCooking {
  /** 変わる（焼き上がる・焦げる）までの進み具合（0〜1）。 */
  readonly ratio: number;

  /** 変わるまでの残りのゲーム内時間（分）。 */
  readonly minutes: number;
}

/** カード1枚の表示内容と操作。 */
export interface CardContent {
  readonly icon: string;
  readonly name: string;
  /**
   * 内容を差し替えたときに「前と同じカード」だと分かるための識別子（映しているインスタンスのID）。
   * 1枚が複数のインスタンス（スタック）を表すことがあるので集合で持ち、1つでも重なれば同じカードと
   * みなす。省略したカードは差し替えのたびに別のカードとして扱われる。
   */
  readonly identity?: readonly number[];
  /**
   * この枠が帰りを待っているインスタンス——**今は別の場所に出ている**もの（子ウィンドウが借りた1枚、
   * Windows.md 1.1節）。identityには入らない（在るのはあちら側）が、帰り着いたときに同じ札として
   * 繋がるよう、枠はこれを名乗って待つ。1つも在らなくなった枠が薄い印になるのはこのため。
   */
  readonly awaited?: readonly number[];
  /** 1枚が映しているインスタンスの数。2以上のときだけ、右上に丸で囲んだ数字として出す。 */
  readonly count?: number;
  /**
   * 絵を引くためのobject_defの識別子（objectArt参照）。その絵があれば枠の上に重ねて描き、
   * 無ければiconの絵文字で代用する。
   */
  readonly art?: string;
  /**
   * このカードが今在るスロット（backgroundArt参照）。**そのカードが何の上に在るか**——設置物なら
   * 土地の`fixtures`、怪我なら負った本人の`injuries`——を、地として絵の下に敷く。絵が無ければ紙のまま。
   */
  readonly background?: SlotRef;
  /** カード全体を押したときの動作。持たないカードは押せない（押すと子ウィンドウを開くロケーションカード等）。 */
  readonly onTap?: () => void;
  /**
   * 端だけを押したときの動作（向きごとに1つ、最大2つ）。端ではカード全体の動作より優先される。
   * 上下の押せる範囲は重ならないので、両方向へ送れるカードは両方の端を持てる。
   */
  readonly edges?: readonly CardEdgeAction[];
  /** 掴んで他のカード・レーンへ落とせるカードか。ドラッグ中の扱いはCardDragController。 */
  readonly draggable?: boolean;

  /** 枠の色を決める種別（theme.tsのCardKind）。省略したカードはアイテムとして描く。 */
  readonly kind?: CardKind;

  /**
   * そのカードが映しているものが、放っておいてよくない状態にあるか（警戒している動物の`wariness`）。
   * 安全域を外れている間、カードの輪郭が赤く明滅する（CardView.md 3節）。持たないカードは明滅しない。
   */
  readonly alert?: AlertLevel;

  /**
   * 道のカードか（domainのpathタグ）。道は行き先の土地の名前と絵を出すので、そのままでは土地の
   * カードと見分けが付かない。枠の色（kind）と、桟の中央の矢印がそれを区別する。
   */
  readonly road?: boolean;

  /**
   * 桟へ積むバー（CardView.md 8節）。**カードのバーはこれが全部**で、上から渡された順に積む。
   * 何本出るか・どちらの端が良いかを決めるのはすべて渡す側（PlayScreenView）で、カードは
   * 「並べて色を塗る」だけを引き受ける。1本も無いカードは空配列。
   */
  readonly gauges?: readonly CardGauge[];

  /**
   * そのカードが映しているものの状態を表す絵文字の印（手当て済みの怪我の🩹など）。紙の左下へ小さく
   * 重ねる。持たないカードには何も出ない。
   */
  readonly mark?: string;

  /**
   * そのカードが映しているものが**機能を止めている**ことを、絵の上へ大きく重ねる絵文字
   * （気を失った動物の💤）。小さな印（mark）と違い、姿そのものが変わったことを言うので、
   * レーンを流し見して気付ける大きさで出す（CardView.md 9.1節）。
   */
  readonly overlay?: string;

  /**
   * その行動の途中の値か（trueの間は状態バーの変化の帯を動かさず、合計の変化量を残す。
   * ProgressBar.setRatio参照）。
   */
  readonly midAction?: boolean;

  /**
   * まだ出来上がっていないもの（製作中オブジェクト）のカードか。青をかぶせ、地は敷かない
   * （CardView.md 10節 製作中オブジェクトのカード）。
   */
  readonly inProgress?: boolean;

  /**
   * 加熱が進んでいるか（CardView.md 15節）。**その札が映しているものの中で進んでいれば出す**ので、
   * 焼かれている肉にも、それを抱えている炉にも同じ覆いが出る。
   */
  readonly cooking?: CardCooking;
}

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（CardView.md 5節の絵文字代用）。
 */
export class Card extends Phaser.GameObjects.Container {
  private _content: CardContent;
  get content(): CardContent {
    return this._content;
  }

  /** カードの実寸。指が運ぶ札やドロップ先の枠を同じ大きさで描くために公開する。 */
  readonly cardWidth: number;
  readonly cardHeight: number;

  /** スタック数の表示。個数は差し替えのたびに変わるので、作り直さず書き換える。 */
  private readonly stackBadge: Phaser.GameObjects.Container;
  private readonly stackCount: Phaser.GameObjects.Text;

  /** 状態を表す絵文字の印（CardContent.mark）。持たないカードでは空文字で隠れる。 */
  private readonly mark: Phaser.GameObjects.Text;

  /** 状態を言う、絵の上の覆い（CardContent.overlay）。持たないカードでは空文字で隠れる。 */
  private readonly overlay: Phaser.GameObjects.Text;

  /** 今出している覆いの文言。変わった時だけ現れ方（showOverlay）を掛け直す。 */
  private overlayText = '';

  /** 大きく出てから上部へ落ち着くまでの動き。走っている間は置き場所を触らない。 */
  private overlayTween: Phaser.Tweens.Tween | undefined;

  /** カードの名前。中身が入れ替われば同じインスタンスのままでも変わる（showName参照）。 */
  private readonly nameText: Phaser.GameObjects.Text;

  /**
   * 枠そのもの。**種別で色が変わり、下の桟の高さが中身で変わる**ので、1枚絵ではなく図形として
   * 差し替えのたびに引き直す（drawFrame参照）。
   */
  private readonly frame: Phaser.GameObjects.Graphics;

  /**
   * 警戒を知らせる輪郭と、その明滅。**枠とは別のGraphicsに持つ**——枠は差し替えのたびに引き直すので、
   * 同じ図形へ混ぜると濃さのtweenが引き直しのたびに途切れる。
   */
  private readonly alertOutline: Phaser.GameObjects.Graphics;
  private alertBlink: Phaser.Tweens.Tween | undefined;

  /**
   * 中身を入れ替える器。重なりの順序を殻の側で固定しておくことで、中身（絵・背景・端の操作エリア）が
   * 出入りしても順序が崩れない。
   */
  private readonly backgroundLayer: Phaser.GameObjects.Container;
  private readonly artLayer: Phaser.GameObjects.Container;
  /** 絵の上へ乗算で重なる絵（objectArtのMULTIPLY_SUFFIX）。持たない絵では空のまま。 */
  private readonly multiplyLayer: Phaser.GameObjects.Container;
  private readonly edgeLayer: Phaser.GameObjects.Container;

  /** 製作中オブジェクトにかぶせる青（CardContent.inProgress）。それ以外のカードでは隠れる。 */
  private readonly inProgressVeil: Phaser.GameObjects.Graphics;

  /**
   * 加熱されているカードにかぶせる覆いと、その上の残り時間・進み具合（CardContent.cooking）。
   * 3つは常に揃って現れ、揃って消える（showCooking）。
   */
  private readonly cookingVeil: Phaser.GameObjects.Graphics;
  private readonly cookingText: Phaser.GameObjects.Text;
  private readonly cookingBar: ProgressBar;

  /** 今その器に出しているもの。同じなら作り直さないための控え（showArt・showEdge参照）。 */
  private shownArt: string | undefined;
  private shownIcon: string | undefined;
  private shownBackground: string | undefined;
  private shownEdgeDirections = '';

  /**
   * 状態を表すバー。値を持たない間は隠すだけで、作り直さない——作り直すと、変わった分を遅れて
   * 追いつかせる動き（ProgressBar.setRatio）が途中で消えるため。
   */
  /**
   * バー（CardContent.gauges）。**本数も両端の見せ方も映すものによって変わる**ので、決め打ちで
   * 作らず鍵で引く。一度作ったバーは、そのカードが別のものを映すようになっても捨てない——同じものへ
   * 戻ったときに変化の帯が途切れないようにするため。
   */
  private readonly gaugeBars = new Map<string, ProgressBar>();

  /** 今のgaugeBarsが塗りの色を引くための、映しているバーの内容（鍵で引く。gaugeBarFor参照）。 */
  private shownGauges = new Map<string, CardGauge>();

  /** 中身を入れ直すときに要る採寸。 */
  private readonly metrics: ScreenMetrics;

  /** 端を押し続けている間の繰り返し（addEdge参照）と、既に1枚でも送ったかどうか。 */
  private readonly edgeRepeat: HoldRepeat;
  private edgeRepeated = false;

  /** 今の押下がタップでなくなったか（cancelTap参照）。押し始めるたびに戻す。 */
  private tapCancelled = false;

  /**
   * この枠に今在るインスタンス（setPresence）。言われるまでは、映しているもの全部が在るとして扱う
   * （undefined）。**枚数はここからの導出値**——数を別に持つと、宙に在る札との引き算がずれる。
   */
  private present: readonly number[] | undefined;

  /** 0枚になったとき、帰ってくる場所の印を残す枠か（setPresence）。 */
  private emptied = false;

  /** 押下中だけ出す黒枠（makeTappable参照）。押せないカードは持たない。 */
  private pressHighlight: Phaser.GameObjects.Graphics | undefined;

  /**
   * ここで組み立てるのは**殻**——重なりの順序と、中身を入れる器だけ。何がどう見えるかは
   * `applyContent`（`setContent` と共通）が決める。初期表示も差し替えも同じ経路を通るので、
   * 反映の書き忘れは「後から古くなる」ではなく「最初から出ない」として現れる。
   */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: CardContent) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this._content = content;
    this.cardWidth = width;
    this.cardHeight = height;
    this.metrics = metrics;
    this.edgeRepeat = new HoldRepeat(scene);

    const paper = addPaper(scene, metrics, width, height, false);
    // 地は絵より先に敷く。用意されていなければ紙がそのまま地になる。
    this.backgroundLayer = scene.add.container(0, 0);
    this.artLayer = scene.add.container(0, 0);
    // 乗算の絵は、地と絵の両方を暗くする。どちらの色が変わったのかを描き分けられないので、
    // 「その位置の見た目がこう変わる」として一度に載せる。
    this.multiplyLayer = scene.add.container(0, 0);
    // 青は絵までを覆い、名前と状態のバーには掛けない。何が出来つつあるのかと、それが今どういう
    // 状態なのかは、覆いの下へ沈めずに読めるままにする。枠より先に置くので、覆いは窓の中だけに残る。
    this.inProgressVeil = createInProgressVeil(scene, metrics, width, height);
    // 加熱の覆いも同じ層。窓からはみ出した分は、青と同じく枠が隠す。
    this.cookingVeil = createCookingVeil(scene, metrics, width, height);
    // 枠は絵より後。**絵の上に枠が乗る**のがトレーディングカードの構造で、窓からはみ出した絵は
    // 枠が隠す（CardView.md 1節 カードの枠）。
    this.frame = scene.add.graphics();
    // 輪郭は枠より後。枠が引く縁の線の上に乗せないと、明滅が線の下で沈む。
    this.alertOutline = createAlertOutline(scene, metrics, width, height);
    this.nameText = createNameText(scene, metrics, width, height);
    this.add([
      paper,
      this.backgroundLayer,
      this.artLayer,
      this.multiplyLayer,
      this.cookingVeil,
      this.inProgressVeil,
      this.frame,
      this.alertOutline,
      this.nameText,
    ]);

    // 状態のバーは映すものが決まってから枠より後に足す（gaugeBarFor）ので、ここでは何も作らない。
    this.edgeLayer = scene.add.container(0, 0);
    this.add(this.edgeLayer);

    // 入力の配線だけは構築時に一度きり。押したときに何が起きるかは実行時に_contentから読む
    // （onTap・edges[].onTap）ので、差し替えで変わりうるのは「押せるかどうか」だけになる。
    if (content.onTap !== undefined || content.draggable === true) this.makeInteractive(width, height);
    if (content.onTap !== undefined) this.makeTappable(scene, metrics, width, height);
    // ドラッグはレーンの横スクロールと同じPhaserのdrag機構で受ける。重なった対象は最前面の1つだけが
    // 入力を受け取る（InputPlugin.topOnly）ため、カードを掴んでいる間レーンはスクロールしない。
    // 端の操作エリア（addEdge）はカードより手前にあってドラッグ対象ではないので、そこからは始まらない。
    if (content.draggable === true) scene.input.setDraggable(this);

    // 指を離した先がこのカードの外だと端のpointerupが来ないため、シーン全体の離上でも必ず止める。
    // 送り続けるものが残っているので、止め損なうと押していないのに動き続けてしまう。
    const stopEdgeRepeat = (): void => this.cancelEdgeRepeat();
    scene.input.on(Phaser.Input.Events.POINTER_UP, stopEdgeRepeat);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.cancelEdgeRepeat();
      this.alertBlink?.stop();
      scene.input.off(Phaser.Input.Events.POINTER_UP, stopEdgeRepeat);
    });

    // スタック数は端の操作エリアより後に足して、オーバーレイが出ている間も読めるようにする。
    this.stackCount = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(STACK_COUNT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);
    this.stackBadge = this.addStackBadge(scene, metrics, width, height);
    this.add(this.stackBadge);

    // 状態の印もスタック数と同じく、端の操作エリアより後に足して隠れないようにする。
    // 置く位置は窓の左下なので、桟の高さが決まる差し替えのたびに決め直す（showMark参照）。
    this.mark = scene.add
      .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: `${metrics.fontPx(MARK_SIZE)}px` })
      .setOrigin(0, 1);
    this.add(this.mark);

    // 覆いは印よりさらに後（最前面）。絵の上に載って初めて「今こうなっている」と読める。
    this.overlay = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(OVERLAY_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.cardOverlayText),
      })
      .setOrigin(0.5)
      .setStroke(cssColor(COLOR.cardFace), metrics.px(OVERLAY_STROKE));
    this.add(this.overlay);

    // 加熱の残り時間と進み具合。覆いは絵の層に置くが、この2つは印・覆いと同じく最前面に置いて、
    // 端の操作エリアやスタック数の下へ沈まないようにする。バーの左右は変わらないので、
    // 縦の位置だけを差し替えのたびに決め直す（showCooking）。
    const cookingSpan = windowSpan(metrics, width, height);
    const cookingMargin = metrics.px(COOKING_BAR_MARGIN);
    this.cookingBar = new ProgressBar(
      scene,
      metrics,
      cookingSpan.x + cookingMargin,
      0,
      cookingSpan.width - cookingMargin * 2,
      metrics.px(COOKING_BAR_HEIGHT),
      0,
      // 良し悪しを言わない1色（CardView.md 8.1節の両端がneutralなゲージと同じ）。焼き上がりへ
      // 進んでいるのか焦げへ進んでいるのかは、進む先の型を見ないと決まらず、画面からは分からない。
      { fillColor: () => COLOR.gaugeNeutral, steady: true },
    );
    this.add(this.cookingBar);
    this.cookingText = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(COOKING_TEXT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5)
      // 覆いが暗いので、他の重ね文字とは白黒が逆になる（暗い縁で字形を残す）。
      .setStroke(cssColor(COLOR.cardBorder), metrics.px(COOKING_TEXT_STROKE));
    this.add(this.cookingText);

    this.applyContent(content, false);
    scene.add.existing(this);
  }

  /**
   * 同じインスタンスを映し続けるカードの表示内容を差し替える。カードが何を映しているかは、代表
   * （`represented_by`）が入れ替われば名前も絵も変わるため、**構築時の値をそのまま持ち続けてよい
   * ものは無い**という前提で全部を貼り直す。
   */
  setContent(content: CardContent): void {
    this.applyContent(content, true);
  }

  /**
   * この枠に今在るインスタンスを言う（CardInteraction.md 2節・5節）。手に在るぶんも運ばれている
   * 最中のぶんもまだここには居ないので、呼ぶ側はそれを除いた集合を渡す。数字を書き換えるのか、
   * 札そのものを出さないのかはここが決める。
   *
   * 0枚の枠に札は出ない。**emptiedの枠だけは薄い印を残す**——そこに在るのは札ではなく、持ち出した
   * 札が帰ってくる場所を示す印なので、数字のバッジも出ない。
   */
  setPresence(ids: readonly number[], emptied: boolean): void {
    this.present = ids;
    this.emptied = emptied;
    if ((this._content.count ?? 1) !== ids.length) this.setContent({ ...this._content, count: ids.length });
    this.setVisible(ids.length > 0 || emptied);
    this.setAlpha(ids.length === 0 ? EMPTIED_ALPHA : 1);
  }

  /** この枠に今在るインスタンス。まだ何も言われていなければ、映しているもの全部。 */
  get presentIds(): readonly number[] {
    return this.present ?? this._content.identity ?? [];
  }

  /** 宙に在った札がこの枠に帰り着いた（合流）。IDセットの和になり、枚数はそこから導かれる。 */
  absorb(ids: readonly number[]): void {
    const merged = new Set([...this.presentIds, ...ids]);
    this.setPresence([...merged], this.emptied);
  }

  /**
   * この枠に今その札が在るか。**0枚の枠に在るのは札ではなく、帰ってくる場所を示す印**なので、押しても
   * 掴んでも何も起きない（CardInteraction.md 6.2節）。帰り着けばまた押せる——**押せるかどうかを決める
   * のは今在る札だけ**で、内容の側は操作を持ったまま待つ。
   *
   * 入力そのものは切らない。掴んで運んでいる間も元の札は0枚になるので、切ると運んでいる指の操作まで
   * 届かなくなる。
   *
   * 識別子を持たない札（ピン留めの現在地・空の受け皿の顔）は常に在る。
   */
  get holdsCard(): boolean {
    return (this.present ?? this._content.identity)?.length !== 0;
  }

  /**
   * 今の内容を殻へ流し込む。構築時（`showChange: false`）と差し替え時の両方が通る唯一の経路。
   *
   * showChangeは「この反映を、変化として見せるか」。現れたばかりのバーに変化の帯を出すと、見えて
   * いなかった間の増減が今この瞬間の変化として出てしまう（`StatusBar.show` と同じ理由）。
   */
  private applyContent(content: CardContent, showChange: boolean): void {
    this._content = content;
    // 製作中オブジェクトは種別に関わらず青写真の枠になる（まだその物ではないため）。
    const colors = cardFrameColors(content.inProgress === true ? 'blueprint' : (content.kind ?? 'item'));
    const bars = this.barsFor(content);
    const rail = railMetrics(
      this.metrics,
      this.cardWidth,
      this.cardHeight,
      bars.length,
      content.road === true,
    );
    this.drawFrame(colors, rail);
    this.showAlert(content);
    this.showName(content, colors);
    this.showArt(content);
    this.showBars(bars, rail, colors, showChange, content.midAction === true);
    this.showEdge(content);
    this.showStackCount();
    this.showMark(content, rail);
    this.showCooking(content.cooking, rail, showChange, content.midAction === true);
    this.inProgressVeil.setVisible(content.inProgress === true);
  }

  /**
   * 加熱が進んでいることを、絵の上の覆いと、残り時間・進み具合で言う（CardView.md 15節）。
   * 進んでいないカードでは3つとも消える。
   *
   * 残り時間とバーは窓の中央へ縦に積む。**桟の高さで窓の下端が動く**ので、置き場所は印（showMark）と
   * 同じく差し替えのたびに決め直す。入り切らない文字は幅に合わせて縮める（showOverlayと同じ）。
   */
  private showCooking(
    cooking: CardCooking | undefined,
    rail: RailMetrics,
    showChange: boolean,
    hold: boolean,
  ): void {
    this.cookingVeil.setVisible(cooking !== undefined);
    this.cookingText.setVisible(cooking !== undefined);
    const wasVisible = this.cookingBar.visible;
    this.cookingBar.setVisible(cooking !== undefined);
    if (cooking === undefined) return;

    const metrics = this.metrics;
    const inner = windowRect(metrics, this.cardWidth, this.cardHeight, rail.height);
    const gap = metrics.px(COOKING_BAR_GAP);
    const barHeight = metrics.px(COOKING_BAR_HEIGHT);

    this.cookingText.setText(minutesText(cooking.minutes)).setScale(1);
    const room = inner.width - metrics.px(COOKING_BAR_MARGIN) * 2;
    const scale = Math.min(1, room / Math.max(1, this.cookingText.width));
    this.cookingText.setScale(scale);

    const textHeight = this.cookingText.height * scale;
    const top = inner.y + (inner.height - (textHeight + gap + barHeight)) / 2;
    this.cookingText.setPosition(inner.x + inner.width / 2, top + textHeight / 2);
    this.cookingBar.setY(top + textHeight + gap);
    // 現れたばかりのバーに変化の帯を出すと、見えていなかった間の進みが今の変化として出てしまう。
    if (showChange && wasVisible) this.cookingBar.setRatio(cooking.ratio, hold);
    else this.cookingBar.resetRatio(cooking.ratio);
  }

  /**
   * 放っておいてよくない状態にあるカードの輪郭を、赤く明滅させる（CardView.md 3節）。
   *
   * **域の深さでは分けない。** 輪郭が言うのは「この札を放っておくな」の1つだけで、どれだけ気を
   * 立てているかはカードを開けば読める。域ごとに色を変えると、バーの黄（危険域）・赤（致命的域）の
   * 規約と混ざる。
   */
  private showAlert(content: CardContent): void {
    const alerting = content.alert !== undefined && content.alert !== 'safe';
    // 明滅は掛け続けるものなので、要否が変わった時だけ触る（差し替えごとに掛け直すと点滅が飛ぶ）。
    if (alerting === (this.alertBlink !== undefined)) return;

    if (!alerting) {
      this.alertBlink?.stop();
      this.alertBlink = undefined;
      this.alertOutline.setVisible(false).setAlpha(1);
      return;
    }

    this.alertOutline.setVisible(true);
    this.alertBlink = this.scene.tweens.add({
      targets: this.alertOutline,
      alpha: ALERT_BLINK_MIN_ALPHA,
      duration: ALERT_BLINK_DURATION_MS,
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * 名前。中身が入れ替われば名前は変わる（「ヤシの殻」⇔「水入りのヤシの殻」）。文字の色は枠の色から
   * 引くので、種別が変われば書き換える。
   */
  private showName(content: CardContent, colors: CardFrameColors): void {
    this.nameText.setColor(cssColor(colors.ink));
    if (this.nameText.text !== content.name) this.nameText.setText(content.name);
  }

  /**
   * 絵と、その下に敷く地。絵があれば枠に重ね、無いあいだは絵文字で代用する
   * （絵は少しずつ用意されるため）。同じものを出し続ける間は作り直さない。
   *
   * 製作中オブジェクトには地を敷かない。青の覆いが読めるだけの無地の地が要るので、
   * 「何の上に在るか」を表す景色より覆いの方を優先する（CardView.md 10節）。
   */
  private showArt(content: CardContent): void {
    const scene = this.scene;
    const background =
      content.background === undefined || content.inProgress === true
        ? undefined
        : cardBackgroundTexture(content.background);
    if (background !== this.shownBackground) {
      this.shownBackground = background;
      this.backgroundLayer.removeAll(true);
      if (background !== undefined && scene.textures.exists(background)) {
        this.backgroundLayer.add(placeArt(scene, background, this.cardWidth, this.cardHeight));
      }
    }

    const art = content.art === undefined ? undefined : objectTexture(content.art);
    if (art === this.shownArt && content.icon === this.shownIcon) return;
    this.shownArt = art;
    this.shownIcon = content.icon;

    this.artLayer.removeAll(true);
    // 乗算の絵は通常の絵と対で決まる（同じ識別子から引く）ので、貼り替えも一緒に行う。
    const multiply = content.art === undefined ? undefined : objectMultiplyTexture(content.art);
    this.multiplyLayer.removeAll(true);
    if (multiply !== undefined && scene.textures.exists(multiply)) {
      this.multiplyLayer.add(
        placeArt(scene, multiply, this.cardWidth, this.cardHeight).setBlendMode(Phaser.BlendModes.MULTIPLY),
      );
    }

    if (art !== undefined && scene.textures.exists(art)) {
      this.artLayer.add(placeArt(scene, art, this.cardWidth, this.cardHeight));
      return;
    }
    // 乗算の絵だけで成り立つもの（痣のような、肌の変色そのもの）には絵がもう在る。絵文字は
    // 「まだ一枚も無い」ことの代用なので出さない。
    if (multiply === undefined) {
      this.artLayer.add(createIconText(scene, this.metrics, content.icon, this.cardWidth, this.cardHeight));
    }
    if (art !== undefined) this.swapArtWhenLoaded(scene, art);
  }

  /**
   * 絵文字で代用中の絵が後から届いたら、自分で貼り替える。道のカードは行き先の土地の絵の
   * ロード完了（LocationArtLoader）を待たずに現れうるため。
   */
  private swapArtWhenLoaded(scene: Phaser.Scene, texture: string): void {
    const event = Phaser.Textures.Events.ADD_KEY + texture;
    const swap = (): void => {
      // 待っている間に映すものが変わっていれば、届いた絵はもうこのカードのものではない。
      if (this.shownArt !== texture) return;
      this.artLayer.removeAll(true);
      this.artLayer.add(placeArt(scene, texture, this.cardWidth, this.cardHeight));
    };
    scene.textures.once(event, swap);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.textures.off(event, swap));
  }

  /**
   * 桟へ積む状態バーを、上からの順に並べる。**値を持たないバーはここで隠して並びから外す**ので、
   * 桟の高さも積む位置も「今いくつ出ているか」だけで決まる。
   */
  private barsFor(content: CardContent): readonly RailBar[] {
    const gauges = content.gauges ?? [];
    // 塗りの色と帯の向きは映すものが決めるので、割合より先に控えておく（gaugeBarForのfillColorが読む）。
    this.shownGauges = new Map(gauges.map((gauge) => [gauge.key, gauge]));

    // 今映していないバーは隠す（別のものを映すようになったカードに前のバーが残らないように）。
    for (const [key, bar] of this.gaugeBars) {
      if (!this.shownGauges.has(key)) bar.setVisible(false);
    }
    return gauges.map((gauge) => ({ bar: this.gaugeBarFor(gauge), ratio: gauge.ratio }));
  }

  /**
   * そのバー（無ければ作る）。**鍵で引く**ので、同じものを映している間は差し替えをまたいでも同じ
   * バーが使われ、変化の帯（ProgressBar.setRatio）が途切れない。
   *
   * 塗りの色も増減の向きも、映している内容（`shownGauges`）から毎回引き直す——中身は入れ替わる
   * （飲み干した水筒へ茶を注ぐ）し、同じプロパティでも向きは定義側の変更で変わりうるため。
   */
  private gaugeBarFor(gauge: CardGauge): ProgressBar {
    const key = gauge.key;
    let bar = this.gaugeBars.get(key);
    if (bar === undefined) {
      bar = this.addRailBar(this.scene, this.metrics, {
        fillColor: (ratio) => {
          const shown = this.shownGauges.get(key);
          if (shown === undefined) return COLOR.cardFillUnknown;
          return shown.color ?? gaugeColorFor(ratio, shown.atMin, shown.atMax);
        },
      });
      // 後から足したバーは重なりの一番上に付くので、端の操作エリアより下へ戻す。バーは桟の意匠で
      // あって操作の手前に出るものではない（端のオーバーレイ・スタック数・印より下、addEdge参照）。
      this.moveBelow(bar, this.edgeLayer);
      this.gaugeBars.set(key, bar);
    }
    bar.setWorsensUpward(gauge.worsensUpward);
    return bar;
  }

  /** 状態のバーを桟へ積む。枠線は札の縁と同じ色にする（種別で変わるので、差し替えのたびに渡す）。 */
  private showBars(
    bars: readonly RailBar[],
    rail: RailMetrics,
    colors: CardFrameColors,
    showChange: boolean,
    hold: boolean,
  ): void {
    bars.forEach(({ bar, ratio }, index) => {
      bar.setY(rail.barTop + rail.barPitch * index);
      bar.setBorderColor(colors.line);
      // 隠れていたバーが現れるときは、見えていなかった間の増減を今の変化として見せない。
      if (showChange && bar.visible) bar.setRatio(ratio, hold);
      else bar.resetRatio(ratio);
      bar.setVisible(true);
    });
  }

  /**
   * 端の操作エリア。送れる先があるかどうかで付いたり外れたりする（`PlayScene.cardEdges`）ので、
   * 向きの組み合わせが変わったときだけ中身を入れ直す。押したときに何が起きるかは実行時に
   * `_content`から読む。
   */
  private showEdge(content: CardContent): void {
    const directions = EDGE_DIRECTIONS.filter((direction) => this.edgeActionFor(content, direction));
    const key = directions.join();
    if (key === this.shownEdgeDirections) return;

    this.shownEdgeDirections = key;
    this.cancelEdgeRepeat();
    this.edgeLayer.removeAll(true);
    for (const direction of directions) {
      this.addEdge(this.scene, this.metrics, this.cardWidth, this.cardHeight, direction);
    }
  }

  /** その向きの端を押したときの動作（その向きへ送れないならundefined）。 */
  private edgeActionFor(content: CardContent, direction: CardEdgeDirection): CardEdgeAction | undefined {
    return content.edges?.find((edge) => edge.direction === direction);
  }

  /**
   * 桟へ積むバーを1本作る。**縦の位置以外はどれも同じ**なので、寸法はここで決め切り、どこへ積むかだけを
   * 差し替えのたびに与える（showBars参照）。
   *
   * **カードのバーは明滅させない**（steady）——明滅は「手を止めろ」という催促で、それを言うのは
   * 札の縁（3節）とステータスエリアの役目だから（CardView.md 8節）。
   *
   * バーの枠線は経路の上へ太さの半分ずつ広がるので、その分だけ内側へ寄せて、**枠線の外周が窓の縁と
   * 重なる**ようにする（窓の縁の線も同じ寄せ方をしている。drawFrame参照）。
   */
  private addRailBar(scene: Phaser.Scene, metrics: ScreenMetrics, options: ProgressBarOptions): ProgressBar {
    const span = windowSpan(metrics, this.cardWidth, this.cardHeight);
    const line = Math.max(1, metrics.px(TRACK_BORDER_WIDTH));
    const bar = new ProgressBar(
      scene,
      metrics,
      span.x + line / 2,
      0,
      span.width - line,
      metrics.px(RAIL_BAR_HEIGHT),
      0,
      { ...options, steady: true },
    );
    this.add(bar);
    return bar;
  }

  /**
   * 枠を引く。**絵の上に乗る**ので、窓からはみ出した絵はここで隠れる（CardView.md 1節 カードの枠）。
   *
   * 桟の高さと色が差し替えで変わるため、1枚絵にはできず毎回引き直す。意匠が入る段になったら
   * 9patch（nineSlice.ts）へ移す。
   */
  private drawFrame(colors: CardFrameColors, rail: RailMetrics): void {
    const metrics = this.metrics;
    const paper = paperRect(metrics, this.cardWidth, this.cardHeight);
    const inner = windowRect(metrics, this.cardWidth, this.cardHeight, rail.height);
    const side = metrics.px(FRAME_SIDE);
    const head = metrics.px(FRAME_HEAD);
    const radius = metrics.px(WINDOW_RADIUS);
    const line = Math.max(1, metrics.px(BORDER_WIDTH));

    const frame = this.frame;
    frame.clear();

    // 桟は紙の輪郭を太い線でなぞって描く。塗りで抜くのと違い、角の丸みが紙とそのまま揃う。
    frame.lineStyle(side, colors.face, 1);
    frame.strokeRoundedRect(
      paper.x + side / 2,
      paper.y + side / 2,
      paper.width - side,
      paper.height - side,
      metrics.px(FRAME_RADIUS) - side / 2,
    );
    // 下の桟のうち、なぞった線からはみ出す分。角の丸みは下端から10uまでなので、ここは矩形でよい。
    if (rail.height > side) {
      frame.fillStyle(colors.face, 1);
      frame.fillRect(paper.x, paper.y + paper.height - rail.height, paper.width, rail.height - side);
    }

    // タイトルの板。窓の上端に乗せ、枠より暗くする（cardFrameColors）。
    frame.fillStyle(colors.plate, 1);
    frame.fillRoundedRect(inner.x, inner.y, inner.width, head, { tl: radius, tr: radius, bl: 0, br: 0 });

    frame.lineStyle(line, colors.line, 1);
    frame.lineBetween(inner.x, inner.y + head, inner.x + inner.width, inner.y + head);
    frame.strokeRoundedRect(
      inner.x + line / 2,
      inner.y + line / 2,
      inner.width - line,
      inner.height - line,
      radius,
    );
    const outline = paperStroke(metrics, this.cardWidth, this.cardHeight, line);
    frame.strokeRoundedRect(
      outline.rect.x,
      outline.rect.y,
      outline.rect.width,
      outline.rect.height,
      outline.radius,
    );

    if (rail.arrowY !== undefined) this.drawRoadArrow(colors, rail.arrowY);
  }

  /**
   * 道であることを示す矢印。桟の中央へ置く（左下へ寄せると、道であることが記号として読めない）。
   * **紙の色の塗りに枠の色の縁**にして、桟の色が種別で変わっても形が残るようにする。
   */
  private drawRoadArrow(colors: CardFrameColors, centerY: number): void {
    const metrics = this.metrics;
    const width = metrics.px(ROAD_ARROW_WIDTH);
    const height = metrics.px(ROAD_ARROW_HEIGHT);
    const left = (this.cardWidth - width) / 2;
    const top = centerY - height / 2;

    // 軸の高さは矢印の高さの半分。残りを矢尻の張り出しに使う。
    const shaftTop = top + height * 0.25;
    const shaftBottom = top + height * 0.75;
    const headLeft = left + width * 0.5625;
    const points = [
      [left, shaftTop],
      [headLeft, shaftTop],
      [headLeft, top],
      [left + width, centerY],
      [headLeft, top + height],
      [headLeft, shaftBottom],
      [left, shaftBottom],
    ].map(([x, y]) => new Phaser.Math.Vector2(x, y));

    this.frame.fillStyle(COLOR.cardFace, 1);
    this.frame.lineStyle(Math.max(1, metrics.px(ROAD_ARROW_STROKE)), colors.line, 1);
    this.frame.fillPoints(points, true);
    this.frame.strokePoints(points, true);
  }

  /**
   * スタック数を囲む丸。数字はスタックが増減しても位置が動かないよう、丸の中心へ固定する。
   * 絵の右上の角からわざと少しはみ出させる（カードに載せ切るより、札束の厚みとして目に付くため）。
   */
  private addStackBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): Phaser.GameObjects.Container {
    const paper = paperRect(metrics, width, height);
    const radius = metrics.px(STACK_BADGE_SIZE) / 2;
    const offset = radius - metrics.px(STACK_BADGE_OVERHANG);

    const circle = scene.add.graphics();
    circle.fillStyle(COLOR.cardFace, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(Math.max(1, metrics.px(STACK_BADGE_BORDER)), COLOR.cardBorder, 1);
    circle.strokeCircle(0, 0, radius);

    return scene.add.container(paper.x + paper.width - offset, paper.y + offset, [circle, this.stackCount]);
  }

  private showStackCount(): void {
    const count = this._content.count ?? 1;
    this.stackBadge.setVisible(count >= 2);
    this.stackCount.setText(String(count));
  }

  /** 状態の印。窓の左下へ置く（桟の高さで窓の下端が動くので、差し替えのたびに決め直す）。 */
  private showMark(content: CardContent, rail: RailMetrics): void {
    const inner = windowRect(this.metrics, this.cardWidth, this.cardHeight, rail.height);
    const margin = this.metrics.px(MARK_MARGIN);
    this.mark.setPosition(inner.x + margin, inner.y + inner.height - margin).setText(content.mark ?? '');
    this.showOverlay(content.overlay ?? '', inner, margin);
  }

  /**
   * 状態を言う覆い（CardView.md 9.1節）。**立った瞬間だけ大きく出し、そのあと上部へ収まって残る。**
   * 出っぱなしで大きいと絵を潰し、初めから小さいと気付けない。
   *
   * 文言が変わらない差し替えでは掛け直さない（動いている最中に何度も差し替わるため）。ただし収まる
   * 位置は毎回決め直す——桟の高さで窓の下端が動くので、バーが増えれば置き場所も動く。
   *
   * **入り切らない文言は縮めて収める。** 言語によって長さが大きく違う（「気絶」と `unconscious`）ので、
   * 幅からその場で倍率を決める。
   */
  private showOverlay(text: string, inner: Rect, margin: number): void {
    const appeared = text !== '' && text !== this.overlayText;
    this.overlayText = text;
    this.overlay.setText(text).setVisible(text !== '');
    if (text === '') {
      this.overlayTween?.stop();
      this.overlayTween = undefined;
      return;
    }

    // 言語で長さが大きく違う（「気絶」と`unconscious`）ので、倍率は幅から決める。
    const maxScale = (inner.width - margin * 2) / Math.max(1, this.overlay.width);
    const restScale = Math.min(1, maxScale);
    const rest = {
      x: inner.x + inner.width / 2,
      y: inner.y + margin + (this.overlay.height * restScale) / 2,
    };
    if (!appeared) {
      // 動いている最中なら行き先を奪わない（着けば自分でrestに着く）。
      if (this.overlayTween === undefined) this.overlay.setPosition(rest.x, rest.y).setScale(restScale);
      return;
    }

    this.overlay
      .setPosition(inner.x + inner.width / 2, inner.y + inner.height / 2)
      .setScale(Math.min(OVERLAY_BURST_SCALE * restScale, maxScale));
    this.overlayTween?.stop();
    this.overlayTween = this.scene.tweens.add({
      targets: this.overlay,
      x: rest.x,
      y: rest.y,
      scale: restScale,
      delay: OVERLAY_HOLD_MS,
      duration: OVERLAY_SETTLE_MS,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        this.overlayTween = undefined;
      },
    });
  }

  /** Containerのdisplay originによるヒット領域のずれを避ける理由はButtonと同じ（サイズを設定しない）。 */
  private makeInteractive(width: number, height: number): void {
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  }

  /** 押下中は紙の縁を黒枠でなぞる。枠は紙の内側へ収める（paperStroke参照）。 */
  private makeTappable(scene: Phaser.Scene, metrics: ScreenMetrics, width: number, height: number): void {
    const highlight = scene.add.graphics().setVisible(false);
    const lineWidth = metrics.px(PRESSED_BORDER_WIDTH);
    const { rect, radius } = paperStroke(metrics, width, height, lineWidth);
    drawBox(highlight, rect, {
      border: COLOR.cardBorder,
      borderWidth: lineWidth,
      radius,
    });
    this.pressHighlight = highlight;
    this.add(highlight);

    onPressRelease(this, {
      onPress: () => {
        this.tapCancelled = false;
        highlight.setVisible(true);
      },
      onCancel: () => highlight.setVisible(false),
      onRelease: () => {
        highlight.setVisible(false);
        if (this.tapCancelled || !this.holdsCard) return;

        noteOperation(`カードを押した: ${this._content.name}`);
        this._content.onTap?.();
      },
    });
  }

  /**
   * 今の押下をタップとして扱わない。掴んで動かす操作（カードのドラッグ・レーンの横スクロール）に
   * なったと分かった時点でCardDragControllerが呼ぶ。押下中の黒枠もここで引っ込める——押されている
   * ことを示す表示は、掴んだ時点で指が運ぶ札に役目を譲る。
   *
   * 押し始めたカードの上で指を離すと、動かしていてもタップとして成立してしまう（tap.ts）。
   * スタックの上の1枚を自分の位置へ重ねる操作（石と石の組み合わせ）や、カードを掴んだままの
   * レーンの横スクロールがこれに当たり、そのままでは操作のたびに子ウィンドウが開いてしまう。
   */
  cancelTap(): void {
    this.tapCancelled = true;
    this.pressHighlight?.setVisible(false);
  }

  /**
   * 隣のレーンへ移すための端の操作エリア。押している間だけ半透明のオーバーレイと矢印を出し、
   * どちら向きの操作なのかを示す。
   *
   * 押し続けると、指を離さないまま1枚目が動き、そのあとは間隔を詰めながら送り続ける
   * （HoldRepeat）。短く押して離した場合だけ、離した時点で1枚動かす——
   * 押し続けて既に動き出しているなら、離したぶんをもう1枚足すことにはならない。
   *
   * ヒット領域はカード本体の後に足す。重なった対象のうち描画順が最前面の1つだけが入力を受け取る
   * （InputPlugin.topOnly）ため、これで端はカード全体の操作もドラッグも横取りする。透明でも描画される
   * Rectangleを使うのは、Zoneが描画リストへ載らず前後関係が決まらないため。
   */
  private addEdge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    direction: CardEdgeDirection,
  ): void {
    const up = direction === 'up';
    const paper = paperRect(metrics, width, height);
    const edgeHeight = paper.height * EDGE_RATIO;
    const top = up ? paper.y : paper.y + paper.height - edgeHeight;
    const radius = metrics.px(FRAME_RADIUS);

    const overlay = scene.add.graphics();
    overlay.fillStyle(COLOR.cardEdgeOverlay, EDGE_OVERLAY_ALPHA);
    overlay.fillRoundedRect(
      paper.x,
      top,
      paper.width,
      edgeHeight,
      up ? { tl: radius, tr: radius, bl: 0, br: 0 } : { tl: 0, tr: 0, bl: radius, br: radius },
    );

    const arrow = scene.add
      .text(width / 2, top + edgeHeight / 2, up ? '▲' : '▼', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(EDGE_ARROW_SIZE)}px`,
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const feedback = scene.add.container(0, 0, [overlay, arrow]).setVisible(false);
    // 押せる範囲はカードの矩形いっぱいまで広げる。絵の余白は見た目だけのもので、そこを押しても
    // 端を押したことにしたいため。
    const hitArea = scene.add
      .rectangle(0, up ? 0 : top, width, up ? top + edgeHeight : height - top)
      .setOrigin(0, 0)
      .setInteractive();

    onPressRelease(hitArea, {
      onPress: () => {
        feedback.setVisible(true);
        this.startEdgeRepeat(direction);
      },
      onCancel: () => {
        feedback.setVisible(false);
        this.cancelEdgeRepeat();
      },
      onRelease: () => {
        feedback.setVisible(false);
        const moved = this.edgeRepeated;
        this.cancelEdgeRepeat();
        if (!moved) this.edgeActionFor(this._content, direction)?.onTap();
      },
    });

    this.edgeLayer.add([feedback, hitArea]);
  }

  /** 押し続けの繰り返しを始める。速さはHoldRepeatが持つ。 */
  private startEdgeRepeat(direction: CardEdgeDirection): void {
    this.edgeRepeated = false;
    this.edgeRepeat.start(() => {
      const edge = this.edgeActionFor(this._content, direction);
      if (edge === undefined) return false;

      this.edgeRepeated = true;
      edge.onTap();
      // 送った結果このカードが空になっていれば、破棄されていてもう続けられない。
      return this.scene !== undefined;
    });
  }

  /** 繰り返しを止める。edgeRepeatedは離したときの判断に使うので、ここでは触らない。 */
  private cancelEdgeRepeat(): void {
    this.edgeRepeat.stop();
  }
}

/**
 * 中身の無い固定枠を示すカード。枠数を決めたスロット（cell_count、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 *
 * acceptsを渡すと、紙の代わりにその物のカードを薄く敷く。何を入れる枠なのかは、名前と絵が一番早く
 * 伝えるため。破線はどちらでも同じ濃さで重ねる——薄めると「まだ空いている」ことが読み取れなくなる。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, accepts?: CardContent) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);

    if (accepts === undefined) {
      this.add(addPaper(scene, metrics, width, height, true));
    } else {
      this.add(new Card(scene, metrics, 0, 0, cardFace(accepts)).setAlpha(EMPTY_FRAME_ALPHA));
      this.add(emptyOutline(scene, metrics, width, height));
    }

    scene.add.existing(this);
  }
}

/**
 * 枠そのものを色で強調する縁（CardView.md 11節 枠（セル）は一級の単位の1層目）。
 * **カードの矩形の外側を回る**ので、枠にカードが入っても隠れない（CELL_HIGHLIGHT_WIDTH参照）。
 */
export class CellHighlight extends Phaser.GameObjects.Graphics {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, color: number) {
    super(scene, { x, y });

    const width = Math.max(1, metrics.px(CELL_HIGHLIGHT_WIDTH));
    // 線は経路の上に太さの半分ずつ広がるので、経路をカードの矩形から半分だけ外へ出すと、線は
    // カードに一切かからずその外側だけを埋める。角の丸みも紙の輪郭と同心になるよう外へ足す。
    const inset = width / 2;
    drawBox(
      this,
      {
        x: -inset,
        y: -inset,
        width: metrics.px(SIZE.cardWidth) + width,
        height: metrics.px(SIZE.cardHeight) + width,
      },
      {
        border: color,
        borderWidth: width,
        radius: metrics.px(FRAME_INSET + FRAME_RADIUS + CELL_HIGHLIGHT_WIDTH / 2),
      },
    );

    scene.add.existing(this);
  }
}

/**
 * 枠がカードの上へ重ねる短い文字（CardView.md 11節 枠（セル）は一級の単位の3層目）。
 * **カードが入っていても隠れない**ことがこの層の役目なので、カードより手前へ置く（CardLane）。
 */
export class CellOverlay extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, overlay: string) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this.add(this.makeBadge(scene, metrics, paperRect(metrics, width, height), overlay));

    scene.add.existing(this);
  }

  /**
   * 重ねる文字。**暗い板に明るい文字**を載せる——下に来るのは絵のあるカードとも空き枠とも決まって
   * いないので、地の明るさによらず読める組み合わせにする。板の幅は文字に合わせて決める。
   */
  private makeBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    paper: Rect,
    overlay: string,
  ): Phaser.GameObjects.Container {
    const text = scene.add
      .text(0, 0, overlay, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(CELL_OVERLAY_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const padding = metrics.px(CELL_OVERLAY_PADDING);
    const badgeHeight = text.height + padding;
    const badgeWidth = text.width + padding * 2;
    const plate = scene.add.graphics();
    drawBox(
      plate,
      { x: -badgeWidth / 2, y: -badgeHeight / 2, width: badgeWidth, height: badgeHeight },
      { fill: COLOR.cellOverlayPlate, fillAlpha: CELL_OVERLAY_PLATE_ALPHA, radius: badgeHeight / 2 },
    );

    return scene.add.container(
      paper.x + paper.width / 2,
      paper.y + paper.height - metrics.px(CELL_OVERLAY_BOTTOM) - badgeHeight / 2,
      [plate, text],
    );
  }
}

/**
 * 警戒を知らせる輪郭（showAlert）。**紙の縁をなぞる1本だけ**にする——枠の中へ何かを描き足すと、
 * 絵の濃淡に埋もれるうえ、レーンを流し見しているときに気付けない。
 *
 * 描くのは一度きりで、あとは見せるか隠すかと濃さだけが動く。太さも位置も桟の高さに依らないため。
 */
function createAlertOutline(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const outline = scene.add.graphics();
  const lineWidth = Math.max(1, metrics.px(ALERT_OUTLINE_WIDTH));
  const { rect, radius } = paperStroke(metrics, width, height, lineWidth);
  outline.lineStyle(lineWidth, COLOR.statusAlertFatal, 1);
  outline.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
  return outline.setVisible(false);
}

/** 空き枠であることを示す破線。薄く敷いたもの（紙・受け入れる物のカード）の上へ、薄めずに重ねる。 */
function emptyOutline(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const outline = scene.add.graphics();
  const lineWidth = Math.max(1, metrics.px(2));
  const { rect, radius } = paperStroke(metrics, width, height, lineWidth);
  drawBox(outline, rect, {
    border: COLOR.cardBorder,
    borderWidth: lineWidth,
    radius,
    dashed: true,
  });
  return outline;
}

/**
 * カードの紙（枠と絵の下に敷く地）。画像（CARD_FRAME_TEXTURE）があればそれを矩形いっぱいに貼り、
 * 無ければ図形で描く。画像を差し替えたり用意しなかったりしても画面が成り立つよう、図形の描画は残してある。
 *
 * emptyは中身の無い枠（EmptyCard）。画像なら薄く敷き、図形なら破線で描く。
 */
function addPaper(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
  empty: boolean,
): Phaser.GameObjects.GameObject {
  if (scene.textures.exists(CARD_FRAME_TEXTURE)) {
    const image = scene.add.image(0, 0, CARD_FRAME_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height);
    if (!empty) return image;

    // 空き枠は紙を薄く敷いたうえに破線を重ねる。薄いだけだと明るい下地（子ウィンドウの台紙）で
    // ほとんど見えず、「枠がいくつあるか」が伝わらないため。
    image.setAlpha(EMPTY_FRAME_ALPHA);
    return scene.add.container(0, 0, [image, emptyOutline(scene, metrics, width, height)]);
  }

  const face = scene.add.graphics();
  drawBox(face, paperRect(metrics, width, height), {
    fill: COLOR.cardFace,
    fillAlpha: empty ? 0.35 : 0.85,
    border: COLOR.cardBorder,
    borderWidth: Math.max(1, metrics.px(2)),
    radius: metrics.px(FRAME_RADIUS),
    dashed: empty,
  });
  return face;
}

/**
 * object_defの絵をカードの中央へ置く。
 *
 * 絵の大きさは画像そのものの寸法で決まる（CARD_ART_WIDTH参照）。小石は小さい画像、地形はカードと
 * 同じ縦横比の大きい画像で、どちらもこの一つの規則で正しい大きさになる。
 */
function placeArt(
  scene: Phaser.Scene,
  texture: string,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  const image = scene.add.image(width / 2, height / 2, texture).setOrigin(0.5);
  const scale = width / CARD_ART_WIDTH;
  return image.setDisplaySize(image.width * scale, image.height * scale);
}

/**
 * 名前の文字。中身は空で作り、何を出すかはshowNameが決める（殻だけを組み立てる、constructor参照）。
 * タイトルの板は高さも位置も動かないので、置き場所はここで決め切る。
 */
function createNameText(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Text {
  const paper = paperRect(metrics, width, height);
  return scene.add
    .text(width / 2, paper.y + metrics.px(FRAME_SIDE) + metrics.px(FRAME_HEAD) / 2, '', {
      fontFamily: FONT_FAMILY,
      fontSize: `${metrics.fontPx(NAME_SIZE)}px`,
      fontStyle: 'bold',
    })
    .setOrigin(0.5);
}

/**
 * 製作中オブジェクトのカードにかぶせる青（IN_PROGRESS_VEIL_ALPHA参照）。紙の輪郭に合わせて角を
 * 丸め、枠の線の内側へ収める。
 */
function createInProgressVeil(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const veil = scene.add.graphics();
  drawBox(veil, paperRect(metrics, width, height), {
    fill: COLOR.cardInProgress,
    fillAlpha: IN_PROGRESS_VEIL_ALPHA,
    radius: metrics.px(FRAME_RADIUS),
  });
  return veil.setVisible(false);
}

/**
 * 加熱されているカードにかぶせる熾の色（COOKING_VEIL_ALPHA参照）。青写真の覆いと同じく紙いっぱいに
 * 引き、窓からはみ出す分は枠が隠す。
 */
function createCookingVeil(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const veil = scene.add.graphics();
  drawBox(veil, paperRect(metrics, width, height), {
    fill: COLOR.cardCooking,
    fillAlpha: COOKING_VEIL_ALPHA,
    radius: metrics.px(FRAME_RADIUS),
  });
  return veil.setVisible(false);
}

/** 絵の代わりに出す絵文字（showArt参照）。 */
function createIconText(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  icon: string,
  width: number,
  height: number,
): Phaser.GameObjects.Text {
  return scene.add
    .text(width / 2, height / 2, icon, {
      fontFamily: FONT_FAMILY,
      fontSize: `${metrics.fontPx(96)}px`,
    })
    .setOrigin(0.5)
    .setAlpha(0.95);
}

/** カードの矩形の中で、絵の紙が占める範囲（FRAME_INSET参照）。 */
function paperRect(metrics: ScreenMetrics, width: number, height: number): Rect {
  const inset = metrics.px(FRAME_INSET);
  return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
}

/**
 * 窓の左右。**桟の高さに依らない**ので、桟を測る前——状態バーを作る時点——でも引ける
 * （addRailBar参照）。
 */
function windowSpan(
  metrics: ScreenMetrics,
  width: number,
  height: number,
): { readonly x: number; readonly width: number } {
  const paper = paperRect(metrics, width, height);
  const side = metrics.px(FRAME_SIDE);
  return { x: paper.x + side, width: paper.width - side * 2 };
}

/** 枠の内側の、絵が見える窓。上端にはタイトルの板が乗り、下端は桟の高さで動く。 */
function windowRect(metrics: ScreenMetrics, width: number, height: number, railHeight: number): Rect {
  const paper = paperRect(metrics, width, height);
  const side = metrics.px(FRAME_SIDE);
  return {
    ...windowSpan(metrics, width, height),
    y: paper.y + side,
    height: paper.height - side - railHeight,
  };
}

/** 桟へ積む状態バー1本と、そのバーが今映す値。 */
interface RailBar {
  readonly bar: ProgressBar;
  readonly ratio: number;
}

/** 下の桟の寸法（railMetrics）。 */
interface RailMetrics {
  /** 桟の高さ（px）。 */
  readonly height: number;
  /** 道の矢印の中心のy（px）。道でないカードはundefined。 */
  readonly arrowY: number | undefined;
  /** 状態バー1本目の上端（px）。2本目からはbarPitchずつ下がる。 */
  readonly barTop: number;
  readonly barPitch: number;
}

/**
 * 下の桟の寸法。**中身——道の矢印と、値を持つ状態バー——を上から積み、その高さで桟の厚みが決まる**
 * （CardView.md 1節 カードの枠）。何も積まないカードでは左右と同じ細さにして、間延びさせない。
 */
function railMetrics(
  metrics: ScreenMetrics,
  width: number,
  height: number,
  barCount: number,
  road: boolean,
): RailMetrics {
  const paper = paperRect(metrics, width, height);
  const barHeight = metrics.px(RAIL_BAR_HEIGHT);
  const gap = metrics.px(RAIL_BAR_GAP);
  const arrowHeight = metrics.px(ROAD_ARROW_HEIGHT);
  const rows = (road ? 1 : 0) + barCount;
  const stack = (road ? arrowHeight : 0) + barCount * barHeight + Math.max(0, rows - 1) * gap;
  // **バーの下は左右の桟と同じ厚みにする。** 中身の上下へ同じ余白を取ると、バーを持つカードだけ
  // 下の枠が細くなり、持たないカードと並んだときに枠が痩せて見える。上は枠ではなく絵との間隔なので、
  // 揃える相手が違う。
  const side = metrics.px(FRAME_SIDE);
  const railHeight = rows === 0 ? side : metrics.px(RAIL_PAD) + stack + side;
  const top = paper.y + paper.height - railHeight + metrics.px(RAIL_PAD);
  return {
    height: railHeight,
    arrowY: road ? top + arrowHeight / 2 : undefined,
    barTop: top + (road ? arrowHeight + gap : 0),
    barPitch: barHeight + gap,
  };
}

/**
 * 紙の輪郭をなぞる線の経路と角の丸み。**線の外周が紙の縁とちょうど重なる**よう、経路を線の太さの
 * 半分だけ内側へ寄せる（角の丸みも同じだけ小さくして同心にする）。
 *
 * 絵の紙は縁からいきなり不透明で始まる（card_frame.pngの実測で、410px幅の絵の5px目でアルファが
 * 255になる＝FRAME_INSETの2.5u）。線は経路の上に太さの半分ずつ広がるので、経路を紙の縁そのものに
 * 置くと線の外半分が紙の外へ出て、輪郭が実物のカードより一回り大きく見える。塗り（inProgressVeil）は
 * 経路が縁そのものなので、こちらを通さない。
 */
function paperStroke(
  metrics: ScreenMetrics,
  width: number,
  height: number,
  lineWidth: number,
): { readonly rect: Rect; readonly radius: number } {
  const paper = paperRect(metrics, width, height);
  const inset = lineWidth / 2;
  return {
    rect: {
      x: paper.x + inset,
      y: paper.y + inset,
      width: paper.width - lineWidth,
      height: paper.height - lineWidth,
    },
    radius: Math.max(0, metrics.px(FRAME_RADIUS) - inset),
  };
}
