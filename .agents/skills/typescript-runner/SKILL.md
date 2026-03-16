---
name: typescript-runner
description: Node.js 向け TypeScript CLI の構成、ビルド、実行、検証の進め方を定義します。
trigger_keywords:
  - typescript
  - ts
  - build
  - run
  - src
  - node
  - cli
---

# TypeScript Runner

## When To Use

- TypeScript の CLI サンプルやスクリプトを作るとき
- `src` と `dist` の責務を整理したいとき
- ビルド確認まで含めて実装したいとき

## Rules

- エントリーポイントは `src/index.ts` に置く
- `npm run build` で型チェックとビルドを通す
- 開発実行と本番実行のコマンドを分ける
- 実行確認できない場合は理由を README またはログで示す

## Workflow

1. `src/index.ts` を更新する
2. 必要な型と設定を追加する
3. `npm run build` を通す
4. 実行確認の結果を残す

## Output Checklist

- 実行コマンド
- ビルド結果
- サンドボックス制約などの注意点
