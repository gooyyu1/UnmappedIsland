/**
 * 実行時エラーを、そのまま貼れば原因を追える形で見せる。
 *
 * **握りつぶさず、画面に出す。** Phaserは毎フレームの呼び出し（tweenのonUpdate等）で投げられた
 * 例外を捕まえないので、そこで壊れると演出が完了せず、操作を受け付けないまま止まったように見える。
 * 何が起きたのか分からないまま固まるのが一番困るので、止まった画面の上へ報告を重ねる。
 *
 * **表示はDOMで行う。** ゲームの側が壊れていても読めなければ意味がない。
 *
 * **同じエラーは1件にまとめる。** 毎フレーム投げ続ける類のエラーでも、報告は1件のまま回数だけが
 * 増える。
 */

/**
 * 控えておく操作の数と、別々のものとして並べるエラーの数。どちらも古いものから捨てる。
 *
 * 操作はワールドを変えるものだけでなく、押した・掴んだ・開いた・組み立て直した、まで控える
 * （ワールドを変えない操作で壊れることもあり、そのときは直前の操作こそが再現手順になる）。
 * 1つの操作が数行に分かれる（カードを押した → 子ウィンドウを開いた）ので、そのぶん多めに取る。
 */
const OPERATION_LIMIT = 60;
const ERROR_LIMIT = 5;

/** 報告の文面を貼り直す最短間隔（ミリ秒）。毎フレームのエラーで文字が暴れないようにする。 */
const REFRESH_MS = 500;

/** 1回の操作。atは起動からの経過（ミリ秒）。 */
interface Operation {
  readonly at: number;
  readonly text: string;
}

/** 同じものとしてまとめた1件のエラー。 */
interface Reported {
  readonly message: string;
  readonly stack: string;
  readonly at: number;
  count: number;
}

const operations: Operation[] = [];
const reported = new Map<string, Reported>();
let stateReporter: (() => readonly string[]) | undefined;
let overlay: ErrorOverlay | undefined;

/**
 * 操作を1つ控える（エラー報告の「直前の操作」になる）。**実際に起きたことだけ**を書く——
 * 起きなかったこと（演出中で弾いた操作など）まで混ぜると、再現手順として読めなくなる。
 *
 * 控える側は、その出来事の名前を知っている場所（押されたボタン自身・掴まれたカード自身）に置く。
 * 呼び出し側ごとに書くと、新しい画面を足したときに record 漏れが起きる。
 */
export function noteOperation(text: string): void {
  operations.push({ at: performance.now(), text });
  if (operations.length > OPERATION_LIMIT) operations.shift();
}

/**
 * 今の画面の状態を答える人を差し替える（登録しなければ報告に載らない）。エラーの時点で壊れて
 * いるかもしれないので、答える側は例外を投げてもよい——報告はその旨を書いて続ける。
 */
export function setStateReporter(report: (() => readonly string[]) | undefined): void {
  stateReporter = report;
}

