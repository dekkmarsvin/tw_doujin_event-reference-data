# Reference data 發布、採用與回復

## 角色

- **Reference maintainer**：審查官方來源與 provenance，發布新的 reference commit。
- **Event-data maintainer**：選擇明確 reference commit，保存逐檔 hash 與活動 assignment。
- **Application maintainer**：更新主程式的 event-data pin，執行完整 build gate。

同一個人可以擔任多個角色，但三個步驟仍須留下可獨立審查的 commit。

## 發布

1. 從活動主辦或場館官方頁面確認資料。
2. 新增 immutable revision；不要改寫已被活動採用的分類目錄版本。
3. 更新 field-level provenance。
4. 執行 `npm run hashes:update` 與 `npm run check`。
5. 經 repository review 與 required check 通過後合併 `main`，記錄完整 commit SHA。

## Event-data 採用

1. 從已 review 的 reference commit 選取所需檔案。
2. 在 event-data repo 建立 `reference-data-pin/1`，保存完整 commit SHA、逐檔 SHA-256 與 stable ID selection。
3. 以採用端 fetch／verify 工具重建；任何缺檔、hash mismatch、未知 ID 或 schema mismatch 都必須 fail closed。
4. review 並發布 event-data commit。
5. 最後才更新 application repo 的 event-data pin。

活動已固定的 reference commit 不會因 `main` 後續更新而改變。

## Rollback

- Reference 變更尚未被 event-data 採用：回復 reference PR 或發布更正 revision，不需修改既有活動。
- Event-data pin 已更新但 application 尚未採用：將 event-data pin 回復到前一個可驗證 commit。
- Application 已採用：先將 application 的 event-data pin 回復，再視需要回復 event-data pin。不要刪除舊 reference commit 或 immutable revision。

## 失敗復原

1. 保留目前可工作的 pin 與輸出，不以部分下載覆蓋。
2. 依錯誤定位缺檔、hash、stable ID 或 schema 問題。
3. 在責任所屬 repo 建立修正 commit，重新由 reference → event-data → application 的順序採用。
4. 重跑所有 gate；不得以追蹤 `main`、忽略 hash 或猜測預設值繞過驗證。
