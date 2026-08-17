/**
 * Capability signals for retrieval — not a giant intent switch.
 */
export type RetrievalSignals = {
  wantWeb: boolean;
  wantInternal: boolean;
  wantDeep: boolean;
  refuseWeb: boolean;
};

export function extractRetrievalSignals(text: string | undefined): RetrievalSignals {
  const t = text ?? "";
  const refuseWeb =
    /[WwＷｗ]eb検索は使わず|ウェブ検索は使わず|社内(?:Knowledge|ナレッジ)だけ|公開済みの社内/.test(
      t,
    );
  return {
    refuseWeb,
    wantWeb:
      !refuseWeb &&
      /市場|業界|競合|最新|公開情報|調べて|調査|外部|ネットで|外部環境/.test(t),
    wantInternal:
      /社内|組織|KPI|課題|人員|規程|過去|取り組み|レガプロ|当社|現状把握/.test(t),
    wantDeep:
      !refuseWeb &&
      /3案|比較|外部環境|分けて調査|根拠を付けて|深く調べ|詳細調査|網羅/.test(t),
  };
}
