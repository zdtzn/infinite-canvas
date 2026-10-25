import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import type { CultivationProfile } from "@/services/server-api";

export function UserIdentity({ user, large = false }: { user: Pick<CultivationProfile, "displayName" | "userId" | "avatarUrl">; large?: boolean }) {
    const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "U";
    return (
        <div className={`cultivation-user-identity ${large ? "is-large" : ""}`}>
            <ProfileAvatarImage src={user.avatarUrl} alt="" fallback={initial} width={large ? 40 : 32} height={large ? 40 : 32} loading={large ? "eager" : "lazy"} fetchPriority={large ? "high" : "low"} className="cultivation-user-avatar" />
            <div className="min-w-0">
                <div className="cultivation-user-name truncate font-medium">{user.displayName}</div>
                <div className="cultivation-user-id mt-0.5 truncate text-xs" title={user.userId}>
                    UID {user.userId.slice(0, 8)}
                </div>
            </div>
        </div>
    );
}
