# P0 棚卸し：BMSG Universe 移行（GAS JSON API統合）

- 対象：kotori118/BMSG-PJ main（a0dc0b1）、kotori118/BMSG-DB main（00ab083）
- 作成日：2026-11-21
- 方法：ソースの静的解析（`function` 定義、`google.script.run` 呼び出し、`BMSGDB` 呼び出し、文字列による関数名指定）。実行時の動作は未確認。
- 機械可読の一覧：[P0-actions.csv](./P0-actions.csv)
- 関連：[移行仕様書](https://docs.google.com/document/d/1gZl984HQkgk6r5XnxlxwjKedccoFV7lb_CcDMKFsGjc/edit)

## 1. 要点

| 項目 | 数 |
| :- | -: |
| PJ のサーバー関数（全体） | 359 |
| うち API として公開されている関数（末尾 `_` なし、`doGet`・`include` を除く） | 101 |
| クライアントから呼ばれている API | 99 |
| クライアントの呼び出し箇所 | 114 |
| DB の関数（全体） | 207 |
| PJ から呼ばれる DB の入口関数 | 39 |
| 入口から到達する DB 関数（移行対象） | 139 |
| 到達しない DB 関数（移行しない） | 68 |

移行時に必ず対応が必要な点：

1. **関数名の衝突が1件ある。** `normalizeHex_` が PJ（CoverApi.gs:796）と DB（Code.gs:157）の両方にあり、動作が違う。PJ 版は不正値で既定色を返し、DB 版は例外を投げて大文字化する。1プロジェクトに統合すると後から読み込まれた方が勝ち、グループ・メンバー作成かCOVER表示のどちらかが変わる。**DB 側を `normalizeCatalogHex_` などに改名して呼び出し元を直す。**
2. **Script Properties の移行が必要。** DB はバックアップ情報を自分のプロジェクトの Script Properties に保存している（`UNIVERSE_CATALOG_BACKUP_ID`、`UNIVERSE_CATALOG_LOG_BACKUP_ID`、`UNIVERSE_CATALOG_BACKUP_HISTORY`）。新プロジェクトにはこの値がないため、そのままでは楽曲削除・スキーマ移行・プロフィール項目管理のバックアップ確認で止まる。**旧 DB プロジェクトの値を新プロジェクトへ手で写す**（値は Apps Script の「プロジェクトの設定」で確認できる）。
3. **PERFORMANCE TIMER の MemberID 不整合（移行必須項目）。** クライアントは `PerformanceTimerScripts.html:3` で `'101'〜'106'`、サーバーは `PerformanceTimerApi.gs:8` で `'M101'〜'M106'`。
4. **未使用の API が2件ある。** `getCatalogManagementAccess`、`catalogManagementMigrateSchema` はクライアントから呼ばれていない。新 API のディスパッチ表には載せない（エディタから手動実行する用途なら別途判断）。
5. **ロックの共有。** 統合後は PJ と DB が同じ `ScriptLock` を使う。現行では、ロックを持ったまま DB を呼ぶのは `repairImageManagementData` の1箇所だけで、呼ばれる DB 関数（`getRetiredCatalogImageFileIdsForUniverse`）は読み取りのみ・ロックなしのため、自己待ちは起きない。ただし書込みが互いに直列になるため、混雑時の待ちは増える可能性がある。
6. **スプレッドシートに紐づく処理は移行対象外。** `getActiveSpreadsheet`／`getUi`／`getDocumentProperties` を使う DB 関数は、いずれも PJ から到達しない（旧入力・メニュー系）。決定どおり移行しない。
7. **デプロイ設定。** kotori118/BMSG の `.github/workflows/deploy.yml` は main への push でリポジトリ直下を `clasp push` する。フロントや文書を同じリポジトリに置くため、GAS のソースは `gas/` に分けて `rootDir` をそこに向ける必要がある。Secrets（`CLASPRC_JSON_KEY`、`SCRIPT_ID`、`DEPLOYMENT_ID`）は新プロジェクトのものを設定する。

## 2. API 一覧（ディスパッチ表の元）

方式は仮の割当（`get` で始まるものは GET、それ以外は POST）。POST は CORS 確認の結果どおり `text/plain` で送る。GET 46 件、POST 55 件。

| action | 方式 | サーバー | 引数 | クライアント呼び出し |
| :- | :- | :- | :- | :- |
| `getAnalysisBootstrap` | GET | AnalysisApi.gs:11 | `-` | 1箇所 |
| `getTradingCardBootstrap` | GET | CardApi.gs:7 | `userId` | 1箇所 |
| `drawTradingCard` | POST | CardApi.gs:20 | `userId, groupName` | 1箇所 |
| `resetTradingCardCollection` | POST | CardApi.gs:52 | `userId` | 1箇所 |
| `getCatalogManagementAccess` | GET | CatalogManagementApi.gs:33 | `userId` | **呼び出しなし** |
| `getCatalogManagementBootstrap` | GET | CatalogManagementApi.gs:42 | `userId` | 1箇所 |
| `getCatalogManagementProfileFields` | GET | CatalogManagementApi.gs:50 | `userId` | 1箇所 |
| `catalogManagementCreateProfileField` | POST | CatalogManagementApi.gs:70 | `payload` | 1箇所 |
| `catalogManagementSetProfileFieldActive` | POST | CatalogManagementApi.gs:75 | `payload` | 1箇所 |
| `catalogManagementCreateGroup` | POST | CatalogManagementApi.gs:81 | `payload` | 1箇所 |
| `catalogManagementUpdateGroup` | POST | CatalogManagementApi.gs:84 | `payload` | 1箇所 |
| `catalogManagementCreateMember` | POST | CatalogManagementApi.gs:87 | `payload` | 1箇所 |
| `catalogManagementUpdateMember` | POST | CatalogManagementApi.gs:90 | `payload` | 1箇所 |
| `catalogManagementMoveMemberOrder` | POST | CatalogManagementApi.gs:97 | `payload` | 1箇所 |
| `catalogManagementChangePrimaryGroup` | POST | CatalogManagementApi.gs:102 | `payload` | 1箇所 |
| `getCatalogManagementMemberDeletePreview` | GET | CatalogManagementApi.gs:107 | `payload` | 1箇所 |
| `catalogManagementDeleteMember` | POST | CatalogManagementApi.gs:112 | `payload` | 1箇所 |
| `catalogManagementRemoveUnitMember` | POST | CatalogManagementApi.gs:119 | `payload` | 1箇所 |
| `catalogManagementMoveUnitMember` | POST | CatalogManagementApi.gs:122 | `payload` | 1箇所 |
| `catalogManagementAddUnitMember` | POST | CatalogManagementApi.gs:125 | `payload` | 1箇所 |
| `catalogManagementCreateSongDraft` | POST | CatalogManagementApi.gs:128 | `payload` | 1箇所 |
| `getCatalogManagementDeletePreview` | GET | CatalogManagementApi.gs:131 | `payload` | 1箇所 |
| `catalogManagementDeleteSong` | POST | CatalogManagementApi.gs:135 | `payload` | 1箇所 |
| `catalogManagementMigrateSchema` | POST | CatalogManagementApi.gs:138 | `payload` | **呼び出しなし** |
| `auditCatalogManagementDatabase` | POST | CatalogManagementApi.gs:142 | `userId` | 1箇所 |
| `getCoverMakerBootstrap` | GET | CoverApi.gs:5 | `userId` | 1箇所 |
| `getCoverProjects` | GET | CoverApi.gs:19 | `userId` | 1箇所 |
| `getCoverLibrary` | GET | CoverApi.gs:25 | `userId` | 1箇所 |
| `getCoverSourceSongs` | GET | CoverApi.gs:31 | `artist` | 1箇所 |
| `getCoverEditorData` | GET | CoverApi.gs:47 | `payload` | 1箇所 |
| `getCoverExternalEditorData` | GET | CoverApi.gs:93 | `payload` | 1箇所 |
| `getCoverProject` | GET | CoverApi.gs:129 | `payload` | 1箇所 |
| `saveCoverProject` | POST | CoverApi.gs:209 | `payload` | 1箇所 |
| `setCoverProjectShared` | POST | CoverApi.gs:362 | `payload` | 1箇所 |
| `deleteCoverProject` | POST | CoverApi.gs:378 | `payload` | 1箇所 |
| `getUniverseMemberCreativeCredits` | GET | CrossLinksApi.gs:6 | `memberId` | 1箇所 |
| `getImageManagementBootstrap` | GET | ImageManagementApi.gs:5 | `-` | 1箇所 |
| `getImageManagementStatus` | GET | ImageManagementApi.gs:32 | `memberId, rarity` | 2箇所 |
| `saveImageManagementImage` | POST | ImageManagementApi.gs:51 | `payload` | 1箇所 |
| `repairImageManagementData` | POST | ImageManagementApi.gs:123 | `userId` | 1箇所 |
| `getKaraokeBootstrap` | GET | KaraokeApi.gs:4 | `userId, requestedRoomId` | 2箇所 |
| `createKaraokeRoom` | POST | KaraokeApi.gs:17 | `userId` | 2箇所 |
| `joinKaraokeRoom` | POST | KaraokeApi.gs:37 | `userId, roomId` | 2箇所 |
| `leaveKaraokeRoom` | POST | KaraokeApi.gs:50 | `userId` | 2箇所 |
| `saveKaraokeAssignment` | POST | KaraokeApi.gs:55 | `payload` | 1箇所 |
| `getKaraokeFavoriteSet` | GET | KaraokeFavoriteApi.gs:1 | `groupId` | 1箇所 |
| `getKaraokeFavoriteSettings` | GET | KaraokeFavoriteApi.gs:15 | `-` | 1箇所 |
| `saveKaraokeFavoriteSet` | POST | KaraokeFavoriteApi.gs:41 | `payload` | 1箇所 |
| `getLyricsCatalog` | GET | LyricsApi.gs:3 | `-` | 2箇所 |
| `getLyricsSong` | GET | LyricsApi.gs:34 | `songId` | 1箇所 |
| `getLyricsSingerOptions` | GET | LyricsApi.gs:43 | `-` | 1箇所 |
| `saveLyricsSongParts` | POST | LyricsApi.gs:51 | `payload` | 1箇所 |
| `getManagementOperationsBootstrap` | GET | ManagementOperationsApi.gs:2 | `userId` | 1箇所 |
| `runManagementOperation` | POST | ManagementOperationsApi.gs:6 | `payload` | 2箇所 |
| `getManagementAuditHistory` | GET | ManagementOperationsApi.gs:14 | `payload` | 1箇所 |
| `getManagementPageAccess` | GET | ManagementPageApi.gs:2 | `userId` | 1箇所 |
| `getPerformanceTimerBootstrap` | GET | PerformanceTimerApi.gs:14 | `-` | 1箇所 |
| `getPerformanceTimerSnapshot` | GET | PerformanceTimerApi.gs:47 | `songId` | 1箇所 |
| `savePerformanceTimer` | POST | PerformanceTimerApi.gs:62 | `payload` | 1箇所 |
| `getPokerBootstrap` | GET | PokerApi.gs:5 | `userId, requestedRoomId` | 1箇所 |
| `getPokerRoomState` | GET | PokerApi.gs:19 | `userId, roomId` | 1箇所 |
| `createPokerRoom` | POST | PokerApi.gs:27 | `userId, ruleType` | 1箇所 |
| `joinPokerRoom` | POST | PokerApi.gs:60 | `userId, roomId` | 1箇所 |
| `leavePokerRoom` | POST | PokerApi.gs:84 | `userId, roomId` | 1箇所 |
| `startPokerRoom` | POST | PokerApi.gs:100 | `userId, roomId` | 1箇所 |
| `reorderPokerHand` | POST | PokerApi.gs:126 | `payload` | 1箇所 |
| `exchangePokerCards` | POST | PokerApi.gs:143 | `payload` | 1箇所 |
| `finalizePokerHand` | POST | PokerApi.gs:168 | `userId, roomId` | 1箇所 |
| `votePokerWinner` | POST | PokerApi.gs:189 | `userId, roomId, votedUserId` | 1箇所 |
| `savePokerHighlight` | POST | PokerApi.gs:210 | `userId, roomId` | 1箇所 |
| `saveOfflinePokerHighlight` | POST | PokerApi.gs:224 | `userId, payload` | 1箇所 |
| `getPokerHighlights` | GET | PokerApi.gs:242 | `userId` | 1箇所 |
| `getProfileMembers` | GET | ProfileApi.gs:4 | `-` | 1箇所 |
| `getProfileMemberDetail` | GET | ProfileApi.gs:32 | `memberId` | 2箇所 |
| `getProfileMapData` | GET | ProfileApi.gs:64 | `-` | 1箇所 |
| `getProfileSearchData` | GET | ProfileApi.gs:170 | `-` | 3箇所 |
| `getProfileManagementBootstrap` | GET | ProfileManagementApi.gs:7 | `-` | 1箇所 |
| `getProfileManagementMember` | GET | ProfileManagementApi.gs:43 | `memberId` | 1箇所 |
| `saveProfileManagementMember` | POST | ProfileManagementApi.gs:65 | `payload` | 1箇所 |
| `getQuizBootstrap` | GET | QuizApi.gs:7 | `userId, requestedRoomId` | 2箇所 |
| `createQuizGame` | POST | QuizApi.gs:27 | `payload` | 1箇所 |
| `joinQuizRoom` | POST | QuizApi.gs:61 | `userId, roomId` | 1箇所 |
| `getRecentQuizRooms` | GET | QuizApi.gs:67 | `userId` | 1箇所 |
| `getQuizScoreboard` | GET | QuizApi.gs:71 | `userId, quizGameId` | 1箇所 |
| `submitQuizResult` | POST | QuizApi.gs:78 | `payload` | 1箇所 |
| `abandonQuizGame` | POST | QuizApi.gs:109 | `userId, quizGameId` | 2箇所 |
| `getUniverseSearchResults` | GET | SearchApi.gs:10 | `query` | 1箇所 |
| `getSongLyricsManagementBootstrap` | GET | SongLyricsManagementApi.gs:7 | `userId` | 2箇所 |
| `parseSongLyricsManagement` | POST | SongLyricsManagementApi.gs:27 | `payload` | 1箇所 |
| `registerSongLyricsGuest` | POST | SongLyricsManagementApi.gs:37 | `payload` | 1箇所 |
| `saveNewSongLyricsManagement` | POST | SongLyricsManagementApi.gs:44 | `payload` | 1箇所 |
| `getSongLyricsManagementSong` | GET | SongLyricsManagementApi.gs:51 | `userId, songId` | 2箇所 |
| `saveSongLyricsManagementInfo` | POST | SongLyricsManagementApi.gs:73 | `payload` | 1箇所 |
| `saveSongLyricsManagementCredits` | POST | SongLyricsManagementApi.gs:77 | `payload` | 1箇所 |
| `saveSongLyricsManagementLyrics` | POST | SongLyricsManagementApi.gs:81 | `payload` | 1箇所 |
| `getUniverseSettingsBootstrap` | GET | UserPreferencesApi.gs:11 | `userId` | 1箇所 |
| `saveUniverseUserPreferences` | POST | UserPreferencesApi.gs:23 | `payload` | 1箇所 |
| `getUniverseHomeBootstrap` | GET | UserStateApi.gs:23 | `userId` | 1箇所 |
| `getUniverseFavorites` | GET | UserStateApi.gs:43 | `userId` | 1箇所 |
| `setUniverseFavorite` | POST | UserStateApi.gs:49 | `payload` | 2箇所 |
| `recordUniverseActivity` | POST | UserStateApi.gs:72 | `payload` | 1箇所 |

## 3. クライアントの呼び出し方式

| 方式 | 箇所数 | 置き換え |
| :- | -: | :- |
| `google.script.run.withSuccessHandler(...).関数名(...)` | 72 | `callApi(action, args)` |
| `managementRunner_()...関数名(...)`（Proxy で古い応答を捨てる） | 27 | `callApi` に同じ破棄条件（epoch・userId）を付ける |
| `[条件 ? 'a' : 'b'](...)`（関数名を文字列で選ぶ） | 2 | `callApi` の action に文字列をそのまま渡す |
| `cmCall_('関数名', payload)` | 13 | 同上 |

その他の `google.script` API：

| API | 箇所数 | 場所 | 置き換え |
| :- | -: | :- | :- |
| `google.script.history.push` | 4 | KaraokeScripts.html:357、LyricsScripts.html:33、LyricsScripts.html:154、Router.html:61 | `window.history`（pushState／replaceState／popstate） |
| `google.script.history.replace` | 5 | ManagementPage.html:86、QuizScripts.html:14、QuizScripts.html:55、Router.html:40、Router.html:76 | `window.history`（pushState／replaceState／popstate） |
| `google.script.history.setChangeHandler` | 1 | Router.html:76 | `window.history`（pushState／replaceState／popstate） |
| `google.script.url` | 1 | Settings.html:71 | `window.location` |
| `google.script.url.getLocation` | 3 | Router.html:76、Settings.html:71、Settings.html:72 | `window.location` |

## 4. DB の扱い

**PJ から呼ばれる入口関数（39件）：** `auditCatalogDatabaseForUniverse`、`getCatalogMaintenanceBootstrapForUniverse`、`maintainCatalogGuestForUniverse`、`updateCatalogProfileFieldForUniverse`、`maintainCatalogGroupForUniverse`、`correctCatalogSongArtistForUniverse`、`maintainCatalogImageForUniverse`、`getCatalogAuditHistoryForUniverse`、`createCatalogBackupsForUniverse`、`prepareCatalogManagementForUniverse`、`repairCatalogDatabaseForUniverse`、`restoreCatalogMasterDataForUniverse`、`getRetiredCatalogImageFileIdsForUniverse`、`getCatalogManagementBootstrapForUniverse`、`migrateCatalogManagementSchemaForUniverse`、`createCatalogGroupForUniverse`、`updateCatalogGroupForUniverse`、`createCatalogMemberForUniverse`、`updateCatalogMemberForUniverse`、`addCatalogUnitMemberForUniverse`、`getCatalogSongDeletePreviewForUniverse`、`deleteCatalogSongForUniverse`、`createCatalogSongDraftForUniverse`、`getCatalogManagementReadinessForUniverse`、`moveCatalogMemberDisplayOrderForUniverse`、`changeCatalogMemberPrimaryGroupForUniverse`、`getCatalogMemberDeletePreviewForUniverse`、`deleteCatalogMemberForUniverse`、`moveCatalogUnitMemberForUniverse`、`removeCatalogUnitMemberForUniverse`、`getCatalogProfileFieldsForUniverse`、`createCatalogProfileFieldForUniverse`、`setCatalogProfileFieldActiveForUniverse`、`parseSongLyricsForUniverse`、`registerSongLyricsGuestForUniverse`、`saveNewSongLyricsForUniverse`、`saveSongInfoForUniverse`、`saveSongCreditsForUniverse`、`saveSongPartsForUniverse`

PJ は `BMSGDB.関数名` の直接呼び出しに加え、`catalogManagementCallWriter_('関数名', ...)` と `runManagementOperation` の `writers` 表で、関数名を文字列で指定して呼んでいる。統合後は `BMSGDB.` を外して直接呼び、`BMSGDB[name]` は `globalThis[name]` ではなく許可リストの表引きにする。

**移行しない公開関数（14件、内部関数 54件は別）：** `syncCardsNow`、`onOpen`、`onInstall`、`validateUniverseStructure`、`confirmAndSyncMemberships`、`previewLyricsInput`、`commitLyricsInput`、`runLyricsParserSelfTest`、`confirmAndSyncDirectMasters`、`syncPerformanceMetricRows`、`confirmAndSyncProfiles`、`retireSelectedProfileField`、`restoreRetiredProfileFields`、`updateLyricsPartForUniverse`

元のスプレッドシートやデータは削除しない（決定済み）。

## 5. キャッシュ

`CacheService`／`LockService` の利用箇所：26行。無効化キーは `CacheInvalidation.gs` の `UNIVERSE_CACHE_KEYS_` に集約済み。100KB を超える値がないかは実データで測る必要がある（P1 で確認）。
