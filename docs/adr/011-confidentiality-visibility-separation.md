# ADR 011: 情報レベルと Visibility の分離

## 状況

機密度と共有先を同一 enum にすると、Level 3 選択が組織全体共有と誤解される。

## 決定

ConfidentialityLevel と Visibility を独立属性とする。新規チャットは private + 選択 Level。

## 結果

個人チャットを保護しつつ、高い機密度の情報を個人作業として扱える。
