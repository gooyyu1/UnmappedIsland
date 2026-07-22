using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）・active効果の
    /// 対象/参照が共通で参照する起点。self.prop/parent.propのような1階層の参照のみを対象とする（複数階層の
    /// パスは現状の用例に存在しないため未対応）。worldは唯一のシングルトンインスタンスを実行時に追跡する
    /// 仕組みがまだ無いため、起点としては未対応（14.1節参照。ロード時にエラーとする）。ただしAncestorが
    /// 「見つからなければworldまで遡る」ことを自然に含むため、世界固有の概念を参照したい場合はAncestorで代替できる。
    /// </summary>
    public enum ReferenceRoot
    {
        Self,
        Parent,

        /// <summary>passiveのtarget専用（8.1節）。親が宣言した効果を、そのスロットに入った各子へ
        /// ブロードキャスト登録するために使う（WorldObject.RegisterEdgeWith参照）。単一の参照先へ解決される
        /// conditions/active/weight/transferの文脈では意味を持たない（それらの許可rootには含めない）。</summary>
        Child,

        Actor,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。</summary>
        Dragged,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカードの直接の親。
        /// 液体容器のような「中身のオブジェクトがコンテナ親のプロパティを参照する」ケース
        /// （液体マーカーのpour_in/pour_*が、dragged容器のliquid_amountへ移送する）で使う。</summary>
        DraggedParent,

        /// <summary>selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（Runtime.
        /// WorldObject.FindAncestorWithProperty参照）。「どのオブジェクトが定義しているか」に依存しない、
        /// 木構造上の実効的な参照のための起点。SlotPosition判定（{in_slot: ...}）では意味を持たないため
        /// 未対応（ロード時エラー）。</summary>
        Ancestor,
    }

    /// <summary>{object, prop}が指す、1階層のプロパティ参照（ReferenceRoot＋プロパティのグローバルID）。
    /// weightのpath参照（10.2節）・conditionsのvalueRef（14節）・activeのvalueRefが共有する
    /// （いずれも「リテラルか参照か」の二択の『参照』側）。</summary>
    public readonly struct PropertyPath
    {
        public readonly ReferenceRoot Root;
        public readonly int PropertyGlobalId;

        public PropertyPath(ReferenceRoot root, int propertyGlobalId)
        {
            Root = root;
            PropertyGlobalId = propertyGlobalId;
        }
    }

    /// <summary>ReferenceRoot（self/parent/actor/dragged/dragged_parent）を、実行時のWorldObjectへ解決する。
    /// Ancestorはプロパティごとに解決先が変わりうるため、ここでは扱わず各利用側がFindAncestorWithPropertyを
    /// 併用する（default→null）。</summary>
    public static class ReferenceRootResolver
    {
        public static WorldObject Resolve(ReferenceRoot root, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return self;
                case ReferenceRoot.Parent: return self?.Parent;
                case ReferenceRoot.Actor: return actor;
                case ReferenceRoot.Dragged: return dragged;
                case ReferenceRoot.DraggedParent: return dragged?.Parent;
                default: return null;
            }
        }
    }
}
