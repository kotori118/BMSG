/**
 * User-scoped HOME state: today's song, lucky member and birthdays (deterministic daily picks).
 * Favorites and recent history were removed (2026-11-22) to keep HOME light.
 * Uses existing Core / Log repositories; no new sheets are created here.
 */
function getUniverseHomeBootstrap(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const lookup = buildUniverseStateLookup_();
  const birthdayMembers = getUniverseBirthdayMembers_(lookup);
  return {
    ok: true,
    data: {
      todaySong: getUniverseDailySong_(uid, lookup),
      luckyMember: birthdayMembers.length ? birthdayMembers[0] : getUniverseDailyMember_(uid, lookup),
      birthdayMembers: birthdayMembers
    }
  };
}

function normalizeUniverseStateUserId_(userId) {
  const uid = String(userId || '').trim().toUpperCase();
  if (UNIVERSE_CONFIG.USER_IDS.indexOf(uid) < 0) throw new Error('Invalid UserID.');
  return uid;
}

function buildUniverseStateLookup_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(UNIVERSE_CACHE_KEYS_.HOME_LOOKUP);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const members = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){
    const id=String(row.MemberID||'').trim();
    if(id)members[id]={memberId:id,displayName:String(row.DisplayName||id),colorHex:normalizeUniverseColor_(row.ColorHex)};
  });
  const mainImages = pickMemberMainImages_(readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.IMAGES));
  Object.keys(members).forEach(function(id){ if (mainImages[id]) members[id].imageId = mainImages[id].driveFileId; });
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.PROFILES).forEach(function(row){
    const id=String(row.MemberID||'').trim();
    if(!id || !members[id]) return;
    const birthday=parseProfileBirthday_(row.P002);
    if(!birthday) return;
    members[id].birthdayMonth=birthday.month;
    members[id].birthdayDay=birthday.day;
  });
  const songs = {};
  readUniverseSongs_().forEach(function(row){
    const id=String(row.SongID||'').trim();
    if(id)songs[id]={songId:id,title:String(row.Title||id),artist:String(row.Artist||'')};
  });
  const lookup = {members:members,songs:songs};
  cache.put(UNIVERSE_CACHE_KEYS_.HOME_LOOKUP, JSON.stringify(lookup), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS || 300);
  return lookup;
}

function getUniverseDailySong_(userId, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  const rows = Object.keys(lookup.songs).map(function(id){return lookup.songs[id];}).filter(function(row){return row.songId && row.title;});
  if (!rows.length) return null;
  return rows[deterministicUniverseIndex_(userId, 'song', rows.length)];
}

function getUniverseBirthdayMembers_(lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M-d').split('-');
  const month = Number(today[0]);
  const day = Number(today[1]);
  return Object.keys(lookup.members).map(function(id){return lookup.members[id];}).filter(function(row){
    return row.memberId && row.displayName && Number(row.birthdayMonth) === month && Number(row.birthdayDay) === day;
  });
}

function getUniverseDailyMember_(userId, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  const rows = Object.keys(lookup.members).map(function(id){return lookup.members[id];}).filter(function(row){return row.memberId && row.displayName;});
  if (!rows.length) return null;
  return rows[deterministicUniverseIndex_(userId, 'member', rows.length)];
}

function deterministicUniverseIndex_(userId, kind, length) {
  const dateKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const input = dateKey + '|' + userId + '|' + kind;
  let hash = 2166136261;
  for (let i=0;i<input.length;i++) {hash ^= input.charCodeAt(i);hash = Math.imul(hash, 16777619);}
  return Math.abs(hash >>> 0) % length;
}

function normalizeUniverseColor_(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#9cecff';
}

