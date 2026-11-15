/** 這些錯誤無法證明交易未提交；確認時必須保留原 action、payload 與 requestId。 */
export const isUncertainSteal = error => !error?.code || ['ops/timeout', 'functions/deadline-exceeded', 'functions/internal', 'functions/unavailable', 'functions/unauthenticated', 'functions/resource-exhausted', 'functions/unknown', 'functions/cancelled'].includes(error?.code);

/** 最多重查一次；呼叫端須使用保留 requestId 的 farmCommand，不建立新交易。 */
export async function confirmStealRequest(send, onUncertain) {
    try { return await send(); }
    catch (error) {
        if (!isUncertainSteal(error)) throw error;
        onUncertain(error);
        return send();
    }
}
