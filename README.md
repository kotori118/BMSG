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
| `gas/ApiActions.gs`、`gas/DbBridge.gs`、`gas/pj/`、`gas/db/` | 移行元から取り込んだコード。今はこのリポジトリが正本なので、直接編集する。API を増減したら `ApiActions.gs` も直す |
| `scripts/import-gas-sources.mjs` | 生成スクリプト |
| `docs/migration/` | 棚卸し（P0）と生成レポート |
| `web/` | フロント（Cloudflare Pages の出力ディレクトリ）。`index.html` は生成物 |
| `web/partials/` | 移行元 HTML の複製（生成物） |
| `web/js/gas-shim.js` | `google.script` の代替。画面のコードは変えずに JSON API を呼ぶ（手で管理） |
| `web/config.js` | API の URL（`/exec` で終わる Apps Script の URL）。デプロイ後に設定（手で管理） |
| `scripts/import-web-sources.mjs` | `web/` の生成スクリプト |
| `tests/` | GAS ソースの検証（`npm test`）。ブラウザの確認は `npm run test:browser` |

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

- 新デザイン（モノトーン：黒基調・太い英字見出し・方眼とひし形のタイル）は `web/partials/UniverseTheme.html`。`AppCore.html` の `ROUTES` で `theme: 'v2'` にした画面だけに当たる。（`/design-sample/` は以前の白基調の見本で、今の方針とは違う）。
- 新デザイン済み：データ、ラボ、左上のメニュー、通知。
- `scripts/import-web-sources.mjs` は移行時に一度使ったもの。再実行すると `web/partials/` の変更が上書きされるので使わない。

## デザインの指標

画面の色・文字・ボタン・間隔は、必ず `docs/design/universe-design-system.md` に従う。数値の正本は `web/partials/UniverseTokens.html`（`--ui-*` 変数）。新しい画面を作るときは、トークンの変数だけを使い、直接の数値は書かない。

## 取り込みスクリプトについて

`scripts/import-gas-sources.mjs` と `scripts/import-web-sources.mjs` は移行時に一度だけ使ったもの。再実行するとこのリポジトリでの変更が上書きされるため、`--force` を付けない限り動かない。

## 廃止した機能

- お気に入り・履歴（2026-11-22）：画面、API（`getUniverseFavorites`、`setUniverseFavorite`、`recordUniverseActivity`）、カード・カバー・ポーカー・クイズでの履歴の書き込み、全画面を監視していた処理を削除。Log DB の `UserFavorites`、`RecentActivities` シートとデータは残してある（アプリからは使わない）。

## デプロイ

`main` への push で `.github/workflows/deploy.yml` がテストを実行し、`gas/` を clasp で push・deploy する。Secrets `CLASPRC_JSON_KEY`、`SCRIPT_ID`、`DEPLOYMENT_ID` には新しい GAS プロジェクトの値を設定する。

初回デプロイ前に、旧 BMSG-DB プロジェクトの Script Properties（`UNIVERSE_CATALOG_BACKUP_ID`、`UNIVERSE_CATALOG_LOG_BACKUP_ID`、`UNIVERSE_CATALOG_BACKUP_HISTORY`）を新プロジェクトへ写す。
