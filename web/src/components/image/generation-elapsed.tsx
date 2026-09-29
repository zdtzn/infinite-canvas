import { Tag } from "antd";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/image-utils";

// Keep the one-second clock local: task snapshots only change with actual work.
export function GenerationElapsed({ startedAt }: { startedAt: number }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [startedAt]);
    return <Tag className="m-0 px-2 py-1">已等待 {formatDuration(Math.max(0, now - startedAt))}</Tag>;
}
