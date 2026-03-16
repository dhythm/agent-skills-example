---
name: sdk-clients
description: OpenAI SDK と Anthropic SDK を TypeScript から安全に初期化し、呼び出しコードと失敗時の扱いを実装するための手順です。
trigger_keywords:
  - openai
  - anthropic
  - claude
  - sdk
  - model
  - api
  - responses
  - messages
---

# SDK Clients

## When To Use

- OpenAI または Claude の API 呼び出しを追加・修正するとき
- モデル名や API キーの設定方法を整理するとき
- サンプルコードを実行可能な状態にするとき

## Workflow

1. 利用する SDK を特定する
2. API キーとモデル名を環境変数から受け取る
3. 最小限の初期化コードを作る
4. 失敗時のメッセージを入れる
5. README に必要な設定値と実行例を反映する

## Requirements

- API キーは環境変数から読み込む
- OpenAI と Anthropic のどちらを使うかを明示する
- モデル名は固定値ではなく設定可能にする
- ネットワークエラーや認証エラー時に原因が追えるメッセージを残す
- サンプルコードでは 1 回分の API 呼び出しに絞る

## Output Checklist

- 実行に必要な環境変数一覧
- 使用モデル名
- どの SDK を使ったか
- 想定される失敗パターン
