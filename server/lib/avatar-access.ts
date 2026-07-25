export function canAccessUserAvatar(
  requesterUserId: string,
  targetUserId: string,
  requesterIsAdmin: boolean,
) {
  return requesterUserId === targetUserId || requesterIsAdmin;
}
