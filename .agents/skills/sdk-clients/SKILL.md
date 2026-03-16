---
name: sdk-clients
description: OpenAI SDK と Anthropic SDK の初期化方法、および環境変数の扱い方を案内します。
---

# SDK Clients

## Purpose

このプロジェクトで `openai` と `@anthropic-ai/sdk` を使う際の基本方針です。

## Instructions

- API キーは `.env.local` に設定し、コードへハードコードしない
- `OPENAI_API_KEY` と `ANTHROPIC_API_KEY` の存在確認を行う
- TypeScript から SDK を初期化する
- 新しいサンプルを追加する場合は `src/` 配下に置く
