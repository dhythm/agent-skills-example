# Agent Skills をプログラムに組み込むサンプルリポジトリ

## セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` に以下を設定してください。

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini
```

`.env` も読めますが、`.env.local` が優先されます。

## Agent Skills

このリポジトリは [`agentskills.io`](https://agentskills.io/home) の形式に合わせて、以下の順にスキルを探索します。

1. `./.agents/skills`
2. `~/.agents/skills`

各スキルディレクトリにある `SKILL.md` を読み込み、YAML frontmatter の `name` と `description` をカタログ化します。名前が重複した場合は、プロジェクト側のスキルを優先します。

`src/index.ts` は `@openai/agents` を使って、各 skill を specialist agent として登録します。manager agent はそれらを `agent.asTool()` で必要なときだけ呼びます。

各 skill の `description` は manager に見えますが、`SKILL.md` 本文は specialist agent が呼ばれたときにだけ読み込まれます。つまり、Claude Code や Codex のような「必要な skill だけ使う」挙動を、Agents SDK の `tools` で近い形に再現しています。

## 実行

開発実行:

```bash
npm run dev
```

CLI 引数で任意の依頼文を渡すこともできます。

```bash
npm run dev -- "README と env の扱いを整理して"
```

ビルド:

```bash
npm run build
```

起動時に、読み込まれた環境変数ファイル、利用可能なスキル一覧、登録された skill tools、および agent の最終応答を表示します。

正常系では最後に `Run summary:` と `Agent response:` が出ます。`使用された skill tools` に 1 つ以上の skill 名が出るのが成功条件です。1 つも使われなかった場合は、実装側でエラー扱いにしています。
