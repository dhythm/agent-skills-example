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
CLAUDE_PPTX_SKILL_SOURCE=builtin
```

`.env` も読めますが、`.env.local` が優先されます。

## Agent Skills

このリポジトリは [`agentskills.io`](https://agentskills.io/home) の形式に合わせて、以下の順にスキルを探索します。

1. `./.agents/skills`
2. `~/.agents/skills`

各スキルディレクトリにある `SKILL.md` を読み込み、YAML frontmatter の `name` と `description` をカタログ化します。名前が重複した場合は、プロジェクト側のスキルを優先します。

`src/index.ts` は Claude 公式 Skills API を使って動きます。

1. `CLAUDE_PPTX_SKILL_SOURCE=builtin` のときは、Claude の built-in `pptx` skill を使う
2. `CLAUDE_PPTX_SKILL_SOURCE=local` のときは、`./.agents/skills/pptx` を custom skill として同期して使う
3. `beta.messages.create()` で `container.skills` に `pptx` を指定する
4. `code_execution_20250825` ツールを有効にし、Claude に skill を使わせる
5. Claude が `.pptx` を生成し、ホスト側がそのファイルを `output/` に保存する

`local` モードでは `.agents/skills/pptx` 配下のファイルを `pptx/...` の相対パスでアップロードします。同期済みの custom skill ID / version は `.claude-skills-manifest.json` に保存され、内容が変わらない限り再アップロードしません。

## 実行

開発実行:

```bash
npm run dev
```

built-in `pptx` を明示する場合:

```bash
npm run dev:builtin
```

local custom `pptx` を使う場合:

```bash
npm run dev:local
```

CLI 引数で任意の依頼文を渡すこともできます。

```bash
npm run dev -- "README と env の扱いを整理して"
```

CLI 引数でも切り替えられます。

```bash
npm run dev -- --skill-source=local "この仕組みを 6 枚のスライドで説明して"
```

ビルド:

```bash
npm run build
```

起動時に、読み込まれた環境変数ファイル、利用可能なスキル一覧、skill source、使用する Claude skill、Claude の要約、および出力先の `.pptx` を表示します。

正常系では最後に `Run summary:` と `Claude summary:` が出ます。Claude が生成した PowerPoint ファイルは `output/` 配下に保存されます。
