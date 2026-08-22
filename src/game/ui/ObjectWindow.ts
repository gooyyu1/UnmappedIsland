import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { addTextButton } from './Button';
import type { Button, HoldHandlers } from './Button';
import type { CardContent } from './Card';
import { borrowedFace } from './cardFace';
import { CardLane } from './CardLane';
import type { ExplorationContent } from './ExplorationPane';
import { ExplorationPane } from './ExplorationPane';
import type { PropertyCategory } from './PropertiesPane';
import { PropertiesPane } from './PropertiesPane';
import type { LaneCell } from './laneCells';
import { foundCells, laneWidthForCells } from './laneCells';
import {
  ACTION_GAP,
  ACTION_HEIGHT,
  ACTION_MAX_WIDTH,
  CONTENT_GAP,
  WINDOW_PADDING,
  centerWindow,
} from '../looks/childWindowLayout';
import { durationText } from '../looks/durationText';
import { addLabel } from '../../ui/labels';
import { addPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';
import { wrapByCharacter } from '../../ui/textLayout';
import { Tooltip } from './Tooltip';
import type { TooltipContent } from './Tooltip';

/**
 * オブジェクトウィンドウの**最低の横幅**（ステータス詳細のウィンドウと揃える）。中身の並びを持たない
 * ——説明文を出す——ウィンドウは、ちょうどこの幅になる。狭い画面では中身ごと縮める。
 *
 * **枠の少ないスロットでも、これより狭くしない。** 幅は最下段の操作のボタンの幅でもあるので、
 * 中身の少なさに合わせて詰めると、映しているものとは関係のない都合でボタンが窮屈になる。
 */
const MIN_WIDTH = 760;

/** タブの行の高さ（u単位）。タブが1つだけのウィンドウでは行そのものを空けない。 */
const TAB_HEIGHT = 64;

/** 組み込みのタブのラベル。 */
const DESCRIPTION_LABEL = '説明';
const PROPERTIES_LABEL = '状態';
const EXPLORATION_LABEL = '探索';

/** 説明文がまだ用意されていないオブジェクトに出す、代わりの1行。 */
const NO_DESCRIPTION = 'これについて分かっていることはまだ無い。';

/** 実行できない理由（reason、14.6節）が宣言されていないアクションに出す、代わりの1行。 */
const CANNOT_DO_NOW = '今はできない。';

/** ボタンとして並べる1つの操作。説明文とかかる時間は、ボタンの長押しで吹き出しに出す。 */
export interface ObjectWindowAction {
  readonly label: string;
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。0なら吹き出しに時間の行を出さない。 */
  readonly minutes: number;
  readonly onTap: () => void;

  /**
   * 今この操作を実行できるか（conditionsを満たしているか、GameElementDefinition.md 14節）。
   * falseなら押しても実行されず、押している間だけ理由（reason）を吹き出しに出す。
   */
  readonly enabled?: boolean;

  /** 実行できない理由の文言。宣言が無ければundefined（理由を出さない）。 */
  readonly reason?: string | undefined;
}

/** 説明のタブの識別子（タブの記憶の鍵、Windows.md 1.2節）。スロットのタブはスロット名を名乗る。 */
export const DESCRIPTION_TAB = 'description';

/** 組み込みのタブの識別子。スロット名と衝突しないよう、スロットに使えない文字を頭に付ける。 */
export const PROPERTIES_TAB = '@properties';
export const EXPLORATION_TAB = '@exploration';

/** ウィンドウが映しているオブジェクト。 */
export interface ObjectWindowTarget {
  /**
   * 説明のタブに置くカード。**元のレーンから借りてきた1枚そのもの**（Windows.md 1.1節）なので、
   * 渡す側は束ではなく1個ぶんの内容を渡す。操作は引き継がない（押しても掴んでも何も起きない）が、
   * 差し替えで同じ札だと分かるよう識別子だけは持つ。見出しの名前もここから採る。
   */
  readonly card: CardContent;

  /** 説明のタブに出す説明文。 */
  readonly description?: string;
}

/** ウィンドウが映しているスロット1つ＝タブ1つ。 */
export interface ObjectWindowSlot {
  /** タブの識別子（記憶の鍵）。呼び出し側はこれで「どのスロットのタブか」を引き当てる。 */
  readonly key: string;

  /** タブのラベル。スロットは必ず持ち主のものなので、持ち主込みの名前を呼び出し側が組み立てて渡す。 */
  readonly title: string;

  /** 並べる枠（slotCells）。カードも空き枠も枠の縁もこの1本が持ち、はみ出した分は横スクロールで送る。 */
  readonly cells: readonly LaneCell[];

  /** 落とせば枠が増えるスロットか（SlotView.cells）。増える前提で、レーンは頭打ちの枠数まで広げる。 */
  readonly grows: boolean;
}

export interface ObjectWindowOptions {
  /** 映しているオブジェクト。**常に持つ**——どのウィンドウも「何の」ウィンドウかは決まっている。 */
  readonly object: ObjectWindowTarget;

  /** 説明の後ろに並べるスロットのタブ（宣言順）。 */
  readonly slots: readonly ObjectWindowSlot[];

  /** スロットの後ろに並べる探索のタブ（探索できる場所だけ持つ）。 */
  readonly exploration?: ExplorationContent;

  /**
   * 最後に並べるプロパティのタブ（カテゴリごとのバー）。空なら出さない——見せると宣言した
   * プロパティ（property_tags、GameElementDefinition.md 6.7節）を1つも持たない物のこと。
   */
  readonly properties?: readonly PropertyCategory[];

  /** 最初に開くタブの識別子。知らない識別子と省略はどちらも説明のタブになる。 */
  readonly initialTab?: string;

  /** 横並びにする操作。「閉じる」はこの下にもう1行取るので、空なら最下段が閉じるだけになる。 */
  readonly actions: readonly ObjectWindowAction[];

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  /** タブが変わったときに、選ばれたタブの識別子を知らせる。 */
  readonly onTabChange?: (tab: string) => void;

  readonly onClose: () => void;
}

/**
 * カードやスロットのボタンを押すと開く子ウィンドウ（Windows.md 1節 子ウィンドウ）。
 *
 * 組み方はどれも同じ4段で、最上段が見出し（**常にオブジェクトの名前**）、その下がタブ、
 * 最下段がボタン（操作の行と「閉じる」の行、addActions）、間がタブの中身。
 *
 * **説明と中身の並びはタブで分ける**（Windows.md 1.2節）。どちらか一方しか出せないと、
 * オブジェクトの一面しか見せられない。
 *
 * **オブジェクト自身のカードは説明のタブにだけ出す。** スロットのタブは中段を丸ごと（札の枠のぶんも
 * 含めて）並びに使う。
 *
 * **寸法はタブによらず固定**（横幅はdecideWidth、高さは組み立て時に最も高いタブへ合わせる）。
 * 切り替えのたびに枠が伸び縮みすると、
 * どのタブが今開いているのかより枠の動きのほうが目に付く。
 */
export class ObjectWindow {
  /** 左に置く札の内容。説明のタブが出す1枚で、タブによらず借りたままにする。 */
  readonly card: CardContent;

  /** 開いている間ずっと在るもの（台紙・見出し・タブ）。 */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** 中身の並び（説明のタブではundefined）。ドラッグの対象として呼び出し側（PlayScene）が受け取る。 */
  private lane: CardLane | undefined;

  /**
   * 左に置く、そのオブジェクトのカードの枠（説明のタブでだけ持つ）。**枠1つのレーン**なので、
   * 他のカードを重ねる操作（combination・中へ入れる）がレーンとまったく同じ仕組みで効く
   * ——借りてきた札はここに在るので、手持ちからここへ落とせなければ石を打ち割れない。
   *
   * カードそのものは置かない（CardTableが並びの差し替えで置く）。
   */
  private ownLane: CardLane | undefined;

  /** 借りた札が最後に居た枠。スロットのタブでは描かないので、閉じたときの出発点として控える。 */
  private lastCardRect: Rect | undefined;

  /** タブのボタン（選択中だけ塗りを変えるので、作り直さず塗りだけ差し替える）。 */
  private readonly tabButtons: Button[] = [];

  /** 今開いているタブの識別子。 */
  private selected: string = DESCRIPTION_TAB;

  /** 最下段のボタン。setActionsで丸ごと作り直すので、他の表示物とは分けて持つ。 */
  private actionObjects: Phaser.GameObjects.GameObject[] = [];

  /** アクションのボタンを長押ししている間だけ出す吹き出し（addActions参照）。 */
  private readonly tooltip: Tooltip;

  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly onClose: () => void;

  /**
   * ボタンを並べる行（上が操作、下が「閉じる」）。作り直すときも同じ場所へ置く。
   *
   * **操作の行は、開いた時点で操作を持つウィンドウにだけ空ける。** 説明文だけのウィンドウで空の行を
   * 空けると、下に何も無い帯が残る。開いている間に操作の可否も並びも引き直す（setActions）。
   */
  private readonly actionRows: readonly Rect[];

  /** タブの中身を置く場所（左の札の枠と、右の段）。タブを切り替えても動かない。 */
  private readonly middle: { cardX: number; columnX: number; columnWidth: number; y: number; height: number };

  private readonly slots: readonly ObjectWindowSlot[];
  private properties: readonly PropertyCategory[];
  private exploration: ExplorationContent | undefined;
  private readonly description: Phaser.GameObjects.Text;
  private readonly onTabChange: ((tab: string) => void) | undefined;

  /** その面を開いている間だけ持つ中身。 */
  private propertiesPane: PropertiesPane | undefined;
  private explorationPane: ExplorationPane | undefined;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ObjectWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.onClose = options.onClose;
    this.onTabChange = options.onTabChange;
    this.slots = options.slots;
    this.properties = options.properties ?? [];
    this.exploration = options.exploration;
    this.card = options.object.card;

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const laneHeight = metrics.px(SIZE.laneHeight);

    // 覆いは領域の中だけに敷く。画面全体を覆うと、開いている間も操作できるはずの手持ちが覆いに
    // 入力を吸われる——借りた札へ手持ちから物を重ねられる以上、どのウィンドウも読み取り専用ではない。
    this.objects.push(addPanel(scene, options.area, COLOR.modalOverlay, 0.5));

    const windowWidth = this.decideWidth(metrics, options, padding);
    const contentWidth = windowWidth - padding * 2;
    // **カードは縮めない。** ここに在るのはレーンから借りてきた札そのもの（Windows.md 1.1節）なので、
    // 大きさが変わると別の札に見える。狭い画面でも取り分を削るのは文の側。
    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardHeight = metrics.px(SIZE.cardHeight);
    const columnWidth = contentWidth - cardWidth - gap;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const board = scene.add.graphics();
    this.objects.push(board);

    // **見出しは常にオブジェクトの名前。** スロットの名前はタブのラベルが持つ。
    const title = addLabel(scene, metrics, 0, 0, options.object.card.name, { size: 34, bold: true })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(contentWidth));

    this.description = addLabel(scene, metrics, 0, 0, options.object.description ?? NO_DESCRIPTION, {
      size: 26,
      color: options.object.description === undefined ? COLOR.textMuted : COLOR.text,
    }).setLineSpacing(metrics.px(6));
    this.description.setWordWrapCallback(wrapByCharacter(columnWidth));
    this.objects.push(this.description);

    // 中段の高さは**最も高いタブに合わせて固定**する。説明のタブは札と文のうち高いほう、
    // スロットのタブはレーン1本ぶん、プロパティのタブは決め打ちの行数ぶん。
    const middleHeight = Math.max(
      cardHeight,
      this.description.height,
      options.slots.length === 0 ? 0 : laneHeight,
      this.properties.length === 0 ? 0 : PropertiesPane.height(metrics),
      options.exploration === undefined ? 0 : ExplorationPane.height(metrics),
    );
    const tabsHeight = this.tabs().length <= 1 ? 0 : metrics.px(TAB_HEIGHT) + gap;
    // 最下段は「操作の行」と「閉じるの行」の2段。操作を持たないウィンドウでは1段（閉じるだけ）。
    const actionRows = options.actions.length === 0 ? 1 : 2;
    const actionsHeight = actionHeight * actionRows + gap * (actionRows - 1);
    const windowHeight = padding * 2 + title.height + gap + tabsHeight + middleHeight + gap + actionsHeight;
    const window = centerWindow(metrics, options.area, windowWidth, windowHeight);
    drawBox(board, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    title.setPosition(window.x + windowWidth / 2, window.y + padding);
    this.objects.push(title);

    const tabsY = window.y + padding + title.height + gap;
    this.addTabs({
      x: window.x + padding,
      y: tabsY,
      width: contentWidth,
      height: metrics.px(TAB_HEIGHT),
    });

    this.middle = {
      cardX: window.x + padding,
      columnX: window.x + padding + cardWidth + gap,
      columnWidth,
      y: tabsY + tabsHeight,
      height: middleHeight,
    };

    const actionsY = this.middle.y + middleHeight + gap;
    this.actionRows = Array.from({ length: actionRows }, (_, index) => ({
      x: window.x + padding,
      y: actionsY + index * (actionHeight + gap),
      width: contentWidth,
      height: actionHeight,
    }));
    this.addActions(options.actions);

    // 吹き出しはボタンより後に作る（表示順は生成順で決まるため、ボタンの上に出す必要がある）。
    this.tooltip = new Tooltip(scene, metrics);

    // 最初のタブは呼び出し側が決める（プログラムの指定＞記憶＞説明、Windows.md 1.2節）。知らない
    // 識別子は説明へ落とす。ここではonTabChangeを呼ばない——呼び出し側はまだこのウィンドウを持っていない。
    this.showTab(
      this.slots.some((slot) => slot.key === options.initialTab) ? options.initialTab! : DESCRIPTION_TAB,
    );
  }

  /** 中身の並び（説明のタブではundefined）。 */
  get contentLane(): CardLane | undefined {
    return this.lane;
  }

  /** 借りた札の枠（説明のタブでだけ在る）。 */
  get cardLane(): CardLane | undefined {
    return this.ownLane;
  }

  /**
   * プロパティの行の内容を書き直す（プロパティのタブを開いていなければ、次に開いたときの値として
   * 控えるだけ）。**控えないと、タブを切り替えた先に開いた時点の値が出る**——showTabはペインを
   * 作り直すので、控えを持たない側は古い値で組み立てられる（setExplorationと同じ形）。
   */
  setProperties(properties: readonly PropertyCategory[]): void {
    this.properties = properties;
    this.propertiesPane?.setCategories(properties);
  }

  /**
   * 探索率を書き直す（探索のタブを開いていなければ、次に開いたときの値として控えるだけ）。
   *
   * **発見物の並びはここを通しません。** レーンなので、他のレーンと一緒に差し替えを通ります
   * （PlayScene.laneViews）。
   */
  setExploration(exploration: ExplorationContent): void {
    this.exploration = exploration;
    this.explorationPane?.setRatio(exploration.ratio);
  }

  /**
   * プログラムからタブを開く。**記憶と同じ扱いで覚える**（呼び出し側がonTabChangeを受ける）
   * ——最後に見えていたものが次も見える、を破らないため。
   */
  openTab(tab: string): void {
    this.select(tab);
  }

  /** 発見物のレーン（探索のタブを開いていなければundefined）。 */
  get foundLane(): CardLane | undefined {
    return this.explorationPane?.lane;
  }

  /** タブの中身を置ける矩形（中段いっぱい）。 */
  private contentArea(): Rect {
    const { middle } = this;
    return {
      x: middle.cardX,
      y: middle.y,
      width: middle.columnX + middle.columnWidth - middle.cardX,
      height: middle.height,
    };
  }

  /** 借りた札の枠。運んでくる先・返すときの出発点で、**別のタブへ移っても最後の枠を覚えている**。 */
  get cardRect(): Rect | undefined {
    return this.ownLane?.cellRect(0) ?? this.lastCardRect;
  }

  /**
   * 出すタブを並び順で返す。説明 → スロット（宣言順）→ 踏査 → プロパティ。**タブの行を作るのも、
   * 今どれが選ばれているかを塗るのも、この並びが根拠**（行は組み立て時に1度だけ作る）。
   */
  private tabs(): readonly { readonly key: string; readonly title: string }[] {
    return [
      { key: DESCRIPTION_TAB, title: DESCRIPTION_LABEL },
      ...this.slots.map((slot) => ({ key: slot.key, title: slot.title })),
      ...(this.exploration === undefined ? [] : [{ key: EXPLORATION_TAB, title: EXPLORATION_LABEL }]),
      ...(this.properties.length === 0 ? [] : [{ key: PROPERTIES_TAB, title: PROPERTIES_LABEL }]),
    ];
  }

  /** タブの行。タブが1つ（＝説明しか無い）ウィンドウでは出さない。 */
  private addTabs(row: Rect): void {
    const labels = this.tabs();
    if (labels.length <= 1) return;

    const gap = this.metrics.px(8);
    const width = (row.width - gap * (labels.length - 1)) / labels.length;

    labels.forEach((tab, index) => {
      const button = addTextButton(
        this.scene,
        this.metrics,
        { x: row.x + index * (width + gap), y: row.y, width, height: row.height },
        tab.title,
        { fill: COLOR.button },
        () => this.select(tab.key),
      );
      this.tabButtons.push(button);
      this.objects.push(button);
    });
  }

  private select(tab: string): void {
    if (tab === this.selected) return;
    this.showTab(tab);
    this.onTabChange?.(tab);
  }

  /**
   * タブの中身を差し替える（どのタブが何を出すかはクラスのdoc参照）。借りた札はタブによらず
   * 借りたままで、描かれないだけ。
   */
  private showTab(tab: string): void {
    const { scene, metrics, middle } = this;
    this.selected = tab;
    if (this.ownLane !== undefined) this.lastCardRect = this.ownLane.cellRect(0);
    this.ownLane?.destroy();
    this.ownLane = undefined;
    this.lane?.destroy();
    this.lane = undefined;
    this.propertiesPane?.destroy();
    this.propertiesPane = undefined;
    this.explorationPane?.destroy();
    this.explorationPane = undefined;
    const tabs = this.tabs();
    this.tabButtons.forEach((button, index) =>
      button.setBoxStyle({
        fill: tabs[index]?.key === tab ? COLOR.buttonActive : COLOR.button,
        border: COLOR.buttonBorder,
        borderWidth: metrics.linePx(2),
        radius: metrics.px(SIZE.radius),
      }),
    );

    const slot = this.slots.find((candidate) => candidate.key === tab);
    this.description.setVisible(slot === undefined && tab !== PROPERTIES_TAB && tab !== EXPLORATION_TAB);

    if (tab === EXPLORATION_TAB && this.exploration !== undefined) {
      this.explorationPane = new ExplorationPane(
        scene,
        metrics,
        this.contentArea(),
        this.exploration,
        // 並ぶ札は差し替えが持ってくる（laneViews）。ここで置くのは休みの姿＝空の4枠だけ。
        foundCells([]),
      );
      return;
    }

    if (tab === PROPERTIES_TAB) {
      this.propertiesPane = new PropertiesPane(scene, metrics, this.contentArea(), this.properties);
      return;
    }

    if (slot === undefined) {
      const cardHeight = metrics.px(SIZE.cardHeight);
      this.ownLane = new CardLane(
        scene,
        metrics,
        {
          x: middle.cardX,
          y: middle.y + (middle.height - cardHeight) / 2,
          width: metrics.px(SIZE.cardWidth),
          height: cardHeight,
        },
        COLOR.slotWindowLane,
        [{ card: borrowedFace(this.card) }],
        { bare: true },
      );
      this.description.setPosition(middle.columnX, middle.y + (middle.height - this.description.height) / 2);
      return;
    }

    // 枠数の決まっているスロットは、レーンを枠の数まで縮めて中央へ寄せる。幅いっぱいのレーンに
    // 1枠だけ左詰めで置くと、どこへ落とすのかが読み取りにくい。
    const laneWidth = Math.min(middle.columnWidth + metrics.px(SIZE.cardWidth), laneWidthFor(metrics, slot));
    const laneHeight = metrics.px(SIZE.laneHeight);
    const contentWidth = middle.columnX + middle.columnWidth - middle.cardX;
    this.lane = new CardLane(
      scene,
      metrics,
      {
        x: middle.cardX + (contentWidth - laneWidth) / 2,
        y: middle.y + (middle.height - laneHeight) / 2,
        width: laneWidth,
        height: laneHeight,
      },
      COLOR.slotWindowLane,
      slot.cells,
      { clip: true },
    );
  }

  /**
   * 最下段のボタンを差し替える。**ボタンは作った時点の可否で固まっている**ので、中身を出し入れ
   * できるウィンドウでは、並びを差し替えるたびに呼び直す（PlayScene.showView）。素材を入れれば
   * 「作業する」が押せるようになり、抜けば押せなくなる。
   */
  setActions(actions: readonly ObjectWindowAction[]): void {
    for (const object of this.actionObjects) object.destroy();
    this.actionObjects = [];
    this.addActions(actions);
    // 作り直したボタンは吹き出しより後に生まれた＝手前にいるので、吹き出しを持ち上げ直す。
    this.tooltip.bringToTop();
  }

  /**
   * ウィンドウの横幅。**最も広いタブに合わせて固定**する（切り替えで枠を伸び縮みさせない）。
   * スロットのタブは枠の数から決め、少ないときに間延びしない。**一度に見せるのはLANE_CELLS_MAX枠まで**
   * なので、それを超える枠を持つスロットでも幅はそこで頭打ちになり、残りは横スクロールで送る。
   *
   * **どのウィンドウもMIN_WIDTHより狭くはしない。** 説明のタブはちょうどその幅で、枠の少ない
   * スロットもそこまで広げる。
   */
  private decideWidth(metrics: ScreenMetrics, options: ObjectWindowOptions, padding: number): number {
    const limit = Math.min(options.area.width, metrics.width * 0.92);
    const wanted = options.slots.map((slot) => laneWidthFor(metrics, slot) + padding * 2);
    if (options.exploration !== undefined) wanted.push(ExplorationPane.width(metrics) + padding * 2);
    return Math.min(Math.max(metrics.px(MIN_WIDTH), ...wanted), limit);
  }

  /**
   * 操作のボタンを並べる。**「閉じる」は操作と同じ行に置かない**——閉じるは世界を変えない別のもの
   * なのに同じ行に居ると、操作の数が閉じるの大きさを決め、閉じるが操作の幅を1つぶん削る。数で割る
   * 限りこの綱引きは消えないので、行を分けて切り離す。
   *
   * 閉じるが**常に最下段の同じ場所に在る**ことは変えない。スマホでは「押しやすい場所に必ず在る」
   * ことが、閉じる操作の値打ちそのものだからで、折り返しを採らないのもこれが理由
   * （数によって位置が動く）。
   *
   * どちらの行も幅は等分し、数が少ないときに間延びしないよう上限で頭打ちにして、行ごと中央へ寄せる。
   *
   * アクションのボタンは、長押しの間だけ説明文とかかる時間を吹き出しに出す。ボタンには名前しか
   * 載らないので、実行する前に「何が起きるか・どれだけ時間を取られるか」を確かめられるようにする。
   */
  private addActions(actions: readonly ObjectWindowAction[]): void {
    const close: ObjectWindowAction = {
      label: '閉じる',
      description: undefined,
      minutes: 0,
      onTap: () => {
        this.close();
        this.onClose();
      },
    };

    // 行が1つしか無いのは、開いた時点で操作が無かったウィンドウ（actionRows）。後から現れた操作は
    // 行き場が無いので、閉じると同じ行へ並べる（分かれる前の並べ方に落ちるだけ）。
    const rows = this.actionRows.length === 1 ? [[...actions, close]] : [[...actions], [close]];
    rows.forEach((buttons, index) => this.addButtonRow(this.actionRows[index], buttons, close));
  }

  /** 1行ぶんのボタンを、等分・上限つきで中央へ並べる。 */
  private addButtonRow(row: Rect, buttons: readonly ObjectWindowAction[], close: ObjectWindowAction): void {
    const { scene, metrics } = this;
    if (buttons.length === 0) return;

    const gap = metrics.px(ACTION_GAP);
    const buttonWidth = Math.min(
      metrics.px(ACTION_MAX_WIDTH),
      (row.width - gap * (buttons.length - 1)) / buttons.length,
    );
    const left = row.x + (row.width - (buttonWidth * buttons.length + gap * (buttons.length - 1))) / 2;

    buttons.forEach((action, index) => {
      const rect = {
        x: left + index * (buttonWidth + gap),
        y: row.y,
        width: buttonWidth,
        height: row.height,
      };
      const disabled = action.enabled === false;
      this.actionObjects.push(
        addTextButton(
          scene,
          metrics,
          rect,
          action.label,
          disabled
            ? { fill: COLOR.buttonDisabled, textColor: COLOR.textMuted }
            : { fill: action === close ? COLOR.button : COLOR.primaryButton },
          // 押せないボタンは実行しない。押している間の吹き出し（下）だけが反応になる。
          disabled ? () => {} : action.onTap,
          action === close ? undefined : this.tooltipHandlers(action, rect, disabled),
        ),
      );
    });
  }

  /**
   * ボタンを押している間だけ出す吹き出し。実行できるアクションは長押しで「何が起きるか・どれだけ時間を
   * 取られるか」を、実行できないアクションは押した瞬間に「なぜできないか」を出す（待たせる理由が無いため）。
   */
  private tooltipHandlers(action: ObjectWindowAction, rect: Rect, disabled: boolean): HoldHandlers {
    const content: TooltipContent = disabled
      ? { title: action.label, body: action.reason ?? CANNOT_DO_NOW }
      : { title: action.label, body: action.description, note: durationText(action.minutes) };

    return {
      onStart: () => this.tooltip.show(content, rect),
      onEnd: () => this.tooltip.hide(),
      delayMs: disabled ? 0 : undefined,
    };
  }

  close(): void {
    this.lane?.destroy();
    this.ownLane?.destroy();
    this.propertiesPane?.destroy();
    this.explorationPane?.destroy();
    this.tooltip.destroy();
    for (const object of [...this.objects, ...this.actionObjects]) object.destroy();
    this.objects.length = 0;
    this.actionObjects = [];
  }
}

/**
 * そのスロットのタブが要るレーンの幅。**枠の数は並べる枠そのもので決まる**——1枠しか無い場所に
 * 4枠空けると「4つ入る」と誤って伝わる。落とせば枠が増えるスロットは、増える前提で頭打ちまで取る。
 */
function laneWidthFor(metrics: ScreenMetrics, slot: ObjectWindowSlot): number {
  // 枠を1つも並べないスロット（要求を満たし切った材料）でも、レーンは1枠ぶんの幅を保つ。
  const wanted = slot.grows ? Number.POSITIVE_INFINITY : Math.max(1, slot.cells.length);
  return laneWidthForCells(metrics, wanted);
}