/** 実行時エラーの受け口を張る（起動時に1回）。 */
export function installErrorReport(): void {
  window.addEventListener('error', (event) => {
    receive(event.error, event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    receive(event.reason, '(Promiseの拒否)');
  });
}

/** エラーを1件受け取る。既に同じものが出ていれば回数を足すだけ。 */
function receive(error: unknown, fallback: string): void {
  try {
    const message = messageOf(error, fallback);
    const stack = stackOf(error);
    // 同じ場所から出た同じ文言なら同じエラー。呼び出し元が違えばスタックの先頭行が変わる。
    const key = `${message}\n${stack.split('\n')[0] ?? ''}`;

    const known = reported.get(key);
    if (known !== undefined) {
      known.count += 1;
    } else {
      reported.set(key, { message, stack, at: performance.now(), count: 1 });
      // 古いものから捨てる（新しいエラーの方が、今の症状に近い）。
      if (reported.size > ERROR_LIMIT) reported.delete(reported.keys().next().value as string);
    }

    overlay ??= new ErrorOverlay();
    overlay.show();
  } catch {
    // 報告そのものが壊れても、ここで投げ返すと受け口が例外の輪になる。
  }
}

/** そのまま貼れる報告の全文。 */
function buildReport(): string {
  const lines: string[] = ['UnmappedIsland 実行時エラー', `発生時刻: ${new Date().toLocaleString()}`, ''];

  [...reported.values()].forEach((entry, index) => {
    lines.push(`【エラー ${index + 1}】${entry.message}`);
    lines.push(
      `  起動から ${seconds(entry.at)} 秒${entry.count > 1 ? ` / 同じエラーが${entry.count}回` : ''}`,
    );
    lines.push(entry.stack);
    lines.push('');
  });

  lines.push('--- 直前の操作（古い順） ---');
  if (operations.length === 0) lines.push('（記録なし）');
  for (const operation of operations)
    lines.push(`  ${seconds(operation.at).padStart(7)}秒  ${operation.text}`);
  lines.push('');

  lines.push('--- 画面の状態 ---');
  lines.push(...describeState());
  lines.push('');

  lines.push('--- 環境 ---');
  lines.push(`  画面: ${window.innerWidth}x${window.innerHeight} / dpr ${window.devicePixelRatio}`);
  lines.push(`  UA: ${navigator.userAgent}`);
  return lines.join('\n');
}

/** 登録されている報告者に今の状態を訊く。壊れていればその旨を返す（報告自体は続ける）。 */
function describeState(): readonly string[] {
  if (stateReporter === undefined) return ['  （プレイ画面の外）'];

  try {
    return stateReporter().map((line) => `  ${line}`);
  } catch (error) {
    return [`  （状態を読めなかった: ${messageOf(error, '不明')}）`];
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : fallback;
}

function stackOf(error: unknown): string {
  const stack = error instanceof Error ? error.stack : undefined;
  return stack === undefined ? '  （スタックトレースなし）' : stack;
}

function seconds(at: number): string {
  return (at / 1000).toFixed(1);
}

/**
 * 報告を重ねる幕。パネルの外は操作を通す——エラーの後もゲームが動くなら、そのまま遊べる方がよい。
 */
class ErrorOverlay {
  private readonly panel: HTMLDivElement;
  private readonly body: HTMLPreElement;
  private readonly copyButton: HTMLButtonElement;
  private refreshedAt = 0;

  constructor() {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'top:0',
      'max-height:70%',
      'z-index:2147483647',
      'display:none',
      'flex-direction:column',
      'background:rgba(20,16,12,0.95)',
      'color:#ffe9c8',
      'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'border-bottom:2px solid #d9534f',
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;background:#d9534f;color:#fff';
    const title = document.createElement('strong');
    title.textContent = 'エラーが発生しました';
    title.style.cssText = 'flex:1;font-size:13px';

    this.copyButton = document.createElement('button');
    this.copyButton.textContent = 'コピー';
    const closeButton = document.createElement('button');
    closeButton.textContent = '閉じる';
    for (const button of [this.copyButton, closeButton]) {
      button.style.cssText = 'font:inherit;padding:6px 14px;border:0;border-radius:4px;cursor:pointer';
    }
    this.copyButton.addEventListener('click', () => void this.copy());
    closeButton.addEventListener('click', () => {
      this.panel.style.display = 'none';
    });
    bar.append(title, this.copyButton, closeButton);

    this.body = document.createElement('pre');
    this.body.style.cssText = 'margin:0;padding:8px;overflow:auto;white-space:pre-wrap;user-select:text';

    panel.append(bar, this.body);
    document.body.appendChild(panel);
    this.panel = panel;
  }

  /** 幕を出し、文面を貼り直す（間隔を空ける。毎フレームのエラーで文字が暴れないように）。 */
  show(): void {
    this.panel.style.display = 'flex';

    const now = performance.now();
    if (now - this.refreshedAt < REFRESH_MS) return;
    this.refreshedAt = now;
    // 読んでいる最中に貼り直すと、選んでいた範囲が外れる。
    if (window.getSelection()?.isCollapsed === false) return;

    this.body.textContent = buildReport();
  }

  /**
   * 報告をクリップボードへ写す。クリップボードを触れない状況（安全でないつなぎ方で開いたページ等）
   * では、文面を選択した状態にして手で写せるようにする。
   */
  private async copy(): Promise<void> {
    const text = buildReport();
    this.body.textContent = text;

    try {
      await navigator.clipboard.writeText(text);
      this.copyButton.textContent = 'コピーしました';
      return;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(this.body);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.copyButton.textContent = '選択しました（手でコピー）';
    }
  }
}
