export const IMAGE_SUBMISSION_UNCONFIRMED_HINT = "渠道可能已接收任务，请先到渠道查看结果，避免重复生成或扣费。";
export const IMAGE_SUBMISSION_UNCONFIRMED = `提交结果未确认，${IMAGE_SUBMISSION_UNCONFIRMED_HINT}`;

export function isImageSubmissionUnconfirmed(message?: string) {
    return Boolean(message && /提交结果未确认|任务提交后未返回任务编号|异步任务创建成功，但没有返回任务 ID/.test(message));
}
