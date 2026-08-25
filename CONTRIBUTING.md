# Contributing

## 可接受的來源

只接受活動主辦或場館的官方說明頁。每個新增或修改的公開事實都必須以 `sources` 保存 URL、擷取時間與來源角色，並在 `provenance` 以 JSON Pointer 指向來源 ID。

工作簿、社群試算表、資料彙整站與其他第三方內容不構成本儲存庫的資料來源。社團自行填寫的分類或介紹屬於活動 overlay，也不在此維護。

虛構範例只能放在 `fixtures/`；不得放入 `data/` 或 production `release-manifest.json`。

## 更新方式

- organizer、venue 與 venue-space 的 stable ID 一旦發布不得重用。
- 分類目錄已被活動採用後不得原地修改；請建立新的 revision 檔案。
- 修改資料後執行 `npm run hashes:update`，再執行 `npm run check`。
- Pull request 必須說明官方來源、變更理由，以及是否已有 event-data repo 準備採用。

維護者負責確認來源確為官方頁面；自動驗證器負責 schema、引用、hash 與 immutable pin 契約。
