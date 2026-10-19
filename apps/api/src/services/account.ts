/** GDPR: full data export and account deletion (cascades to every user-owned row). */
import type { AppDeps, AuthContext } from "../deps.js";
import { deleteUser, listSessions, updateProfile, revokeUserSessions } from "../db/users.js";
import { listDevices } from "../db/devices.js";
import { listAllItems } from "../db/items.js";
import { listAuthorTemplatesWithFlow, listUserInstalls, listUserRatings, listUserReports } from "../db/atlas.js";
import { listOwnerShares } from "../db/shares.js";
import { confirmPassword, toPublicUser } from "./auth.js";
import { toDeviceDto } from "./devices.js";
import { toItemDto } from "./sync.js";
import { toDetailDto } from "./atlas.js";
import { accountDeletedMessage } from "../mail/templates.js";
import { errors } from "../errors.js";

export async function exportData(deps: AppDeps, auth: AuthContext) {
  const uid = auth.user.id;
  const [sessions, devices, items, templates, ratings, reports, installs, shares] = await Promise.all([
    listSessions(deps.sql, uid, deps.now()),
    listDevices(deps.sql, uid),
    listAllItems(deps.sql, uid),
    listAuthorTemplatesWithFlow(deps.sql, uid),
    listUserRatings(deps.sql, uid),
    listUserReports(deps.sql, uid),
    listUserInstalls(deps.sql, uid),
    listOwnerShares(deps.sql, uid),
  ]);
  return {
    format: "autoflow.account-export",
    version: 1,
    exportedAt: deps.now().toISOString(),
    note: "Sync items are end-to-end encrypted; decrypt them with your AutoFlow app and sync passphrase.",
    user: toPublicUser(auth.user),
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === auth.session.id,
    })),
    devices: devices.map((d) => toDeviceDto(d, auth.session.deviceId)),
    syncItems: items.map((i) => toItemDto(i, true)),
    atlas: {
      templates: templates.map(toDetailDto),
      ratings: ratings.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
      reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      installs: installs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    },
    shares: shares.map((s) => ({
      id: s.id,
      flow: s.flow,
      contentHash: s.contentHash,
      views: s.views,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt?.toISOString() ?? null,
    })),
  };
}

export async function deleteAccount(deps: AppDeps, auth: AuthContext, password: string): Promise<void> {
  await confirmPassword(auth, password);
  await deps.sql.begin(async (tx) => {
    await revokeUserSessions(tx, auth.user.id);
    if (!(await deleteUser(tx, auth.user.id))) throw errors.notFound("Account");
  });
  deps.logger.info("account.deleted", { userId: auth.user.id });
  await deps.mailer.send(accountDeletedMessage(auth.user.email));
}

export async function updateMe(deps: AppDeps, auth: AuthContext, patch: { displayName?: string | null; locale?: string }) {
  const u = await updateProfile(deps.sql, auth.user.id, patch);
  if (!u) throw errors.notFound("Account");
  return u;
}
