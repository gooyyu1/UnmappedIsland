import { DescriptionWriter } from './describe/Description';
import {
  creates,
  describeInfluencesOn,
  describeObjectDef,
  usesInRecipes,
} from './describe/describeObjectDef';
import { describePassive } from './describe/describePassive';
import { describeInteraction } from './describe/describeInteraction';
import { initialValueTokens, describeProperty } from './describe/describeProperty';
import { describeRecipe } from './describe/describeRecipe';
import { describeAccept, putInDurationTokens } from './describe/describeSlot';
import type { InteractionDef } from '../domain/InteractionDef';
import type { ObjectDef } from '../domain/ObjectDef';
import type { SlotDef } from '../domain/SlotDef';
import { ART_BY_OBJECT_NAME } from '../art/objectArt';
import { isInCraftingNetwork } from './networkPage';
import { CodexPage } from './CodexPage';
import type { CodexView } from './CodexView';
import { EMPTY_HTML, escapeHtml, inlineArtHtml } from './html';

/**
 * 型・プロパティ・スロット・タグを辿るページ（CodexPage参照）。組み立てはDOMに触らず文字列を返す
 * だけにして、描き込み（main.ts）と分けている。
 */

/** オブジェクト一覧（入口のページ）。 */
function renderObjectListPage(view: CodexView): string {
  const defs = [...view.objectDefs()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const cards = defs.map((def) => objectCardHtml(view, def)).join('');

  return (
    `<h1>オブジェクト一覧</h1>` +
    `<p class="muted" title="${escapeHtml(view.source.files.join(', '))}">` +
    `${defs.length}件のobject_def（${view.source.files.length}ファイル）／` +
    `<a href="#/by-tag">タグ別の一覧</a>／<a href="#/tags">タグ一覧</a>／` +
    `<a href="#/network">クラフトネットワーク</a>／<a href="#/balance">収支</a></p>` +
    `<p><input id="object-filter" type="search" placeholder="名前で絞り込む" autocomplete="off"></p>` +
    `<div class="object-grid">${cards}</div>` +
    `<p class="muted" id="object-filter-empty" hidden>該当するオブジェクトがありません。</p>`
  );
}

/** オブジェクトの詳細。 */
function renderObjectPage(view: CodexView, name: string): string {
  const def = view.objectDef(name);
  if (def === undefined) return errorPage(`object_def '${escapeHtml(name)}' が見つかりません。`);

  const description = view.objectDescription(name);
  const base = view.codex.isGenerated(def) ? view.codex.baseOf(def) : undefined;

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<div class="detail-header">` +
    artHtml(view, def, 'large') +
    `<div>` +
    `<h1>${escapeHtml(view.objectLabel(name))}</h1>` +
    identifierLine(view, view.objectLabel(name), name, view.objectDisplayName(name)) +
    (description === undefined ? '' : `<p class="lead">${escapeHtml(description)}</p>`) +
    `<p>${tagChipsHtml(view, def)}</p>` +
    (base === undefined
      ? ''
      : `<p class="muted">自動生成された変種（素の型: ` +
        `<a href="${view.objectHref(base.name)}">${escapeHtml(view.objectLabel(base.name))}</a>）</p>`) +
    (isInCraftingNetwork(view, name)
      ? `<p><a href="#/network/${encodeURIComponent(name)}">クラフトネットワークで見る</a></p>`
      : '') +
    `</div></div>` +
    section(
      '型の性質',
      view.describeHtml(name, (out) => describeObjectDef(def, view.names, out)),
    ) +
    section('props', propertiesHtml(view, def)) +
    section('slots', slotsHtml(view, def)) +
    section(
      'passives（持続効果）',
      view.describeHtml(name, (out) => {
        for (const effect of def.passives.declarations) describePassive(effect, view.names, out);
      }),
    ) +
    section('actions（メニューから選ぶ操作）', interactionsHtml(view, def, def.actions)) +
    section('combinations（カードを重ねる操作）', interactionsHtml(view, def, def.combinations)) +
    section('recipes', recipesHtml(view, def)) +
    variantsSection(view, name) +
    // 逆引きはどちらも、行き先の型を絵で並べるだけにする——どの操作・どの工程かはリンク先で分かる。
    section(
      'この型を生み出すもの',
      matchingObjectsHtml(view, (other) => creates(other, def.globalId)),
    ) +
    section(
      'この型を材料・道具に使うもの',
      matchingObjectsHtml(view, (other) => usesInRecipes(other, def)),
    )
  );
}

/** 条件に当てはまる型を、一覧と同じ絵つきのカードで並べる。 */
function matchingObjectsHtml(view: CodexView, matches: (def: ObjectDef) => boolean): string {
  return objectGridHtml(
    view,
    view
      .objectDefs()
      .filter(matches)
      .map((def) => def.name),
  );
}

/**
 * 土地の型の亜種（TerrainGeneration.md 3.6節）。亜種の名前は型の名前を置き換える——
 * 「砂浜のヤシの浜」ではなく「ヤシの浜」（Localization.md）。
 */
function variantsSection(view: CodexView, objectName: string): string {
  const locationType = view.locationTypeOf(objectName);
  if (locationType === undefined || locationType.variants.length === 0) return '';

  const texts = view.locale.location(locationType.name);
  const rows = locationType.variants
    .map((variant) => {
      const variantTexts = texts.variant(variant.id);
      return (
        `<tr><td>${escapeHtml(variantTexts.displayName)}` +
        `${untranslatedBadge(view, variant.id, variantTexts.displayName)}</td>` +
        `<td><code>${escapeHtml(variant.id)}</code></td>` +
        `<td>${escapeHtml(variantTexts.description ?? '')}</td></tr>`
      );
    })
    .join('');

  return section(
    '亜種（土地の名前）',
    `<table><thead><tr><th>名前</th><th>識別子</th><th>説明</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

/** プロパティの詳細。プロパティの定義はobject_defごとに違いうるので、型とセットでのみ一意に決まる。 */
function renderPropertyPage(view: CodexView, objectName: string, propertyName: string): string {
  const def = view.objectDef(objectName);
  if (def === undefined) return errorPage(`object_def '${escapeHtml(objectName)}' が見つかりません。`);

  const propertyGlobalId = view.codex.propertyNames.tryGetId(propertyName);
  const propertyDef = propertyGlobalId === undefined ? undefined : def.tryGetPropertyDef(propertyGlobalId);
  if (propertyDef === undefined || propertyGlobalId === undefined)
    return errorPage(`'${escapeHtml(objectName)}' に '${escapeHtml(propertyName)}' というpropはありません。`);

  const texts = view.locale.object(objectName).prop(propertyName);
  const others = view
    .objectsWithProperty(propertyName)
    .filter((other) => other !== objectName)
    .map(
      (other) =>
        `<li><a href="${view.propertyHref(other, propertyName)}">` +
        `${escapeHtml(view.objectLabel(other))}</a></li>`,
    )
    .join('');

  return (
    `<p class="breadcrumb"><a href="${view.objectHref(objectName)}">← ` +
    `${escapeHtml(view.objectLabel(objectName))}</a></p>` +
    `<h1>${escapeHtml(view.propertyLabel(objectName, propertyName))}</h1>` +
    `<p class="identifier"><code>${escapeHtml(objectName)}.${escapeHtml(propertyName)}</code>` +
    `${untranslatedBadge(view, propertyName, texts.displayName)}</p>` +
    (texts.description === undefined ? '' : `<p class="lead">${escapeHtml(texts.description)}</p>`) +
    section(
      '定義',
      view.describeHtml(objectName, (out) => describeProperty(propertyDef, view.names, out)),
    ) +
    section('影響元', influencesHtml(view, def, propertyGlobalId)) +
    section('同じ名前のpropを持つ他の型', others === '' ? EMPTY_HTML : `<ul class="plain">${others}</ul>`)
  );
}

/**
 * タグの一覧。タグは型のグループを指す唯一の手段（`CodexView.objectsWithTag`）なので、
 * 「どんなまとまりがあるか」を見渡す入口になる。一覧に出す型が1つも無いタグ（製作中オブジェクト
 * だけが持つwipなど）は、行き先が空になるので出さない。
 */
function renderTagListPage(view: CodexView): string {
  const cards = view
    .tagNames()
    .map((tag) => ({ tag, owners: view.objectsWithTag(tag) }))
    .filter(({ owners }) => owners.length > 0)
    .map(
      ({ tag, owners }) =>
        `<a class="object-card" href="${view.tagHref(tag)}">` +
        tagArtHtml(view, owners) +
        `<span class="object-card-name">${escapeHtml(tag)} ` +
        `<span class="muted">(${owners.length})</span></span></a>`,
    )
    .join('');

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>タグ一覧</h1>` +
    `<p class="muted">object_defのタグ（4.1節）。型のグループを指す唯一の手段で、` +
    `スロットの受け入れ条件やcombinationsの相手もこれで書かれる。` +
    `型そのものは<a href="#/by-tag">タグ別の一覧</a>で見られる。</p>` +
    `<div class="object-grid">${cards}</div>`
  );
}

/** タグの見出しに使う絵。そのタグを持つ型のうち、絵が用意されている最初のものを借りる。 */
function tagArtHtml(view: CodexView, names: readonly string[]): string {
  const def = view.objectDef(names.find((name) => ART_BY_OBJECT_NAME.has(name)) ?? names.at(0) ?? '');
  return def === undefined
    ? '<span class="art art-thumb art-missing" aria-hidden="true"></span>'
    : artHtml(view, def, 'thumb');
}

/**
 * タグごとに分けたオブジェクトの一覧。**1ページにすべてのタグを並べる**——型は複数のタグを持つので、
 * タグごとにページを分けると同じ型を何度も開くことになり、まとまりの違いも見比べられない。
 *
 * どの型もどこかの節には出るよう、タグを持たない型は最後にまとめる。
 */
function renderObjectsByTagPage(view: CodexView): string {
  const sections = view
    .tagNames()
    .map((tag) => ({ tag, names: view.objectsWithTag(tag) }))
    .filter(({ names }) => names.length > 0)
    .map(({ tag, names }) => tagSectionHtml(view, tag, escapeHtml(tag), names))
    .join('');

  const untagged = view.objectDefs().filter((def) => def.tags.length === 0);
  const untaggedSection =
    untagged.length === 0
      ? ''
      : tagSectionHtml(
          view,
          '',
          'タグなし',
          untagged.map((def) => def.name),
        );

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>タグ別オブジェクト一覧</h1>` +
    `<p class="muted">タグは型のグループを指す唯一の手段（4.1節）。1つの型が複数のタグを持つため、` +
    `同じ型が複数の節に出る。タグそのものの一覧は<a href="#/tags">タグ一覧</a>。</p>` +
    sections +
    untaggedSection
  );
}

/** タグ1つぶんの節。idはタグ名からのスクロール先（main.tsが#/by-tag/<タグ>で使う）。 */
function tagSectionHtml(view: CodexView, tag: string, heading: string, names: readonly string[]): string {
  return (
    `<h2 id="${tagSectionId(tag)}">${heading}<span class="muted"> (${names.length})</span></h2>` +
    objectGridHtml(view, names)
  );
}

/** タグ別一覧の中の、そのタグの節のid。 */
function tagSectionId(tag: string): string {
  return `tag-${tag}`;
}

/** スロットを持つobject_defの一覧と、それぞれの受け入れ方。 */
function renderSlotPage(view: CodexView, slotName: string): string {
  const globalId = view.codex.slotNames.tryGetId(slotName);
  const texts = view.locale.slot(slotName);

  const rows = view
    .objectsWithSlot(slotName)
    .map((owner) => {
      const slotDef = globalId === undefined ? undefined : view.objectDef(owner)?.tryGetSlotDef(globalId);
      return slotDef === undefined
        ? ''
        : `<tr><td>${objectLinkHtml(view, owner)}</td>${slotCellsHtml(view, owner, slotDef)}</tr>`;
    })
    .join('');

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>${escapeHtml(view.slotLabel(slotName))}</h1>` +
    identifierLine(view, view.slotLabel(slotName), slotName, texts.displayName) +
    (texts.putIn?.description === undefined
      ? ''
      : `<p class="lead">${escapeHtml(texts.putIn.description)}</p>`) +
    section('このスロットを持つ型', rows === '' ? EMPTY_HTML : slotTableHtml('型', rows))
  );
}

/** スロットの表（1行が1スロット）。見出しの1列目だけが、型のページとスロットのページで変わる。 */
function slotTableHtml(firstColumn: string, rows: string): string {
  return (
    `<table><thead><tr><th>${escapeHtml(firstColumn)}</th><th>受け入れる型</th>` +
    `<th>枠数</th><th>capacity</th><th>備考</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/** スロット1つぶんのセル（1列目＝名前を除く）。 */
function slotCellsHtml(view: CodexView, selfObjectName: string, slotDef: SlotDef): string {
  const notes: string[] = [];
  const putIn = putInDurationTokens(slotDef, view.names);
  if (putIn !== undefined) notes.push(`入れるのに${view.tokensHtml(putIn, selfObjectName)}分かかる`);
  if (!slotDef.autoPlacement) notes.push('自動配置の対象にしない（手で入れるか、名指しの移動でだけ入る）');

  return (
    `<td>${view.describeHtml(selfObjectName, (out) => describeAccept(slotDef, view.names, out))}</td>` +
    `<td>${slotDef.cellCount ?? ''}</td>` +
    `<td>${slotDef.capacity ?? ''}</td>` +
    `<td class="muted">${notes.join('<br>')}</td>`
  );
}

/** 同名のpropを持つobject_defの候補一覧（参照先が1つに絞れないときの行き先）。 */
function renderPropertyCandidatesPage(view: CodexView, propertyName: string): string {
  const candidates = view.objectsWithProperty(propertyName);
  if (candidates.length === 0)
    return errorPage(`'${escapeHtml(propertyName)}' という名前のpropはどの型にもありません。`);

  const rows = candidates
    .map(
      (name) =>
        `<tr><td><a href="${view.objectHref(name)}">${escapeHtml(view.objectLabel(name))}</a></td>` +
        `<td><a href="${view.propertyHref(name, propertyName)}">` +
        `${escapeHtml(view.propertyLabel(name, propertyName))}</a></td>` +
        `<td><code>${escapeHtml(name)}</code></td></tr>`,
    )
    .join('');

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1><span class="muted">prop: </span>${escapeHtml(propertyName)}</h1>` +
    `<p class="muted">この名前のpropを持つ型 ${candidates.length}件。` +
    `定義は型ごとに違いうるので、見たい型を選ぶ。</p>` +
    `<table><thead><tr><th>型</th><th>プロパティ</th><th>識別子</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export function renderNotFoundPage(): string {
  return errorPage('ページが見つかりません。');
}

// ------------------------------------------------------------------
// ページ
// ------------------------------------------------------------------

/** オブジェクト一覧（`#/`）。名前で絞り込める。 */
export class ObjectListPage extends CodexPage {
  readonly route = '';

  render(view: CodexView): string {
    return renderObjectListPage(view);
  }

  /** 並べ替えずに隠すだけなので、入力のたびに組み立て直さない。 */
  override wire(): void {
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
  }
}

/** オブジェクト1つ（`#/object/<名前>`）。 */
export class ObjectPage extends CodexPage {
  readonly route = 'object';

  render(view: CodexView, args: readonly string[]): string | undefined {
    const name = args.at(0);
    return name === undefined ? undefined : renderObjectPage(view, name);
  }
}

/** ある型のプロパティ1つ（`#/property/<型>/<プロパティ>`）。 */
export class PropertyPage extends CodexPage {
  readonly route = 'property';

  render(view: CodexView, args: readonly string[]): string | undefined {
    const [objectName, propertyName] = [args.at(0), args.at(1)];
    return objectName === undefined || propertyName === undefined
      ? undefined
      : renderPropertyPage(view, objectName, propertyName);
  }
}

/** その名前のプロパティを宣言している型の一覧（`#/prop-candidates/<プロパティ>`）。 */
export class PropertyCandidatesPage extends CodexPage {
  readonly route = 'prop-candidates';

  render(view: CodexView, args: readonly string[]): string | undefined {
    const propertyName = args.at(0);
    return propertyName === undefined ? undefined : renderPropertyCandidatesPage(view, propertyName);
  }
}

/** タグの一覧（`#/tags`）。 */
export class TagListPage extends CodexPage {
  readonly route = 'tags';

  render(view: CodexView): string {
    return renderTagListPage(view);
  }
}

/** タグ別のオブジェクト一覧（`#/by-tag`、`#/by-tag/<タグ>` でその節まで送る）。 */
export class ObjectsByTagPage extends CodexPage {
  readonly route = 'by-tag';

  render(view: CodexView): string {
    return renderObjectsByTagPage(view);
  }

  protected override sectionId(name: string): string {
    return tagSectionId(name);
  }
}

/** スロット1つを持つ型の一覧（`#/slot/<スロット>`）。 */
export class SlotPage extends CodexPage {
  readonly route = 'slot';

  render(view: CodexView, args: readonly string[]): string | undefined {
    const slotName = args.at(0);
    return slotName === undefined ? undefined : renderSlotPage(view, slotName);
  }
}

// ------------------------------------------------------------------
// 部品
// ------------------------------------------------------------------

/**
 * オブジェクトのページへのリンク。**絵を出すかは呼び出し側が決める**——並びの中では絵があるほうが
 * 早く引けるが、表の1セルでは行が高くなる。
 */
export function objectLinkHtml(view: CodexView, name: string, withArt = false): string {
  const art = withArt ? inlineArtHtml(name) : '';
  return `<a href="${view.objectHref(name)}">${art}${escapeHtml(view.objectLabel(name))}</a>`;
}

function objectGridHtml(view: CodexView, names: readonly string[]): string {
  const cards = names
    .map((name) => {
      const def = view.objectDef(name);
      return def === undefined ? '' : objectCardHtml(view, def);
    })
    .join('');
  return cards === '' ? EMPTY_HTML : `<div class="object-grid">${cards}</div>`;
}

function objectCardHtml(view: CodexView, def: ObjectDef): string {
  const label = view.objectLabel(def.name);
  return (
    `<a class="object-card" href="${view.objectHref(def.name)}" data-name="${escapeHtml(def.name)}" ` +
    `data-label="${escapeHtml(label)}">` +
    artHtml(view, def, 'thumb') +
    `<span class="object-card-name">${escapeHtml(label)}</span>` +
    `<span class="object-card-id">${escapeHtml(def.name)}</span>` +
    `</a>`
  );
}

/** カードの絵（`src/assets/objects/<識別子>.png`）。ゲームが使うのと同じ絵をそのまま出す。 */
function artHtml(view: CodexView, def: ObjectDef, size: 'thumb' | 'large'): string {
  const url = ART_BY_OBJECT_NAME.get(def.name);
  if (url === undefined) return `<span class="art art-${size} art-missing" aria-hidden="true"></span>`;
  return `<img class="art art-${size}" src="${url}" alt="${escapeHtml(view.objectLabel(def.name))}">`;
}

function tagChipsHtml(view: CodexView, def: ObjectDef): string {
  if (def.tags.length === 0) return '<span class="muted">（タグなし）</span>';
  return def.tags
    .map((tagGlobalId) => view.codex.tagNames.getName(tagGlobalId))
    .map((tag) => `<a class="chip" href="${view.tagHref(tag)}">${escapeHtml(tag)}</a>`)
    .join(' ');
}

function propertiesHtml(view: CodexView, def: ObjectDef): string {
  const rows = def
    .enumeratePropertyDefs()
    .map((propertyDef) => {
      const texts = view.locale.object(def.name).prop(propertyDef.name);
      const description =
        texts.description === undefined ? '' : `<div class="muted">${escapeHtml(texts.description)}</div>`;
      const tags = propertyDef.tags
        .map((tagGlobalId) => view.propertyTagLabel(view.codex.propertyTagNames.getName(tagGlobalId)))
        .map((tag) => `<span class="chip chip-property-tag">${escapeHtml(tag)}</span>`)
        .join(' ');

      // 表示名が識別子のままなら、同じ文字列を2行並べても意味が無いので印だけを添える。
      const untranslated = view.isUntranslated(propertyDef.name, texts.displayName);
      const identifier = untranslated
        ? untranslatedBadge(view, propertyDef.name, texts.displayName)
        : `<div class="identifier"><code>${escapeHtml(propertyDef.name)}</code></div>`;

      return (
        `<tr><td>` +
        `<a href="${view.propertyHref(def.name, propertyDef.name)}">` +
        `${escapeHtml(view.propertyLabel(def.name, propertyDef.name))}</a>` +
        identifier +
        description +
        `</td>` +
        `<td>${view.tokensHtml(initialValueTokens(propertyDef, view.names), def.name)}</td>` +
        `<td>${propertyDef.range === undefined ? '' : `${propertyDef.range.min} 〜 ${propertyDef.range.max}`}</td>` +
        `<td>${tags}</td></tr>`
      );
    })
    .join('');

  if (rows === '') return EMPTY_HTML;
  return (
    `<table><thead><tr><th>プロパティ</th><th>初期値</th><th>range</th><th>カテゴリ</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

function slotsHtml(view: CodexView, def: ObjectDef): string {
  const rows = def
    .enumerateSlotDefs()
    .map(
      (slotDef) =>
        `<tr><td><a href="${view.slotHref(slotDef.name)}">` +
        `${escapeHtml(view.slotLabel(slotDef.name))}</a>` +
        `${headingIdentifier(view.slotLabel(slotDef.name), slotDef.name)}</td>` +
        `${slotCellsHtml(view, def.name, slotDef)}</tr>`,
    )
    .join('');
  return rows === '' ? EMPTY_HTML : slotTableHtml('スロット', rows);
}

function interactionsHtml(view: CodexView, def: ObjectDef, interactions: readonly InteractionDef[]): string {
  const cards = interactions
    .map((interaction) => {
      const texts = view.interactionTexts(def.name, interaction.name);
      const description =
        texts.description === undefined ? '' : `<p class="muted">${escapeHtml(texts.description)}</p>`;
      const label = view.interactionLabel(def.name, interaction.name);
      return card(
        escapeHtml(label) + headingIdentifier(label, interaction.name),
        description + view.describeHtml(def.name, (out) => describeInteraction(interaction, view.names, out)),
      );
    })
    .join('');
  return cards === '' ? EMPTY_HTML : cards;
}

function recipesHtml(view: CodexView, def: ObjectDef): string {
  const cards = def.recipes
    .map((recipe) =>
      card(
        escapeHtml(recipe.name),
        view.describeHtml(def.name, (out) => describeRecipe(recipe, view.names, out)),
      ),
    )
    .join('');
  return cards === '' ? EMPTY_HTML : cards;
}

/**
 * このプロパティを書き換える宣言を、宣言している型ごとにまとめる。他の逆引きと違って量と条件まで
 * 出すのは、「どれだけ動くのか」がこの節を見る目的そのものだから。
 *
 * すべての型に尋ね、1行でも書いた型だけを並べる。**尋ねるだけで宣言の中身は覗かない**——
 * 何をどう書き表すかはdescribeInfluencesOnが知っている。
 */
function influencesHtml(view: CodexView, owner: ObjectDef, propertyGlobalId: number): string {
  const groups = view
    .objectDefs()
    .map((def) => {
      const writer = new DescriptionWriter();
      describeInfluencesOn(def, propertyGlobalId, def === owner, view.names, writer);
      return { def, writer };
    })
    .filter(({ writer }) => !writer.isEmpty)
    .map(({ def, writer }) =>
      card(
        `<a href="${view.objectHref(def.name)}">${escapeHtml(view.objectLabel(def.name))}</a>`,
        view.linesHtml(writer.toLines(), def.name),
      ),
    )
    .join('');

  return groups === '' ? EMPTY_HTML : groups;
}

/** 中身が無い節は見出しごと出さない（「（なし）」の並びは、読み手に何も伝えないため）。 */
function section(title: string, body: string): string {
  return body === '' || body === EMPTY_HTML ? '' : `<h2>${escapeHtml(title)}</h2>${body}`;
}

function card(heading: string, body: string): string {
  return `<div class="card"><h4>${heading}</h4>${body}</div>`;
}

/** 見出しの脇に小さく添える識別子。見出しがすでに識別子そのものなら何も足さない。 */
function headingIdentifier(label: string, identifier: string): string {
  return label === identifier ? '' : ` <code>${escapeHtml(identifier)}</code>`;
}

/**
 * 見出しの下に置く識別子の行。見出しがすでに識別子そのものを出しているとき（識別子表示モード、
 * または未翻訳）は繰り返さない。
 */
function identifierLine(view: CodexView, label: string, identifier: string, displayName: string): string {
  const code = label === identifier ? '' : `<code>${escapeHtml(identifier)}</code>`;
  const badge = untranslatedBadge(view, identifier, displayName);
  return code === '' && badge === '' ? '' : `<p class="identifier">${code}${badge}</p>`;
}

function untranslatedBadge(view: CodexView, identifier: string, displayName: string): string {
  return view.isUntranslated(identifier, displayName)
    ? '<span class="badge badge-untranslated">未翻訳</span>'
    : '';
}

function errorPage(message: string): string {
  return `<div class="error">${message}</div><p><a href="#/">← オブジェクト一覧へ</a></p>`;
}
