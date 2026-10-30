# Magic Stacks

Project Gutenberg の英語の古典を 1 文ずつ読み、訳し、解析するための翻訳ノートです。モデルケースは John Henry Newman の著作です。

1. **書庫**: Gutenberg のカタログから本を探して取り込む。探し方は3つある。
   - **入力して検索**: 題名・副題・著者（編者・訳者・寄稿者を含む）・主題が対象。入力中に自動で検索する。
   - **頭文字で一覧**: 題名か著者の姓の A–Z で一覧し、著者を選ぶとその著者の全作品が出る。
   - **作品番号・URL**: 直接指定して取り込む。

   同じ題名・著者の版は1行にまとめる。取り込むときは、EPUB を見出しで章に分け、段落を文に分けて保存する。表紙と本文中の挿絵は R2 に保存する。書籍は全ユーザーで共有する。
2. **翻訳ノート**: 1 冊の本につき 1 つ作る。本人と、招待したメンバー（所有者 / 編集者 / 閲覧者）だけが見られる。次の4つを持つ。
   - **翻訳メモリ**: 原語と訳語の対応（用語 / 固有名詞 / 定型句）。本全体の訳語と、章ごとの例外を持てる。
   - **解釈コンテキスト**: 著者の議論や概念の定義についての、このノートの理解。本全体用と章ごとのものがある。
   - **訳文**: 文ごとに1つ。AI の下訳（`ai`）か、人が確定したもの（`final`）。
   - **注釈**: 文中の任意の範囲（文字オフセット）に付ける。AI の解析（構文 / 語義 / 論理 / 質問への答え）と、自分のメモがある。
3. **リーダー**: 原文・対訳・訳文の表示を切り替えて読む。文をクリックすると作業欄が開く。作業欄では次のことができる。
   - 訳文を編集する。
   - AI で訳す。
   - 語句を選択して、解析・質問・メモを付ける。
   - 選択した語句の、本の中での用例（KWIC）を見る。
   - キー操作: `j` / `k` で前後の文へ移動し、`Esc` で作業欄を閉じる。

### AI（Claude Haiku）と一貫性

訳と解析の依頼には、毎回次の情報を添えます（`src/server/ai.ts`）。

- ノートの翻訳方針
- 解釈コンテキスト（本全体のもの + その章のもの）
- 翻訳メモリのうち、前後の文脈に出てくる語。章の例外があれば、それを優先する。
- 直前 4 文の原文と、ノートの既存の訳
- 直後 2 文の原文

翻訳方針と解釈コンテキストは章の中で変わらないので、system プロンプトのキャッシュ対象にしています。

AI が「訳語を固定すべき語」を提案しても、翻訳メモリには自動では入りません。人がクリックして承認したものだけが入ります。また、確定済みの訳を AI が上書きすることはありません。そのときは提案として表示します。

## 技術構成

| 項目 | 採用 |
|---|---|
| フレームワーク | SolidStart 2.1（Vite 8）、**SPA**（`ssr: false`） |
| UI | Solid UI（Kobalte）+ Tailwind CSS 4 + lucide-solid |
| ホスティング | Cloudflare Workers（`@cloudflare/vite-plugin`、Pages は不使用） |
| DB / ストレージ | D1 + Drizzle ORM（本文・ノート）、R2（元の EPUB・表紙・挿絵。`/api/images/…` と `/api/covers/:id` から、ログイン中のユーザーにだけ配信する） |
| 認証 | ユーザー名 + パスキー（招待制。端末の追加は QR コード） |
| LLM | Claude Haiku（`claude-haiku-5-5`）、`@anthropic-ai/sdk` の構造化出力（zod） |

- 認証・サーバー関数・画面の作りは `../concornext` を、Gutenberg の取り込み（カタログ CSV、EPUB の解析、権利フィルタ）は `../box-maison` を下敷きにしています。
- 画面はブラウザで描画します。データはサーバー関数（`/_server`）と `/api/*` からだけ取得し、どちらも `src/middleware.ts` でログインを確認しています。

