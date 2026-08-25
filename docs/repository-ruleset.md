# `main` repository ruleset

首次發布並讓 `reference-data / check` 成功出現後，在 GitHub 建立作用中的 branch ruleset：

- 名稱：`reference-data-main`
- Target：default branch (`main`)
- Restrict deletions：開啟
- Block force pushes：開啟
- Require a pull request before merging：開啟
- Require conversation resolution before merging：開啟
- Require status checks before merging：`reference-data / check`
- Require branches to be up to date before merging：開啟
- Bypass：不設定常態 bypass actor

目前 repository 只有一位 GitHub 維護者，因此 required approvals 維持 `0`；設為 `1` 會讓維護者無法核准自己的 PR。每個變更仍必須留下獨立 reviewer 紀錄並通過 required check。加入第二位具有 write 權限的維護者後，應把 required approvals 調為 `1`，並開啟 stale approval dismissal。

Ruleset 建立後，以一個只修改 fictional fixture 的測試 PR 確認：直接 push、force push、未通過 check 的 merge、未解決 conversation 的 merge及刪除 `main` 都會被拒絕。
