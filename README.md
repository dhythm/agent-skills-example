# Agent Skills をプログラムに組み込むサンプルリポジトリ

## セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` に以下を設定してください。

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

`.env` も読めますが、`.env.local` が優先されます。

## Agent Skills

このリポジトリは [`agentskills.io`](https://agentskills.io/home) の形式に合わせて、以下の順にスキルを探索します。

1. `./.agents/skills`
2. `~/.agents/skills`

各スキルディレクトリにある `SKILL.md` を読み込み、YAML frontmatter の `name` と `description` をカタログ化します。名前が重複した場合は、プロジェクト側のスキルを優先します。

`src/index.ts` は Claude 公式 Skills API を使って動きます。

1. project skill として配置した `pptx` の定義を参照しつつ、Claude の built-in `pptx` skill を使う
2. `beta.messages.create()` で `container.skills` に `pptx` を指定する
3. `code_execution_20250825` ツールを有効にし、Claude に skill を使わせる
4. Claude が `pptx` skill を使って `.pptx` を生成し、ホスト側がそのファイルを `output/` に保存する

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

起動時に、読み込まれた環境変数ファイル、利用可能なスキル一覧、使用する Claude skill、Claude の要約、および出力先の `.pptx` を表示します。

正常系では最後に `Run summary:` と `Claude summary:` が出ます。Claude が生成した PowerPoint ファイルは `output/` 配下に保存されます。
