import type { CraftingStep } from '../analysis/CraftingStep';
import { craftingStepsOf } from '../analysis/craftingSteps';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { WorldCodex } from '../domain/defs/WorldCodex';

/**
 * クラフトネットワークのグラフ構造。
 *
 * ノードは型・工程・タグの3種。線は必ず「入力 → 工程 → 出力」と工程を経由する——複数入力×複数出力の
 * クラフトを型どうし直結で描くと入力数×出力数のメッシュになるが、工程を結節点にすれば
 * 入力数＋出力数本で済む。
 */
export type NetworkNode =
  | { readonly kind: 'object'; readonly id: string; readonly objectName: string }
  | {
      readonly kind: 'step';
      readonly id: string;
      readonly stepKind: CraftingStep['kind'];
      readonly ownerName: string;
      readonly stepName: string;
    }
  | { readonly kind: 'tag'; readonly id: string; readonly tagName: string };

export interface NetworkEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'input' | 'output' | 'membership';

  /** 入力の線のみ。偽なら道具（工程で消えない）で、破線に描かれる。 */
  readonly consumed?: boolean;

  /** 出力の線のみ。1回の実行で複数生まれるときの「×N」（個数が一定しない出力ではundefined）。 */
  readonly countLabel?: string;
}

export interface CraftingNetwork {
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
}

export function objectNodeId(objectName: string): string {
  return `o:${objectName}`;
}

function tagNodeId(tagName: string): string {
  return `t:${tagName}`;
}

/**
 * 全型の工程（ObjectDef.craftingSteps）からネットワークを組み立てる。
 *
 * 描くのは**何かを生み出す工程だけ**。食べる・休むといった、値を返すだけでオブジェクトを生まない
 * 工程は「入力 → 工程 → 出力」の線を持てず、線の無い結節点が増えるだけのため。
 *
 * 型のノードは、どこかの工程に関わるものだけを作る（クラフトに関わらない型を並べても
 * 線の無い島が増えるだけのため）。タグのノードも、工程の入力に使われたタグだけ。
 * タグにはそれを持つ型から所属の線を引く（尖った石 → cutting_tool）。
 */
export function buildCraftingNetwork(defs: readonly ObjectDef[], codex: WorldCodex): CraftingNetwork {
  const nodes = new Map<string, NetworkNode>();
  const edges: NetworkEdge[] = [];
  const usedTagIds = new Set<number>();

  const objectNode = (globalId: number): string => {
    const name = codex.objectName(globalId);
    const id = objectNodeId(name);
    if (!nodes.has(id)) nodes.set(id, { kind: 'object', id, objectName: name });
    return id;
  };

  for (const def of defs) {
    for (const step of craftingStepsOf(def)) {
      if (step.outputs.length === 0) continue;

      const stepId = `s:${def.name}:${step.name}`;
      nodes.set(stepId, {
        kind: 'step',
        id: stepId,
        stepKind: step.kind,
        ownerName: def.name,
        stepName: step.name,
      });

      for (const input of step.inputs) {
        if (input.kind === 'object') {
          edges.push({
            from: objectNode(input.objectGlobalId),
            to: stepId,
            kind: 'input',
            consumed: input.consumed,
          });
        } else {
          usedTagIds.add(input.tagGlobalId);
          edges.push({
            from: tagNodeId(codex.tagName(input.tagGlobalId)),
            to: stepId,
            kind: 'input',
            consumed: input.consumed,
          });
        }
      }

      for (const output of step.outputs)
        edges.push({
          from: stepId,
          to: objectNode(output.objectGlobalId),
          kind: 'output',
          countLabel: countLabelOf(output.counts),
        });
    }
  }

  // タグのノードと所属の線。線を引くのはネットワークに既に居る型だけ——タグを持つだけでクラフトに
  // 関わらない型まで引き込むと、タグの周りだけ肥大するため。
  for (const tagGlobalId of usedTagIds) {
    const tagName = codex.tagName(tagGlobalId);
    const id = tagNodeId(tagName);
    nodes.set(id, { kind: 'tag', id, tagName });
    for (const def of defs) {
      if (!def.tags.includes(tagGlobalId)) continue;
      if (!nodes.has(objectNodeId(def.name))) continue;
      edges.push({ from: objectNodeId(def.name), to: id, kind: 'membership' });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

/** 個数が一定なら「×N」、候補ごとにばらつく出力なら付けない（誤解を招く数字を出さない）。 */
function countLabelOf(counts: readonly number[]): string | undefined {
  const first = counts[0] ?? 1;
  if (counts.some((count) => count !== first)) return undefined;
  return first > 1 ? `×${first}` : undefined;
}