### 取り込みの詳細

- **カタログ**: `pg_catalog.csv.gz` を `gutenberg_works` に読み込みます（`src/server/catalog.ts`）。
  - 対象は英語の Text だけです。権利の安全側として、著者・訳者・編者などの寄与者全員の没年が 1945 年以前と分かる作品に限ります。
  - 検索には2つのキーを使います。題名・副題・寄与者全員（「姓, 名」と「名 姓」の両方の順序）をまとめた `search_key` と、主題・分類の `subject_key` です。どちらもアクセント記号を落とした小文字です。
  - すべての語がどちらかのキーに含まれる作品を返します。`search_key` で一致した語が多い作品を先に並べます。
- **EPUB**（`src/server/epub.ts`）: 画像付きの版（`.epub.images`）を取得します。
  - 挿絵は、本文から参照されているものだけを取り出す（最大 120 枚、1 枚 3MB、合計 64MB まで。3KB 未満の飾りは除く）。figure のキャプションは挿絵の説明文にする。挿絵は `image` 種の行として文の並びに入り、説明文は文と同じように訳せる。
  - 表紙は EPUB の cover-image を使う。なければ Gutenberg の `pg{id}.cover.medium.jpg` を使い、それもなければ画面で題名と著者から表紙を組む。取り込み済みの本は、書籍ページの「表紙を取得」で後から付けられる。
  - Gutenberg のヘッダーとフッター、頁番号（`[pg 002]`）、注番号のリンクを取り除く。
  - 脚注は章末に回す。
  - 章は見出しで分ける。平均が 80 段落以下になる、いちばん浅い見出しの階層を選ぶ（部と章がある本は章で、講話と節番号がある本は講話で分かれる）。
- **文分割**（`src/lib/segment.ts`）: ルールで分けます。略語（Mr. / St. / viz. / i.e. …）、イニシャル、`Chapter IV.`、参照語（`vol. 2`、`p. 23`）、段落頭の節番号に対応しています。分割規則を変えたら `SEGMENTER_VERSION` を上げてください。

## セットアップ

前提: Node.js 22 以上、pnpm 10。

```sh
pnpm install
pnpm db:migrate:local
cp .dev.vars.example .dev.vars        # ANTHROPIC_API_KEY を記入
pnpm dev                              # http://localhost:5173

# 最初の管理者を招待する（表示された URL を開き、ユーザー名とパスキーを登録する）
pnpm admin:invite --local --url http://localhost:5173 --admin
```

管理者は、書庫の「カタログを読み込む」で Gutenberg のカタログを取り込めます（1 分ほどかかります）。カタログがなくても、作品番号や URL を指定すれば取り込めます。

## デプロイ

```sh
wrangler d1 create magic-stacks        # 出力された database_id を wrangler.jsonc に書く
wrangler r2 bucket create magic-stacks
pnpm db:migrate:remote
wrangler secret put ANTHROPIC_API_KEY
pnpm run deploy   # (`pnpm deploy` は pnpm 自体のコマンドと衝突するため run を付ける)
pnpm admin:invite --remote --url https://magic-stacks.<account>.workers.dev --admin
```

## テスト

```sh
pnpm test                                             # 単体テスト（文分割・用語のマーク）
E2E_BASE_URL=http://localhost:5173 pnpm test tests/e2e  # パスキーの E2E（起動中のアプリに対して実行）
```

`tests/e2e/make-session.ts` は開発用です。ソフトウェア認証器でローカルに管理者を作り、セッション Cookie を出力します。ブラウザ自動操作で確認するときに使います。

## 今後の候補

- 章をまとめて下訳する（Queues / Workflows で非同期に、Batches API で安く）
- 章の議論を AI に要約させて、解釈コンテキストの下書きにする
- 翻訳メモリの別ノートからの取り込み、訳文の書き出し（Markdown / docx）
- 文分割の手動修正（文の結合・分割）
