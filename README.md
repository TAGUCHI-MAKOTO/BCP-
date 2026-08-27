# BCP- リポジトリ構成

このリポジトリは、用途別に2つのEdge拡張を分けて管理します。

## temmemo/
テン・メモ本体（Temp / Note / BCPを含む統合版）。
Edgeで読み込む場合は `temmemo` フォルダを「展開して読み込み」で指定します。

## standalone-bcp/
BCP機能のみを切り出した分離版。
Edgeで読み込む場合は `standalone-bcp` フォルダを「展開して読み込み」で指定します。

## 運用方針
- テン・メモ本体の変更は `temmemo/` 配下へ反映。
- BCP分離版の変更は `standalone-bcp/` 配下へ反映。
- 配布用ZIPは原則リポジトリへ常置せず、必要時にビルド・配布する。
