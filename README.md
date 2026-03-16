# Agent Skills をプログラムに組み込むサンプルリポジトリ

## セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` に以下を設定してください。

```env
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

`.env` も読めますが、`.env.local` が優先されます。上記以外の設定は不要で、未設定時はコード内のデフォルト値を使います。

デフォルト値:

- Anthropic model: `claude-sonnet-4-6`
- OpenAI model: `gpt-5.4`

## Agent Skills

このリポジトリは [`agentskills.io`](https://agentskills.io/home) の形式に合わせて、以下の順にスキルを探索します。

1. `./.agents/skills`
2. `~/.agents/skills`

各スキルディレクトリにある `SKILL.md` を読み込み、YAML frontmatter の `name` と `description` をカタログ化します。名前が重複した場合は、プロジェクト側のスキルを優先します。

`src/index.ts` は provider ごとに実行経路を切り替えます。

### Claude

1. デフォルトでは Claude の built-in `pptx` skill を使う
2. `--skill-source=local` を付けると、`./.agents/skills/pptx` を custom skill として同期して使う
3. `beta.messages.create()` で `container.skills` に `pptx` を指定する
4. `code_execution_20250825` ツールを有効にし、Claude に skill を使わせる
5. Claude が `.pptx` を生成し、ホスト側がそのファイルを `output/` に保存する

`local` モードでは `.agents/skills/pptx` 配下のファイルを `pptx/...` の相対パスでアップロードします。同期済みの custom skill ID / version は `.claude-skills-manifest.json` に保存され、内容が変わらない限り再アップロードしません。

### OpenAI

1. `--provider=openai` を指定する
2. project 配下の `./.agents/skills/slides` を inline skill bundle として zip 化し、Responses API の `shell` ツールへ渡す
3. OpenAI の managed container 上で `slides` skill を使って `.pptx` と authoring 用 `.js` を生成する
4. container 内の生成物を取得し、ホスト側の `output/` に保存する

OpenAI 用の `slides` skill には、OpenAI 公式の curated skill を同梱しています。

## 実行

開発実行:

```bash
npm run dev
```

Claude の built-in `pptx` を明示する場合:

```bash
npm run dev:builtin
```

Claude の local custom `pptx` を使う場合:

```bash
npm run dev:local
```

OpenAI の `slides` skill を使う場合:

```bash
npm run dev:openai
```

CLI 引数で任意の依頼文を渡すこともできます。

```bash
npm run dev -- "README と env の扱いを整理して"
```

CLI 引数でも provider や mode を切り替えられます。

```bash
npm run dev -- --skill-source=local "この仕組みを 6 枚のスライドで説明して"
npm run dev -- --provider=openai "この仕組みを 6 枚のスライドで説明して"
```

ビルド:

```bash
npm run build
```

起動時に、読み込まれた環境変数ファイル、利用可能なスキル一覧、provider、skill source、利用モデル、要約、および出力先の生成ファイルを表示します。

正常系では最後に `Run summary:` と provider ごとの summary が出ます。生成された PowerPoint ファイルは `output/` 配下に保存されます。
