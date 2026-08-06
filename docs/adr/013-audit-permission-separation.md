# ADR 013: 経営戦略 Clearance と会話監査権限の分離

## 決定

`conversation:audit` は executive clearance や manager ロールへ自動付与しない。

## 理由

給与・戦略情報を扱えることと、他社員の個人会話を読めることは別のリスク領域である。
