---
name: env-manager
description: .env 系ファイルの優先順位、配布用テンプレート、秘密情報の分離ルールを定義します。
trigger_keywords:
  - env
  - .env
  - .env.local
  - 環境変数
  - api key
  - secret
  - secrets
---

# Env Manager

## When To Use

- API キーやモデル名などの設定値を追加するとき
- `.env` と `.env.local` の扱いを明確にしたいとき
- サンプルプロジェクトを他人に配布できる形にしたいとき

## Rules

- 実運用の秘密情報は `.env.local` に置く
- 配布用の雛形は `.env.example` に置く
- `.env.local` があれば `.env` より優先する
- コードには秘密情報を埋め込まない
- `.gitignore` に秘密情報ファイルが入っていることを確認する

## Workflow

1. 追加する環境変数名を決める
2. `.env.example` に空欄またはダミー値で追記する
3. 読み込み順をコードで明示する
4. README に用途を記載する

## Output Checklist

- 必須の環境変数一覧
- 優先順位の説明
- 配布用テンプレートの更新有無
