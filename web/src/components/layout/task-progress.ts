export type TaskProgressStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export function taskProgressProps(status: TaskProgressStatus) {
    return status === "queued" || status === "running" ? { status: "active" as const } : null;
}
