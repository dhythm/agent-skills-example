---
name: readme-writer
description: README にセットアップ、前提条件、実行方法、トラブルシュートを簡潔に反映するための手順です。
trigger_keywords:
  - readme
  - setup
  - 手順
  - ドキュメント
  - 実行例
  - install
  - troubleshooting
---

# README Writer

## When To Use

- 新しい依存関係や実行コマンドを追加したとき
- 環境変数やセットアップ方法が変わったとき
- 他の開発者が最短で試せる説明が必要なとき

## Sections To Maintain

- README にはセットアップ、環境変数、実行方法を短く整理して書く
- 実行コマンドはそのままコピーできる形で示す
- 実装とズレる説明は避ける
- 必要ならエラー時の確認ポイントを 1 から 3 個だけ書く

## Output Checklist

- インストール手順
- `.env.local` などの設定ファイル説明
- 開発実行と本番実行のコマンド
