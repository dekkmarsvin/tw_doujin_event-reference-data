# tw_doujin_event reference data

這個公開儲存庫保存可跨活動重用的主辦單位、主辦分類目錄、場館及場館空間。資料基礎只來自活動主辦或場館的官方說明頁；社團自行填寫的內容留在各活動 overlay，不會收進本儲存庫。

活動不會直接追蹤 `main`。每個 event-data repository 必須保存：

- 完整的 40 字元 reference commit SHA；
- 實際讀取檔案的 SHA-256；
- 所選主辦、分類目錄 revision、場館與場館空間 stable ID。

缺少 pin、hash 不符、stable ID 不存在或 schema 不相容時，採用端必須停止建置。

## 目錄

```text
schemas/v1/                 versioned JSON Schema contracts
data/                       reviewed production records only
fixtures/reference-data/    isolated fictional reference tree
fixtures/events/            fictional reproducibility pins
release-manifest.json       hashes of every published data file
docs/release-and-adoption.md review, adoption, rollback and recovery runbook
```

## 驗證

需要 Node.js 22.13 或更新版本，沒有第三方 runtime dependency。

```sh
npm run check
```

資料變更後先更新 hash，再執行完整檢查：

```sh
npm run hashes:update
npm run check
```

`main` 只接受通過 review 與 `reference-data / check` 的變更。版本及責任順序見[發布與採用流程](docs/release-and-adoption.md)，保護設定見 [`main` repository ruleset](docs/repository-ruleset.md)。
