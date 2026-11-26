// Originally imported from kotori118/BMSG-PJ UserPreferencesApi.gs (2026-11-21). This repository is now the source: edit this file directly.
/**
 * 設定：推しメン（ユーザーごと）。BMSG_ Universe_Log の Users 行の FavoriteMemberID に保存する。
 * メンバーカラー・推しグループから始める機能は廃止（列はシートに残っているが読み書きしない）。
 */
const UNIVERSE_USER_FAVORITE_MEMBER_COLUMN_ = 'FavoriteMemberID';

function getUniverseSettingsBootstrap(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const members = buildUniversePreferenceMemberCatalog_();
  return {ok: true, data: {preferences: readUniverseUserPreferences_(uid, members), members: members}};
}

function saveUniverseUserPreferences(payload) {
  payload = payload || {};
  const uid = normalizeUniverseStateUserId_(payload.userId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const members = buildUniversePreferenceMemberCatalog_();
    const favoriteMemberId = String(payload.favoriteMemberId || '').trim();
    const favoriteMember = favoriteMemberId ? members.find(function(member) { return member.memberId === favoriteMemberId; }) : null;
    if (favoriteMemberId && !favoriteMember) throw new Error('推しメンが見つかりません。');

    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS);
    const row = readSheetObjectsWithRows_(sheet).find(function(item) {
      return String(item.UserID || '').trim().toUpperCase() === uid;
    });
    if (!row) throw new Error('Userが見つかりません。');
    const record = {};
    record[UNIVERSE_USER_FAVORITE_MEMBER_COLUMN_] = favoriteMemberId;
    updateByHeaders_(sheet, row.__rowNumber, record);

    return {ok: true, data: {preferences: universeUserPreferenceRecord_(uid, favoriteMember), members: members}};
  } finally {
    lock.releaseLock();
  }
}

function readUniverseUserPreferences_(userId, members) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS);
  const row = readSheetObjects_(sheet).find(function(item) {
    return String(item.UserID || '').trim().toUpperCase() === userId;
  });
  if (!row) throw new Error('Userが見つかりません。');
  const favoriteMemberId = String(row[UNIVERSE_USER_FAVORITE_MEMBER_COLUMN_] || '').trim();
  const favoriteMember = members.find(function(member) { return member.memberId === favoriteMemberId; }) || null;
  return universeUserPreferenceRecord_(userId, favoriteMember);
}

function universeUserPreferenceRecord_(userId, favoriteMember) {
  return {
    userId: userId,
    favoriteMemberId: favoriteMember ? favoriteMember.memberId : '',
    favoriteMemberName: favoriteMember ? favoriteMember.displayName : '',
    favoriteGroupName: favoriteMember ? favoriteMember.groupName : ''
  };
}

// 推しメンの選択肢（表示順）。色は選択画面の点に使う。
function buildUniversePreferenceMemberCatalog_() {
  const groups = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS).forEach(function(row) {
    const groupId = String(row.GroupID || '').trim();
    if (groupId) groups[groupId] = String(row.GroupName || '').trim();
  });
  return readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).map(function(row) {
    const memberId = String(row.MemberID || '').trim();
    const groupId = String(row.GroupID || '').trim();
    const color = String(row.ColorHex || '').trim();
    return {
      memberId: memberId,
      displayName: String(row.DisplayName || memberId).trim(),
      colorHex: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
      groupName: groupId && groups[groupId] ? groups[groupId] : '',
      displayOrder: Number(row.DisplayOrder || 9999)
    };
  }).filter(function(member) {
    return Boolean(member.memberId && member.displayName);
  }).sort(function(a, b) {
    return a.displayOrder - b.displayOrder || a.displayName.localeCompare(b.displayName, 'ja');
  });
}
