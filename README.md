# BMSG

BMSG Universe の移行先リポジトリ。フロントを Cloudflare Pages、データ API を Google Apps Script（JSON API）で動かす。

- 移行仕様書：https://docs.google.com/document/d/1gZl984HQkgk6r5XnxlxwjKedccoFV7lb_CcDMKFsGjc/edit
- Universe の仕様正本：https://docs.google.com/document/d/1pgttqIlZ8pZtBNBpKt90U_nr4ZVZyeCtJyYvBhu8QFk/edit
- 移行元：kotori118/BMSG-PJ、kotori118/BMSG-DB（main）。元のリポジトリ・スプレッドシートは変更しない。

## 構成

| パス | 内容 |
| :- | :- |
| `gas/` | Apps Script プロジェクト（clasp の rootDir）。ここにあるものだけが GAS に push される |
| `gas/Dispatcher.gs` | `doGet`／`doPost`。JSON API の入口（手で管理） |
| `gas/appsscript.json` | マニフェスト：`executeAs=USER_DEPLOYING`、`access=ANYONE_ANONYMOUS`（手で管理） |
| `gas/ApiActions.gs`、`gas/DbBridge.gs`、`gas/pj/`、`gas/db/` | GAS のコード（このリポジトリが正本）。API を増減したら `ApiActions.gs` も直す。DBのID・シート名は `gas/pj/Config.gs` の `UNIVERSE_CONFIG` だけに書く |
| `web/` | フロント（Cloudflare Pages の出力ディレクトリ）。`index.html` は生成物 |
| `web/partials/` | 画面の部品（正本）。ここを直して `web/index.html` を組み立てる |
| `web/js/gas-shim.js` | `google.script` の代替。画面のコードは変えずに JSON API を呼ぶ（手で管理） |
| `web/config.js` | API の URL（`/exec` で終わる Apps Script の URL）。デプロイ後に設定（手で管理） |
| `scripts/build-web.mjs` | `web/index.html` を組み立てる |
| `scripts/css-rules.mjs` | CSS の持ち方の検査（`npm test` で実行） |
| `tests/` | GAS・画面・CSS の検査（`npm test`）。`tests/fixtures/` は移行時の API 一覧（検査の基準）。ブラウザの確認は `npm run test:browser` |

## API

- 読み取り：`GET <exec URL>?action=<名前>&args=<JSON配列>`（`ApiActions.gs` で `read: true` のものだけ）
- 書込み：`POST <exec URL>`、`Content-Type: text/plain`、本文 `{"action":"<名前>","args":[...]}`。`application/json` にするとブラウザがプリフライトを送り、GAS が応答しないため失敗する。
- 応答：`{"ok":true,"data":...}` または `{"ok":false,"error":{"code":"...","message":"..."}}`
- 引数は `google.script.run` のときと同じ並びで渡す。認証はなし（各 action の既存の userId 検査はそのまま）。

## フロント（画面）の編集

画面の正本は `web/partials/` と `web/src/index.template.html`。編集したら `web/index.html` を組み立て直してコミットする（Cloudflare Pages はビルドせずに `web/` をそのまま配信する）。

```sh
node scripts/build-web.mjs          # web/index.html を作る
npm test                            # 組み立て忘れもここで検出
npm run test:browser                # Chromium が必要
node tests/browser/screens.mjs <出力先> data lab   # 実データで画面を撮る（確認用）
```

- 見た目は部品ファイルだけに書く（値は `UniverseTokens.html`、画面の枠は `Styles.html`、部品は `UniverseTheme.html`）。画面ごとの CSS は並べ方だけ。詳しくは下の「デザインの指標」。

## デザインの指標

画面の色・文字・ボタン・間隔は、必ず `docs/design/universe-design-system.md` に従う。数値の正本は `web/partials/UniverseTokens.html`（`--ui-*` 変数）。新しい画面を作るときは、トークンの変数だけを使い、直接の数値は書かない。

## 廃止した機能

- お気に入り・履歴（2026-11-22）：画面、API（`getUniverseFavorites`、`setUniverseFavorite`、`recordUniverseActivity`）、カード・カバー・ポーカー・クイズでの履歴の書き込み、全画面を監視していた処理を削除。Log DB の `UserFavorites`、`RecentActivities` シートは 2026-11-26 に削除（中身は `docs/archive/log-sheets-removed-2026-11-26.md`）。
- メンバーカラー・推しグループから始める（2026-11-26）：設定は推しメンを選んで保存するだけ。Users シートの `MemberColorMode`、`FavoriteGroupStartMode` 列は 2026-11-26 に削除（中身は同じ記録に残した）。

## 速さのしくみ

- 読み取りの API は、DB のシートの中身と、重い結果（歌詞の一覧・歌詞本文・分析）をサーバーに保存して使う（`gas/pj/CoreRepository.gs` の `universeCoreCached_`）。保存は10分で切れる。
- DB を変える書き込み（管理画面など）が終わると、保存はまとめて作り直しになる（`gas/Dispatcher.gs`）。ログだけに書く操作は `UNIVERSE_LOG_ONLY_ACTIONS_` に並べる。新しい書き込みの操作を足すとき、DB を変えないならここに足す。
- スプレッドシートを直接編集したときは、最長10分で画面に反映される。
- 歌詞は一覧（軽い）と本文（`getLyricsParts`）を分けて読む。本文は一覧を出した後に裏で読む。
- 画面側は読み取りの結果を端末に24時間保存し、裏で新しくする（`web/js/gas-shim.js`）。
- GAS の返す内容を変えたとき（項目を足す・形を変える）は、`web/js/gas-shim.js` の `CACHE_VERSION` を1つ上げる。上げないと、端末に残った古い保存結果が最大24時間使われる。
- Drive の画像は `universeImageUrl(id, 幅)`（`web/partials/AppHelpers.html`）で、大きさを指定した小さい版だけを読む。

## デプロイ

`main` への push で `.github/workflows/deploy.yml` がテストを実行し、`gas/` を clasp で push・deploy する。Secrets `CLASPRC_JSON_KEY`、`SCRIPT_ID`、`DEPLOYMENT_ID` には新しい GAS プロジェクトの値を設定する。

初回デプロイ前に、旧 BMSG-DB プロジェクトの Script Properties（`UNIVERSE_CATALOG_BACKUP_ID`、`UNIVERSE_CATALOG_LOG_BACKUP_ID`、`UNIVERSE_CATALOG_BACKUP_HISTORY`）を新プロジェクトへ写す。
