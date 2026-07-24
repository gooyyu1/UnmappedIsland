using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）・active効果の
    /// 対象/参照が共通で参照する起点。self.prop/parent.propのような1階層の参照のみ対応。
    /// worldは起点として未対応（ロード時エラー、14.1節）。Ancestorは見つからなければworldまで遡るため、
    /// 世界固有の概念の参照はAncestorで代替できる。
    /// </summary>
    public enum ReferenceRoot
    {
        Self,
        Parent,

        /// <summary>passiveのtarget専用（8.1節）。親が宣言した効果を、そのスロットに入った各子へ
        /// ブロードキャスト登録するために使う。単一の参照先へ解決されるconditions/active/weight/transferの
        /// 文脈では意味を持たない（それらの許可rootには含めない）。</summary>
        Child,

        Actor,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。</summary>
        Dragged,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカードの直接の親
        /// （液体容器のように「中身がコンテナ親のプロパティを参照する」ケースで使う）。</summary>
        DraggedParent,

        /// <summary>selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先
        /// （WorldObject.FindAncestorWithProperty参照）。SlotPosition判定（{in_slot: ...}）では意味を
        /// 持たないため未対応（ロード時エラー）。</summary>
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

    /// <summary>ReferenceRootを実行時のWorldObjectへ解決する。Ancestorはプロパティごとに解決先が
    /// 変わりうるため扱わず、各利用側がFindAncestorWithPropertyを併用する（default→null）。</summary>
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
