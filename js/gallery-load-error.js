/** 區分相簿資料讀取失敗與空相簿，不把後端設定錯誤當成沒有貼文。 */
export function photoLoadError(error) {
    const code = String(error?.code || '').replace(/^firestore\//, '');
    if (code === 'failed-precondition' && /index|索引/i.test(error?.message || '')) {
        return '相簿索引尚未就緒，請管理員確認 photos 的群組與時間複合索引已建立，並等待建置完成。';
    }
    if (code === 'permission-denied' || code === 'unauthenticated') {
        return '目前無法讀取相簿，請重新登入；若仍失敗，請管理員確認群組資料權限。';
    }
    return '相簿暫時無法載入，請檢查網路後重試。';
}
