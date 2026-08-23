import './codex.css';
import { installSampleAssetPack } from '../asset-pack/install';
import type { CodexSource } from './CodexSource';
import { loadCodexSource } from './CodexSource';
import type { NamingMode } from './CodexView';
import { CodexView } from './CodexView';
import { escapeHtml } from './html';
import type { CodexPage } from './CodexPage';
import { BalancePage } from './balancePage';
import { NetworkPage } from './networkPage';
import {
  ObjectListPage,
  ObjectPage,
  ObjectsByTagPage,
  PropertyCandidatesPage,
  PropertyPage,
  SlotPage,
  TagListPage,
  renderNotFoundPage,
} from './pages';

/**
 * WorldCodexデータベースビューアの入口。実際のゲームデータ（src/world-codex/*.yaml）を、型・
 * プロパティ・スロット・操作の単位で辿って読むための閲覧ツール（npm run dev:codex、公開先は/codex/）。
 *
 * ゲーム本体と同じYAMLを同じローダーで読み、同じ表示文字列・同じ絵で見せる。ここが持つのは
 * ルーティングと描き込みだけで、内容の組み立てはpages.ts、見せ方の判断はCodexViewにある。
 */

/**
 * 辿れるページはこれで全部。**1つずつ作って使い回す**ので、開き直しても残るもの（図の倍率、
 * 描いた表）はページ自身が持てる。routeが合わなければ「見つかりません」。
 */
const PAGES: readonly CodexPage[] = [
  new ObjectListPage(),
  new ObjectPage(),
  new PropertyPage(),
  new PropertyCandidatesPage(),
  new TagListPage(),
  new ObjectsByTagPage(),
  new NetworkPage(),
  new BalancePage(),
  new SlotPage(),
];

/** 参照の見せ方（表示名/識別子）の記憶先。読む人ごとに好みが変わるので、次に開いたときも保たれるようにする。 */
const NAMING_MODE_KEY = 'worldCodexViewer.namingMode';

let source: CodexSource | undefined;
let namingMode: NamingMode = readNamingMode();

function readNamingMode(): NamingMode {
  return localStorage.getItem(NAMING_MODE_KEY) === 'identifier' ? 'identifier' : 'display';
}

function setNamingMode(mode: NamingMode): void {
  namingMode = mode;
  localStorage.setItem(NAMING_MODE_KEY, mode);
  render();
}

function appElement(): HTMLElement {
  return document.getElementById('app') as HTMLElement;
}

function render(): void {
  const app = appElement();
  // 読み込みに失敗したときは、出したエラーをそのまま残す（ハッシュを変えても描き替えない）。
  if (source === undefined) return;

  const view = new CodexView(source, namingMode);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const args = parts.slice(1);

  const page = PAGES.find((candidate) => candidate.route === (parts.at(0) ?? ''));
  const html = page?.render(view, args);
  // 出せなかった道筋には配線も節も無いので、実際に出したページだけに続きを頼む。
  const shown = html === undefined ? undefined : page;

  app.innerHTML = html ?? renderNotFoundPage();
  updateNamingToggle();
  shown?.wire();
  window.scrollTo(0, 0);

  const name = args.at(0);
  if (name !== undefined) shown?.scrollToSection(name);
}

function updateNamingToggle(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-naming-mode]'))
    button.classList.toggle('active', button.dataset.namingMode === namingMode);
}

function setStatus(html: string): void {
  (document.getElementById('status') as HTMLElement).innerHTML = html;
}

async function initialize(): Promise<void> {
  // ビューアはゲーム側の設定によらず常に読む。読むかどうかを選べるのは、パックの物が世界に混ざる
  // のを避けるためで（StartScreen.md 画面構成 4）、ここは世界を始めずに定義を読むだけの道具。
  await installSampleAssetPack();

  for (const button of document.querySelectorAll<HTMLElement>('[data-naming-mode]'))
    button.addEventListener('click', () => setNamingMode(button.dataset.namingMode as NamingMode));

  window.addEventListener('hashchange', render);

  try {
    source = loadCodexSource();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    appElement().innerHTML = `<div class="error"><strong>読み込みに失敗しました。</strong><br>${escapeHtml(message)}</div>`;
    setStatus('エラー');
    return;
  }

  setStatus(`${source.files.length}ファイルを読み込みました`);
  render();
}

await initialize();
