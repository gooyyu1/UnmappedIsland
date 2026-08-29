import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { TabButtons, addTextButton } from './Button';
import type { HoldHandlers } from './Button';
import type { CardContent } from './Card';
import type { CardLane } from './CardLane';
import { DescriptionPane } from './DescriptionPane';
import type { ExplorationContent } from './ExplorationPane';
import { ExplorationPane } from './ExplorationPane';
import type { ObjectWindowLane, ObjectWindowLaneRole, ObjectWindowPane } from './ObjectWindowPane';
import { OpenPane } from './OpenPane';
import type { PropertyCategory } from './PropertiesPane';
import { PropertiesPane } from './PropertiesPane';
import type { ObjectWindowSlot } from './SlotPane';
import { SlotPane } from './SlotPane';
import { foundCells } from './laneCells';
import {
  ACTION_GAP,
  ACTION_HEIGHT,
  ACTION_MAX_WIDTH,
  CONTENT_GAP,
  MIN_WINDOW_WIDTH,
  WINDOW_PADDING,
  centeredWindowRect,
} from '../looks/childWindowLayout';
import { timeCostLine } from '../looks/timeTexts';
import { addLabel } from '../../ui/labels';
import { addInputBlockingPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';
import { Tooltip } from './Tooltip';
import type { TooltipContent } from './Tooltip';
import { uiText } from '../../locale/uiTexts';

export type { ObjectWindowSlot } from './SlotPane';

/** タブの行の高さ（u単位）。タブが1つだけのウィンドウでは行そのものを空けない。 */
const TAB_HEIGHT = 64;

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
const PROPERTIES_TAB = '@properties';
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

  /** 最初に開くタブの識別子（並んでいるどのタブでもよい）。知らない識別子と省略はどちらも説明のタブになる。 */
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
 * タブ1つぶんの宣言。**窓が中身について知るのはこれだけ**——ラベルと、要る寸法と、面の作り方。
 * タブの種類を増やすのはここへ1つ足すことで、窓のどこにも分岐は増えない。
 */
interface TabSpec {
  readonly key: string;
  readonly title: string;

  /** その面が要る幅。窓の幅はこれを下回らない。要求が無ければ0。 */
  readonly width: number;

  /** その面が要る高さ。中段の幅で文を折り返す面があるので、幅を受け取る。 */
  readonly height: (contentWidth: number) => number;

  readonly create: (area: Rect) => ObjectWindowPane;
}

/**
 * カードやスロットのボタンを押すと開く子ウィンドウ（Windows.md 1節 子ウィンドウ）。
 *
 * 組み方はどれも同じ4段で、最上段が見出し（**常にオブジェクトの名前**）、その下がタブ、
 * 最下段がボタン（操作の行と「閉じる」の行、addActions）、間がタブの中身。
 *
 * **タブの中身は面（ObjectWindowPane）が丸ごと持つ。** 窓がするのは、開いている面を捨てて次の面を
 * 作ることだけで、何がどう描かれるかは知らない。だから「説明のタブだけがオブジェクト自身のカードを
 * 出す」も「スロットのタブは中段を丸ごと並びに使う」も、窓ではなくそれぞれの面が決めている。
 *
 * **説明と中身の並びはタブで分ける**（Windows.md 1.2節）。どちらか一方しか出せないと、
 * オブジェクトの一面しか見せられない。
 *
 * **寸法はタブによらず固定**（横幅・高さとも、最も要求の大きい面へ合わせる）。切り替えのたびに枠が
 * 伸び縮みすると、どのタブが今開いているのかより枠の動きのほうが目に付く。
 */
export class ObjectWindow {
  /** 開いている間ずっと在るもの（台紙・見出し・タブ）。 */
  private readonly ownedObjects: Phaser.GameObjects.GameObject[] = [];

  /** 出せるタブ（並び順）。**タブの行を作るのも、今どれが選ばれているかを塗るのも、この並びが唯一の根拠。** */
  private readonly tabSpecs: readonly TabSpec[];

  /** 今開いているタブの中身。切り替えのたびに捨てて作り直す。 */
  private readonly pane = new OpenPane();

  /** タブのボタン（選択中だけ塗りを変えるので、作り直さず塗りだけ差し替える）。 */
  private readonly tabs: TabButtons;

  /** 今開いているタブの識別子（replacePaneが、実際に開いた面のものを入れる）。 */
  private openedTabKey: string = DESCRIPTION_TAB;

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

  /** タブの中身を置く矩形（中段いっぱい）。タブを切り替えても動かない。 */
  private readonly content: Rect;

  /** 面が読み直す元。面は作られた時点ではなく、読み直すたびにここを見る。 */
  private properties: readonly PropertyCategory[];
  private exploration: ExplorationContent | undefined;

  private readonly onTabChange: ((tab: string) => void) | undefined;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ObjectWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.onClose = options.onClose;
    this.onTabChange = options.onTabChange;
    this.properties = options.properties ?? [];
    this.exploration = options.exploration;
    this.tabs = new TabButtons(metrics);
    this.tabSpecs = this.buildTabs(options);

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);

    // 覆いは領域の中だけに敷く。画面全体を覆うと、開いている間も操作できるはずの手持ちが覆いに
    // 入力を吸われる——借りた札へ手持ちから物を重ねられる以上、どのウィンドウも読み取り専用ではない。
    this.ownedObjects.push(addInputBlockingPanel(scene, options.area, COLOR.modalOverlay, 0.5));

    const windowWidth = decideWidth(metrics, options.area, this.tabSpecs, padding);
    const contentWidth = windowWidth - padding * 2;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const board = scene.add.graphics();
    this.ownedObjects.push(board);

    // **見出しは常にオブジェクトの名前。** スロットの名前はタブのラベルが持つ。
    const title = addLabel(scene, metrics, 0, 0, options.object.card.name, {
      size: 34,
      bold: true,
      wrapWidthPx: contentWidth,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');

    // 中段の高さは**最も高いタブに合わせて固定**する。
    const middleHeight = Math.max(...this.tabSpecs.map((tab) => tab.height(contentWidth)));
    const tabsHeight = this.tabSpecs.length <= 1 ? 0 : metrics.px(TAB_HEIGHT) + gap;
    // 最下段は「操作の行」と「閉じるの行」の2段。操作を持たないウィンドウでは1段（閉じるだけ）。
    const actionRows = options.actions.length === 0 ? 1 : 2;
    const actionsHeight = actionHeight * actionRows + gap * (actionRows - 1);
    const windowHeight = padding * 2 + title.height + gap + tabsHeight + middleHeight + gap + actionsHeight;
    const window = centeredWindowRect(metrics, options.area, windowWidth, windowHeight);
    drawBox(board, window, { fillColor: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    title.setPosition(window.x + windowWidth / 2, window.y + padding);
    this.ownedObjects.push(title);

    const tabsY = window.y + padding + title.height + gap;
    this.addTabs({
      x: window.x + padding,
      y: tabsY,
      width: contentWidth,
      height: metrics.px(TAB_HEIGHT),
    });

    this.content = {
      x: window.x + padding,
      y: tabsY + tabsHeight,
      width: contentWidth,
      height: middleHeight,
    };

    const actionsY = this.content.y + middleHeight + gap;
    this.actionRows = Array.from({ length: actionRows }, (_, index) => ({
      x: window.x + padding,
      y: actionsY + index * (actionHeight + gap),
      width: contentWidth,
      height: actionHeight,
    }));
    this.addActions(options.actions);

    this.tooltip = new Tooltip(scene, metrics);

    // 最初のタブは呼び出し側が決める（プログラムの指定＞記憶＞説明、Windows.md 1.2節）。
    // openTabではなくこちらを呼ぶのは、onTabChangeを鳴らさないため——呼び出し側はまだこの
    // ウィンドウを持っていないので、開いたことを知らせる相手が居ない。
    this.replacePane(options.initialTab);
  }

  /** 今開いている面が持つレーン（役割つき）。面がレーンを持たなければ空。 */
  get lanes(): readonly ObjectWindowLane[] {
    return this.pane.lanes;
  }

  /** その役割のレーン。今開いている面が持たなければundefined。 */
  laneOf(role: ObjectWindowLaneRole): CardLane | undefined {
    return this.pane.laneOf(role);
  }

  /**
   * 今開いているタブの識別子。**呼び出し側の指定がそのまま通るとは限らない**（並んでいないタブは
   * 説明へ落ちる）ので、覚えるのも場所を引くのもこちらを見る。
   */
  get openedTab(): string {
    return this.openedTabKey;
  }

  /**
   * その役割のレーンの、添字の位置の枠。借りた札を運んでくる先・返すときの出発点で、**別のタブへ
   * 移っても、窓を閉じたあとも最後の枠を覚えている**（OpenPane）。
   */
  cellRect(role: ObjectWindowLaneRole, index: number): Rect | undefined {
    return this.pane.cellRect(role, index);
  }

  /**
   * プロパティの行の内容を書き直す。**開いている面がどれでも控えは残す**——面は読み直すたびにここを
   * 見るので、次に開いたときには最新の値で組み立てられる（setExplorationと同じ形）。
   */
  setProperties(properties: readonly PropertyCategory[]): void {
    this.properties = properties;
    this.pane.refresh();
  }

  /**
   * 探索率を書き直す。
   *
   * **発見物の並びはここを通しません。** レーンなので、他のレーンと一緒に差し替えを通ります
   * （PlayScene.shownLanes）。
   */
  setExploration(exploration: ExplorationContent): void {
    this.exploration = exploration;
    this.pane.refresh();
  }

  /**
   * タブを開く（タブのボタンも、プログラムからの指定もここを通る）。**記憶と同じ扱いで覚える**
   * （呼び出し側がonTabChangeを受ける）——最後に見えていたものが次も見える、を破らないため。
   *
   * 既に開いているタブなら何もしない。面を作り直すと、そこに借りている札ごと捨てることになる。
   */
  openTab(tab: string): void {
    if (tab === this.openedTabKey) return;
    this.replacePane(tab);
    this.onTabChange?.(this.openedTabKey);
  }

  /**
   * 出すタブを並び順に組み立てる。説明 → スロット（宣言順）→ 探索 → プロパティ。
   *
   * **説明のタブは必ず在り、必ず先頭**なので、知らない識別子はここへ落ちる（replacePane）。
   */
  private buildTabs(options: ObjectWindowOptions): readonly TabSpec[] {
    const { scene, metrics } = this;
    const { card, description } = options.object;
    const exploration = options.exploration;

    return [
      {
        key: DESCRIPTION_TAB,
        title: uiText('description'),
        width: 0,
        height: (contentWidth) => DescriptionPane.height(scene, metrics, contentWidth, description),
        create: (area) => new DescriptionPane(scene, metrics, area, card, description),
      },
      ...options.slots.map((slot) => ({
        key: slot.key,
        title: slot.title,
        width: SlotPane.width(metrics, slot),
        height: () => SlotPane.height(metrics),
        create: (area: Rect) => new SlotPane(scene, metrics, area, slot),
      })),
      ...(exploration === undefined
        ? []
        : [
            {
              key: EXPLORATION_TAB,
              title: exploration.title,
              width: ExplorationPane.width(metrics),
              height: () => ExplorationPane.height(metrics),
              create: (area: Rect) =>
                new ExplorationPane(
                  scene,
                  metrics,
                  area,
                  () => this.exploration ?? exploration,
                  // 並ぶ札は差し替えが持ってくる（laneViews）。ここで置くのは休みの姿＝空の4枠だけ。
                  foundCells([]),
                ),
            },
          ]),
      ...(this.properties.length === 0
        ? []
        : [
            {
              key: PROPERTIES_TAB,
              title: uiText('properties'),
              width: 0,
              height: () => PropertiesPane.height(metrics),
              create: (area: Rect) => new PropertiesPane(scene, metrics, area, () => this.properties),
            },
          ]),
    ];
  }

  /** タブの行。タブが1つ（＝説明しか無い）ウィンドウでは出さない。 */
  private addTabs(row: Rect): void {
    if (this.tabSpecs.length <= 1) return;

    const gap = this.metrics.px(8);
    const width = (row.width - gap * (this.tabSpecs.length - 1)) / this.tabSpecs.length;

    this.tabSpecs.forEach((tab, index) => {
      const button = addTextButton(
        this.scene,
        this.metrics,
        { x: row.x + index * (width + gap), y: row.y, width, height: row.height },
        tab.title,
        { fill: COLOR.button },
        () => this.openTab(tab.key),
      );
      this.tabs.add(button);
      this.ownedObjects.push(button);
    });
  }

  /**
   * 開いている面を捨てて、そのタブの面を作る。**窓が中身に触れるのはここだけ**で、触れ方は
   * 「捨てて作る」しかない。借りた札はタブによらず借りたままで、描かれないだけ。
   *
   * **並んでいないタブと省略は説明の面へ落とし、落とした先を開いたタブとして覚える**（openedTab）。
   * 要求のほうを覚えると、出ていないタブを記憶に書き、その場所を引こうとすることになる。
   */
  private replacePane(tab: string | undefined): void {
    // 説明のタブは必ず在り、必ず先頭（buildTabs）。
    const spec = this.tabSpecs.find((candidate) => candidate.key === tab) ?? this.tabSpecs[0];
    this.openedTabKey = spec.key;

    this.tabs.select(this.tabSpecs.indexOf(spec));

    this.pane.replace(() => spec.create(this.content));
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
      label: uiText('close'),
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
      ? { title: action.label, body: action.reason ?? uiText('cannot_do_now') }
      : { title: action.label, body: action.description, note: timeCostLine(action.minutes) };

    return {
      onStart: () => this.tooltip.show(content, rect),
      onEnd: () => this.tooltip.hide(),
      delayMs: disabled ? 0 : undefined,
    };
  }

  close(): void {
    this.pane.close();
    this.tooltip.destroy();
    for (const object of [...this.ownedObjects, ...this.actionObjects]) object.destroy();
    this.ownedObjects.length = 0;
    this.actionObjects = [];
  }
}

/**
 * ウィンドウの横幅。**最も広いタブに合わせて固定**する（切り替えで枠を伸び縮みさせない）。
 *
 * **どのウィンドウもMIN_WINDOW_WIDTHより狭くはしない。** 説明のタブはちょうどその幅で、幅を要求しない
 * タブしか無いウィンドウもそこまで広げる。
 */
function decideWidth(metrics: ScreenMetrics, area: Rect, tabs: readonly TabSpec[], padding: number): number {
  const limit = Math.min(area.width, metrics.width * 0.92);
  const wanted = tabs.map((tab) => tab.width + padding * 2);
  return Math.min(Math.max(metrics.px(MIN_WINDOW_WIDTH), ...wanted), limit);
}
