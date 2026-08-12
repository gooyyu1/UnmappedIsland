import './codex.css';
import type { CodexSource } from './CodexSource';
import { loadCodexSource } from './CodexSource';
import type { NamingMode } from './CodexView';
import { CodexView, escapeHtml } from './CodexView';
import { networkNodeDomId, renderNetworkPage } from './networkPage';
import {
  renderNotFoundPage,
  renderObjectListPage,
  renderObjectPage,
  renderObjectsByTagPage,
  renderPropertyCandidatesPage,
  renderPropertyPage,
  renderSlotPage,
  renderTagListPage,
  tagSectionId,
} from './pages';

/**
 * WorldCodexデータベースビューアの入口（docs/world/WorldCodexViewer.md）。
 *
 * ゲーム本体と同じYAMLを同じローダーで読み、同じ表示文字列・同じ絵で見せる。ここが持つのは
 * ルーティングと描き込みだけで、内容の組み立てはpages.ts、見せ方の判断はCodexViewにある。
 */

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
  if (source === undefined) {
    app.innerHTML = '<p class="muted">読み込み中…</p>';
    return;
  }

  const view = new CodexView(source, namingMode);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

  app.innerHTML = renderRoute(view, parts);
  updateNamingToggle();
  wireObjectFilter();
  window.scrollTo(0, 0);
  scrollToTagSection(parts);
  scrollToNetworkNode(parts);
}

/** クラフトネットワークのハイライト対象（#/network/<識別子>）を図の中央へ出す。 */
function scrollToNetworkNode(parts: readonly string[]): void {
  if (parts[0] !== 'network' || parts[1] === undefined) return;
  document.getElementById(networkNodeDomId(parts[1]))?.scrollIntoView({ block: 'center', inline: 'center' });
}

/**
 * タグ別一覧（1ページに全タグが並ぶ）で、`#/by-tag/<タグ>` の節まで送る。ハッシュはルーティングに
 * 使っているので、ブラウザ任せのアンカー移動は使えない。
 */
function scrollToTagSection(parts: readonly string[]): void {
  if (parts[0] !== 'by-tag' || parts[1] === undefined) return;
  document.getElementById(tagSectionId(parts[1]))?.scrollIntoView();
}

function renderRoute(view: CodexView, parts: readonly string[]): string {
  if (parts.length === 0) return renderObjectListPage(view);
  if (parts[0] === 'object' && parts[1] !== undefined) return renderObjectPage(view, parts[1]);
  if (parts[0] === 'property' && parts[1] !== undefined && parts[2] !== undefined)
    return renderPropertyPage(view, parts[1], parts[2]);
  if (parts[0] === 'prop-candidates' && parts[1] !== undefined)
    return renderPropertyCandidatesPage(view, parts[1]);
  if (parts[0] === 'tags') return renderTagListPage(view);
  if (parts[0] === 'by-tag') return renderObjectsByTagPage(view);
  if (parts[0] === 'network') return renderNetworkPage(view, parts[1]);
  if (parts[0] === 'slot' && parts[1] !== undefined) return renderSlotPage(view, parts[1]);
  return renderNotFoundPage();
}

/** 一覧ページの絞り込み。並べ替えずに隠すだけなので、入力のたびに組み立て直さない。 */
function wireObjectFilter(): void {
  const input = document.getElementById('object-filter') as HTMLInputElement | null;
  if (input === null) return;

  const cards = [...document.querySelectorAll<HTMLElement>('.object-card')];
  const empty = document.getElementById('object-filter-empty');
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    for (const cardElement of cards) {
      const haystack = `${cardElement.dataset.name ?? ''} ${cardElement.dataset.label ?? ''}`;
      const matches = query === '' || haystack.toLowerCase().includes(query);
      cardElement.hidden = !matches;
      if (matches) shown++;
    }
    if (empty !== null) empty.hidden = shown > 0;
  });
  input.focus();
}

function updateNamingToggle(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-naming-mode]'))
    button.classList.toggle('active', button.dataset.namingMode === namingMode);
}

function setStatus(html: string): void {
  (document.getElementById('status') as HTMLElement).innerHTML = html;
}

function initialize(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-naming-mode]'))
    button.addEventListener('click', () => setNamingMode(button.dataset.namingMode as NamingMode));

  window.addEventListener('hashchange', render);
  render();

  loadCodexSource()
    .then((loaded) => {
      source = loaded;
      setStatus(`${loaded.files.length}ファイルを読み込みました`);
      render();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      appElement().innerHTML = `<div class="error"><strong>読み込みに失敗しました。</strong><br>${escapeHtml(message)}</div>`;
      setStatus('エラー');
    });
}

initialize();
