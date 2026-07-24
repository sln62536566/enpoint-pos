# Printer Phase 3：WebUSB 連線手冊

## 支援環境與安全界線

- 建議使用具備 `navigator.usb` 的 Windows Chrome。
- Safari 與 iPad 不支援 WebUSB 時，Printer Center 顯示 `unsupported`；POS、Firebase、QR、KDS 與 Admin 必須繼續運作。
- USBDevice、configuration、interface、endpoint 與瀏覽器授權物件只存在記憶體，不寫入 LocalStorage、Firebase 或 Printer Profile。
- Printer Phase 3 does not send print data and does not implement ESC/POS.

## 操作流程

1. 「偵測已授權裝置」呼叫 `getDevices()`。
2. 「選擇 USB 印表機」只能由使用者點擊後呼叫 `requestDevice({ filters: [] })`。
3. 連線執行 `open()`；裝置沒有 active configuration 時，選擇裝置已宣告的 configuration。
4. 中斷連線執行 `close()`，保留可顯示的 metadata，但清除 connected 狀態。
5. 實體拔除事件只在符合目前裝置的 reference，或 VID、PID、serial number 時更新狀態。

`getDevices()` 的 raw USBDevice 只保存在 runtime Map。UI 收到的每筆資料只有 runtime selection key、名稱、製造商、VID、PID 與序號。單台裝置可自動進入 `selected`，多台裝置必須由使用者在清單選擇；兩者都不會自動 `open()`。

重新偵測時，仍存在的 selected device 會更新 runtime reference，並保留 connected 狀態。若已消失，會清除 active device 與 selected metadata，狀態改為 `device_not_found`。

沒有序號的不同 USBDevice object，即使 VID／PID 相同也不會視為同一台，以免相同型號的多台印表機互相誤判。

本階段不 claim interface、不選 endpoint、不 bulk transfer、不送測試票、不做自動重連。

## 狀態契約

`unsupported`、`idle`、`detecting`、`no_device`、`device_available`、`requesting_permission`、`selection_cancelled`、`selected`、`connecting`、`connected`、`disconnecting`、`disconnected`、`permission_denied`、`device_not_found`、`device_disconnected`、`connection_failed`、`error`。

## 錯誤對應

- `NotFoundError`（chooser）：`selection_cancelled`
- `SecurityError` / `NotAllowedError`：`permission_denied`
- `NetworkError` / `InvalidStateError` 或 open 失敗：`connection_failed`
- 目前裝置的 USB disconnect event：`device_disconnected`
- 其他錯誤：`error`

錯誤訊息不可包含 stack，不可向 POS startup 重新拋出。

## 啟動與競態隔離

Printer Center 使用 dynamic import 載入 USB Provider。若模組 404、語法錯誤或 evaluation 失敗，會切換至 unavailable fallback；Browser Provider、Print Queue 與 POS module 仍可繼續啟動。

request、connect、disconnect、重新偵測與 browser connect/disconnect event 共用同一條 operation queue，較舊的非同步結果不能越過較新的操作覆蓋狀態。`destroy()` 會移除 browser listeners、清除 subscribers 與 runtime device references，後續操作只回傳受控 `error` 狀態。

`requestDevice()` 是 user-gesture 例外：Provider 在沒有 operation 執行時會於呼叫堆疊內直接建立 browser chooser Promise，不會先等待一般 operation queue。若 USB 正忙，該次要求立即回傳受控訊息，不會排隊，也不會在稍後自動彈出 chooser；使用者必須等操作完成後再次點選。

USB 已連線時，authorized-device select 會停用。Provider API 也會拒絕切換 active device並保留原連線，直到使用者先完成 disconnect。

## 手動驗證

### Windows Chrome

確認 Printer Center 顯示 WebUSB 可用；取消 chooser 不產生 uncaught error；選擇裝置後顯示名稱與十六進位 VID/PID；連線與中斷狀態正確；拔除裝置更新為 `device_disconnected`；重新整理後不會自動開啟 chooser 或自動連線。

若沒有 USB 印表機，可驗證 unsupported、chooser cancellation 與 mock provider 路徑；不能宣稱完成實機連線驗證。

### 舊 iPad Safari / PWA

確認顯示不支援 WebUSB、所有 USB 按鈕停用、沒有 JavaScript uncaught error，且 POS、設定、訂單與其他中心仍可操作。
