// Originally imported from kotori118/BMSG-DB UniverseService.gs (2026-11-21). This repository is now the source: edit this file directly.
/**
 * BMSG Universe から利用する共通Writer。
 * Song / Lyrics / Guest の書込、検証、採番、ロールバックをBMSG-DBに集約する。
 * 公開関数はライブラリ経由でBMSG-PJから呼ばれる。
 */
const BU_SERVICE_USERS_ = Object.freeze(['U001','U002','U003']);
const BU_SERVICE_FORMS_ = Object.freeze(['シングル','アルバム','デジタルリリース','その他']);
const BU_SERVICE_ROLES_ = Object.freeze(['MAIN','UP','DOWN','SUB']);

function parseSongLyricsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const raw = String(payload.rawLyrics || '');
  if (!raw.trim()) throw new Error('歌詞を入力してください。');
  const ss = openCoreSpreadsheet_();
  const masters = loadLyricsSingers_(ss);
  const ignoredGuests = {};
  (Array.isArray(payload.ignoredGuestCandidates) ? payload.ignoredGuestCandidates : []).forEach(function(name) {
    const key = universeServiceGuestCandidateKey_(name);
    if (key) ignoredGuests[key] = true;
  });
  const unknownGuests = findUnknownLyricsGuestCandidates_(raw, { singers: masters }).filter(function(name) {
    return !ignoredGuests[universeServiceGuestCandidateKey_(name)];
  });
  const errors = [];
  const parts = parseLyricsParts_(normalizeLineEndings_(raw).split('\n'), masters, errors);
  if (!parts.length) errors.push('歌詞パートを作成できませんでした。');
  const singerById = universeServiceSingerById_(ss);
  return {
    parts: parts.map(function(part, index) {
      const assignments = part.mainSingerIds.map(function(id) {
        const item = singerById[String(id)] || { name: String(id) };
        return { id: String(id), name: item.name, role: 'MAIN' };
      });
      return {
        partOrder: index + 1,
        singer: part.mainSingerIds.join(','),
        singers: assignments,
        lyrics: part.lyrics
      };
    }),
    unknownGuests: unknownGuests,
    errors: errors,
    canRegister: unknownGuests.length === 0 && errors.length === 0
  };
}

function universeServiceGuestCandidateKey_(value) {
  const text = String(value == null ? '' : value).trim();
  return typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
}

function registerSongLyricsGuestForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const name = clean_(payload.name);
  if (!name) throw new Error('Guest名を入力してください。');
  return withSharedWriterLock_('Guest登録', function() {
    return registerGuestCore_(openCoreSpreadsheet_(), name, {
      source:'BMSG-DB_UNIVERSE',
      notePrefix:'Universe Guest登録'
    });
  });
}

function saveNewSongLyricsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const song = normalizeUniverseServiceSong_(payload.song || {});
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  const rawLyrics = String(payload.rawLyrics || '');
  if (!rawLyrics.trim()) throw new Error('歌詞を入力してください。');

  const parsed = parseSongLyricsForUniverse({
    userId:payload.userId,
    rawLyrics:rawLyrics,
    ignoredGuestCandidates:payload.ignoredGuestCandidates
  });
  if (parsed.unknownGuests.length) throw new Error('未登録のSingerがあります: ' + parsed.unknownGuests.join('、'));
  if (!parsed.canRegister) throw new Error((parsed.errors || ['歌詞を解析できませんでした。']).join('\n'));

  return withSharedWriterLock_('新規楽曲登録', function() {
    return createSongWithPartsCore_(openCoreSpreadsheet_(), song, credits, parsed.parts, {
      source:'BMSG-DB_UNIVERSE',
      notePrefix:'Universe 新規曲'
    });
  });
}

function saveSongInfoForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  const song = normalizeUniverseServiceSong_(payload.song || {}, true);
  if (!songId) throw new Error('SongIDがありません。');
  return withSharedWriterLock_('楽曲情報保存', function() {
    const ss = openCoreSpreadsheet_();
    const sheet = requireSheet_(ss, BU1.SHEETS.SONGS);
    const table = readTable_(sheet);
    const target = table.rows.filter(r => id_(r.values[table.map.SongID]) === songId);
    if (target.length !== 1) throw new Error('06_SongsでSongIDを一意に確認できません。');
    const currentArtist = universeServiceStoredArtist_(table,target[0]);
    const identity = table.map.ArtistID == null && song.artist && /^([GUM])\d+$/.test(song.artist)
      ? universeServiceArtistIdentity_(ss,song.artist).name : song.artist;
    if (currentArtist !== identity) throw new Error('登録後のARTISTは変更できません。');
    const row = target[0].rowNumber;
    const beforeSong = sheet.getRange(row, 1, 1, table.header.length).getValues()[0];
    const afterSong = beforeSong.slice();
    afterSong[table.map.Title] = song.title;
    afterSong[table.map.ReleaseDate] = song.releaseDateValue;
    afterSong[table.map.Form] = song.form;
    afterSong[table.map.CDTitle] = song.cdTitle;
    afterSong[table.map.IsTitleTrack] = song.isTitleTrack;

    const creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const creditsTable = readTable_(creditsSheet);
    const creditRows = creditsTable.rows.filter(r => id_(r.values[creditsTable.map.SongID]) === songId);
    if (creditRows.length > 1) throw new Error('07_SongCreditsでSongIDが重複しています。');
    let creditRowNumber = 0;
    let beforeCredit = null;
    let afterCredit = null;
    let appendedCredit = false;
    if (creditsTable.map.Title != null && universeServiceBeFirst_(table,target[0])) {
      requireColumns_(creditsTable, ['SongID','Lyricists','Composers','Choreographers']);
      if (creditRows.length) {
        creditRowNumber = creditRows[0].rowNumber;
        beforeCredit = creditsSheet.getRange(creditRowNumber, 1, 1, creditsTable.header.length).getValues()[0];
        afterCredit = beforeCredit.slice();
        afterCredit[creditsTable.map.Title] = song.title;
      } else {
        afterCredit = new Array(creditsTable.header.length).fill('');
        afterCredit[creditsTable.map.SongID] = songId;
        afterCredit[creditsTable.map.Title] = song.title;
      }
    }

    try {
      sheet.getRange(row, 1, 1, afterSong.length).setValues([afterSong]);
      if (afterCredit) {
        if (creditRowNumber) creditsSheet.getRange(creditRowNumber, 1, 1, afterCredit.length).setValues([afterCredit]);
        else { creditRowNumber = appendStyledRow_(creditsSheet, afterCredit); appendedCredit = true; }
      }
      SpreadsheetApp.flush();
      assertUniverseServiceRow_(sheet, row, afterSong, [table.map.SongID,table.map.Title,table.map.ArtistID == null ? table.map.Artist : table.map.ArtistID,table.map.ReleaseDate,table.map.Form,table.map.CDTitle,table.map.IsTitleTrack], '楽曲情報');
      if (afterCredit) assertUniverseServiceRow_(creditsSheet, creditRowNumber, afterCredit, [creditsTable.map.SongID,creditsTable.map.Title], '楽曲クレジット');
      return { ok:true, songId:songId };
    } catch (error) {
      const rollbackErrors = [];
      try { sheet.getRange(row, 1, 1, beforeSong.length).setValues([beforeSong]); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      try {
        if (appendedCredit && creditRowNumber <= creditsSheet.getLastRow()) creditsSheet.deleteRow(creditRowNumber);
        else if (beforeCredit) creditsSheet.getRange(creditRowNumber, 1, 1, beforeCredit.length).setValues([beforeCredit]);
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      SpreadsheetApp.flush();
      throw universeServiceRollbackError_(error, rollbackErrors);
    }
  });
}

function saveSongCreditsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  if (!songId) throw new Error('SongIDがありません。');
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  return withSharedWriterLock_('クレジット保存', function() {
    const ss = openCoreSpreadsheet_();
    const songsTable = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
    const songRows = songsTable.rows.filter(r => id_(r.values[songsTable.map.SongID]) === songId);
    if (songRows.length !== 1) throw new Error('06_SongsでSongIDを一意に確認できません。');
    const songRow = songRows[0];
    if (!universeServiceBeFirst_(songsTable,songRow)) throw new Error('SongCreditsはBE:FIRSTの楽曲のみ登録できます。');
    const sheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const table = readTable_(sheet);
    requireColumns_(table, ['SongID','Lyricists','Composers','Choreographers']);
    const rows = table.rows.filter(r => id_(r.values[table.map.SongID]) === songId);
    if (rows.length > 1) throw new Error('07_SongCreditsでSongIDが重複しています。');
    const row = rows[0] || null;
    const before = row ? sheet.getRange(row.rowNumber, 1, 1, table.header.length).getValues()[0] : null;
    const after = before ? before.slice() : new Array(table.header.length).fill('');
    after[table.map.SongID] = songId;
    if (table.map.Title != null) after[table.map.Title] = clean_(songRow.values[songsTable.map.Title]);
    after[table.map.Lyricists] = credits.lyricists;
    after[table.map.Composers] = credits.composers;
    after[table.map.Choreographers] = credits.choreographers;
    let rowNumber = row ? row.rowNumber : 0;
    try {
      if (rowNumber) sheet.getRange(rowNumber, 1, 1, after.length).setValues([after]);
      else rowNumber = appendStyledRow_(sheet, after);
      SpreadsheetApp.flush();
      assertUniverseServiceRow_(sheet, rowNumber, after, [table.map.SongID,table.map.Title,table.map.Lyricists,table.map.Composers,table.map.Choreographers].filter(index => index != null), '楽曲クレジット');
      return { ok:true, songId:songId };
    } catch (error) {
      const rollbackErrors = [];
      try {
        if (before) sheet.getRange(rowNumber, 1, 1, before.length).setValues([before]);
        else if (rowNumber && rowNumber <= sheet.getLastRow()) sheet.deleteRow(rowNumber);
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      SpreadsheetApp.flush();
      throw universeServiceRollbackError_(error, rollbackErrors);
    }
  });
}

function saveSongPartsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  if (!songId) throw new Error('SongIDがありません。');
  const incoming = Array.isArray(payload.parts) ? payload.parts : [];
  if (!incoming.length) throw new Error('歌詞パートがありません。');
  return withSharedWriterLock_('歌詞保存', function() {
    return replaceSongPartsCore_(openCoreSpreadsheet_(), songId, incoming);
  });
}

function requireUniverseServiceUser_(userId) {
  const id = clean_(userId);
  if (BU_SERVICE_USERS_.indexOf(id) < 0) throw new Error('利用ユーザーを選択してください。');
  return id;
}

function normalizeUniverseServiceSong_(input, allowUnassigned) {
  const title = clean_(input.title), artist = clean_(input.artist), form = clean_(input.form), cdTitle = clean_(input.cdTitle);
  const releaseDate = clean_(input.releaseDate);
  if (!title) throw new Error('TITLEを入力してください。');
  if (!artist && !allowUnassigned) throw new Error('ARTISTを選択してください。');
  if (form && BU_SERVICE_FORMS_.indexOf(form) < 0) throw new Error('FORMを確認してください。');
  if ((form === 'デジタルリリース' || form === 'その他') && cdTitle) throw new Error('デジタルリリース／その他ではCD TITLEを空欄にしてください。');
  let releaseDateValue = '';
  if (releaseDate) releaseDateValue = normalizeDateForSheet_(releaseDate);
  return { title:title, artist:artist, releaseDate:releaseDate, releaseDateValue:releaseDateValue, form:form, cdTitle:cdTitle,
    isTitleTrack: input.isTitleTrack === true || String(input.isTitleTrack || '').toUpperCase() === 'TRUE' };
}

function normalizeUniverseServiceCredits_(input) {
  return { lyricists:clean_(input.lyricists), composers:clean_(input.composers), choreographers:clean_(input.choreographers) };
}

function assertUniverseServiceRow_(sheet, rowNumber, expected, columns, label) {
  const actual = sheet.getRange(rowNumber, 1, 1, expected.length).getValues()[0];
  const mismatched = columns.some(function(index){
    return !sameUniverseServiceValue_(actual[index], expected[index]);
  });
  if (mismatched) throw new Error(label + 'の保存後照合に失敗しました。');
}

function sameUniverseServiceValue_(actual, expected) {
  if (actual instanceof Date || expected instanceof Date) {
    const actualDate = actual instanceof Date ? actual : new Date(actual);
    const expectedDate = expected instanceof Date ? expected : new Date(expected);
    return Number.isFinite(actualDate.getTime()) && Number.isFinite(expectedDate.getTime()) && actualDate.getTime() === expectedDate.getTime();
  }
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    return (actual === true || String(actual).toUpperCase() === 'TRUE') === (expected === true || String(expected).toUpperCase() === 'TRUE');
  }
  return String(actual == null ? '' : actual).trim() === String(expected == null ? '' : expected).trim();
}

function universeServiceRollbackError_(originalError, rollbackErrors) {
  const message = originalError && originalError.message ? originalError.message : String(originalError || '保存に失敗しました。');
  return new Error(rollbackErrors && rollbackErrors.length
    ? message + '\n復元にも失敗しました: ' + rollbackErrors.join(' / ')
    : message);
}

function universeServiceStoredArtist_(table, row) {
  return clean_(row.values[table.map.ArtistID == null ? table.map.Artist : table.map.ArtistID]);
}
function universeServicePersonalSong_(table, row) {
  if (table.map.ArtistID != null) return /^M\d+$/.test(universeServiceStoredArtist_(table,row));
  return clean_(row.values[table.map.SongType]) === 'SOLO' || /^M\d+$/.test(id_(row.values[table.map.ArtistRef]));
}
function universeServiceBeFirst_(table, row) {
  return !universeServicePersonalSong_(table,row) &&
    (table.map.ArtistID != null ? universeServiceStoredArtist_(table,row) === 'G1' : universeServiceStoredArtist_(table,row) === 'BE:FIRST');
}
function universeServiceArtistIdentity_(ss, value) {
  const groups = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const entries = groups.rows.map(r => ({id:id_(r.values[groups.map.GroupID]), name:clean_(r.values[groups.map.GroupName])}))
    .concat(members.rows.map(r => ({id:id_(r.values[members.map.MemberID]), name:clean_(r.values[members.map.DisplayName])})));
  const matches = entries.filter(entry => entry.id && (entry.id === value || entry.name === value));
  if (matches.length !== 1) throw new Error('アーティストを一意のG/U/M IDへ紐付けできません: ' + value);
  return matches[0];
}
function universeServiceSingerById_(ss) {
  const result = { '99':{id:'99',name:'ALL'}, '109':{id:'109',name:'その他'} };
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const guests = readTable_(requireSheet_(ss, BU1.SHEETS.GUESTS));
  members.rows.forEach(function(r) {
    const id = id_(r.values[members.map.MemberID]), name = clean_(r.values[members.map.DisplayName]);
    if (id && name) result[id] = {id:id,name:name};
  });
  guests.rows.forEach(function(r) {
    const id = id_(r.values[guests.map.GuestID]), name = clean_(r.values[guests.map.DisplayName]);
    if (id && name) result[id] = {id:id,name:name};
  });
  return result;
}

function encodeUniverseServiceSingerAssignments_(items, singerById) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map(function(item) {
    const id = clean_(item && item.id), role = clean_(item && item.role || 'MAIN').toUpperCase() || 'MAIN';
    if (!singerById[id]) throw new Error('未登録のSinger IDです: ' + id);
    if (BU_SERVICE_ROLES_.indexOf(role) < 0) throw new Error('Singer roleが不正です: ' + role);
    return id + (role === 'MAIN' ? '' : '_' + role.toLowerCase());
  }).join(',');
}

function validateUniverseServiceSingerString_(raw, singerById) {
  const tokens = String(raw || '').split(',').map(clean_).filter(Boolean);
  if (!tokens.length) return '';
  tokens.forEach(function(token) {
    const m = token.match(/_(up|down|sub)$/i);
    const id = m ? token.slice(0, -m[0].length) : token;
    if (!singerById[id]) throw new Error('未登録のSinger IDです: ' + id);
  });
  return tokens.join(',');
}
/**
 * Shared writer internals.
 * Universe UI and legacy spreadsheet routes both mutate DB only through
 * these helpers / wrappers. Feature files may collect input and confirm,
 * but must not write Song / Lyrics / Guest master rows directly.
 */
function registerGuestCore_(ss, name, context) {
  context = context || {};
  name = clean_(name);
  if (!name) throw new Error('Guest名を入力してください。');
  const memberTable = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const guestSheet = requireSheet_(ss, BU1.SHEETS.GUESTS);
  const guestTable = readTable_(guestSheet);
  requireColumns_(memberTable, ['DisplayName']);
  requireColumns_(guestTable, ['GuestID','DisplayName']);
  const existingRowNumber = Number(context.existingRowNumber || 0);
  if (memberTable.rows.some(function(r){ return clean_(r.values[memberTable.map.DisplayName]) === name; })) {
    return {ok:true, alreadyExists:true, name:name};
  }
  const duplicateGuests = guestTable.rows.filter(function(r){
    return clean_(r.values[guestTable.map.DisplayName]) === name && r.rowNumber !== existingRowNumber;
  });
  if (duplicateGuests.length) {
    const committed = duplicateGuests.find(function(r){ return !!id_(r.values[guestTable.map.GuestID]); });
    if (committed) return {ok:true, alreadyExists:true, guestId:id_(committed.values[guestTable.map.GuestID]), name:name};
    throw new Error('Guest名が複数行に入力されています: ' + name);
  }

  const reservation = reserveNumberForKey_(ss, 'NEXT_GUEST_ID', context.source || 'BMSG-DB', (context.notePrefix || 'Guest登録') + ': ' + name);
  let appendedRow = 0;
  try {
    if (existingRowNumber) {
      const fresh = readTable_(guestSheet);
      const row = fresh.rows.find(function(r){ return r.rowNumber === existingRowNumber; });
      if (!row || id_(row.values[fresh.map.GuestID]) || clean_(row.values[fresh.map.DisplayName]) !== name) throw new Error('Guest入力行が変更されています。もう一度確認してください。');
      guestSheet.getRange(existingRowNumber, fresh.map.GuestID + 1).setValue(reservation.issuedId);
    } else {
      const values = new Array(guestTable.header.length).fill('');
      values[guestTable.map.GuestID] = reservation.issuedId;
      values[guestTable.map.DisplayName] = name;
      appendedRow = appendStyledRow_(guestSheet, values);
    }
    SpreadsheetApp.flush();
    const verify = readTable_(guestSheet).rows.filter(function(r){
      return id_(r.values[guestTable.map.GuestID]) === reservation.issuedId && clean_(r.values[guestTable.map.DisplayName]) === name;
    });
    if (verify.length !== 1) throw new Error('Guest登録後の照合に失敗しました。');
    finalizeIdReservation_(reservation, true, 'Guest登録完了: ' + name);
    return {ok:true, guestId:reservation.issuedId, name:name};
  } catch (e) {
    if (existingRowNumber) {
      try {
        const current = guestSheet.getRange(existingRowNumber, guestTable.map.GuestID + 1);
        if (id_(current.getValue()) === reservation.issuedId) current.clearContent();
      } catch (ignore) {}
    } else if (appendedRow) {
      try { guestSheet.deleteRow(appendedRow); } catch (ignore) {}
    }
    try { finalizeIdReservation_(reservation, false, 'Guest登録失敗: ' + name); } catch (ignore) {}
    throw e;
  }
}

function createSongWithPartsCore_(ss, song, credits, parsedParts, context) {
  context = context || {};
  const songsSheet = requireSheet_(ss, BU1.SHEETS.SONGS);
  const songsTable = readTable_(songsSheet);
  const usesArtistId = songsTable.map.ArtistID != null;
  const artistColumn = usesArtistId ? 'ArtistID' : 'Artist';
  requireColumns_(songsTable, ['SongID','Title',artistColumn,'ReleaseDate','Form','CDTitle','IsTitleTrack']);
  const artist = song.artist === 'UNIT' && !usesArtistId ? {id:'',name:'UNIT'} : universeServiceArtistIdentity_(ss,song.artist);
  const personal = /^M\d+$/.test(artist.id);
  const storedArtist = usesArtistId ? artist.id : artist.name;
  const duplicate = songsTable.rows.find(function(row) {
    return clean_(row.values[songsTable.map.Title]) === song.title && universeServiceStoredArtist_(songsTable,row) === storedArtist;
  });
  if (duplicate) return {ok:false, duplicate:true, songId:id_(duplicate.values[songsTable.map.SongID]), title:song.title, artist:artist.name};
  const parts = Array.isArray(parsedParts) ? parsedParts : [];
  if (personal && parts.length) throw new Error('個人曲の歌詞は登録できません。');
  if (!parts.length && !context.allowEmptyParts) throw new Error('歌詞パートがありません。');

  const band = BU1.SONG_BANDS[artist.name] || BU1.SONG_BANDS.DEFAULT;
  const reservation = reserveNumberForKey_(ss, 'NEXT_SONG_ID_' + band, context.source || 'BMSG-DB', (context.notePrefix || '新規曲') + ': ' + song.title);
  const rollback = [];
  try {
    if(Number(reservation.numericValue)>band+999)
      throw new Error('SongIDの採番帯が上限に達しました: '+band+'〜'+(band+999));
    const songValues = new Array(songsTable.header.length).fill('');
    songValues[songsTable.map.SongID] = reservation.issuedId;
    songValues[songsTable.map.Title] = song.title;
    songValues[songsTable.map[artistColumn]] = storedArtist;
    if (songsTable.map.ArtistRef != null) songValues[songsTable.map.ArtistRef] = artist.id;
    songValues[songsTable.map.ReleaseDate] = song.releaseDateValue;
    songValues[songsTable.map.Form] = song.form;
    songValues[songsTable.map.CDTitle] = song.cdTitle;
    songValues[songsTable.map.IsTitleTrack] = song.isTitleTrack;
    if (songsTable.map.SongType != null) songValues[songsTable.map.SongType] = personal ? 'SOLO' : 'NORMAL';
    if (songsTable.map.SoloMemberID != null) songValues[songsTable.map.SoloMemberID] = personal ? artist.id : '';
    rollback.push({sheet:songsSheet,row:appendStyledRow_(songsSheet, songValues)});

    let creditsSheet = null;
    let creditsTable = null;
    if (artist.id === 'G1') {
      creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
      creditsTable = readTable_(creditsSheet);
      requireColumns_(creditsTable, ['SongID','Lyricists','Composers','Choreographers']);
      const creditValues = new Array(creditsTable.header.length).fill('');
      creditValues[creditsTable.map.SongID] = reservation.issuedId;
      if (creditsTable.map.Title != null) creditValues[creditsTable.map.Title] = song.title;
      creditValues[creditsTable.map.Lyricists] = credits.lyricists;
      creditValues[creditsTable.map.Composers] = credits.composers;
      creditValues[creditsTable.map.Choreographers] = credits.choreographers;
      rollback.push({sheet:creditsSheet,row:appendStyledRow_(creditsSheet, creditValues)});
    }

    const partsSheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
    const partsTable = readTable_(partsSheet);
    requireColumns_(partsTable, ['SongID','PartOrder','Singer','Lyrics']);
    parts.forEach(function(part,index){
      const singer = clean_(part.singer || (part.mainSingerIds || []).join(','));
      const lyrics = String(part.lyrics || '').trim();
      if (!singer || !lyrics) throw new Error('Part ' + (index + 1) + ' のSingerまたは歌詞が空です。');
      const values = new Array(partsTable.header.length).fill('');
      values[partsTable.map.SongID] = reservation.issuedId;
      values[partsTable.map.PartOrder] = index + 1;
      values[partsTable.map.Singer] = singer;
      values[partsTable.map.Lyrics] = lyrics;
      rollback.push({sheet:partsSheet,row:appendStyledRow_(partsSheet, values)});
    });

    if (artist.id === 'G1') {
      const metric=ensurePerformanceMetricRowForSong_(ss,reservation.issuedId);
      if(metric.created)rollback.push({sheet:metric.sheet,row:metric.row});
    }
    SpreadsheetApp.flush();
    const verifySongs = readTable_(songsSheet).rows.filter(function(r){ return id_(r.values[songsTable.map.SongID]) === reservation.issuedId; });
    const verifyPartsTable = readTable_(partsSheet);
    const verifyParts = verifyPartsTable.rows.filter(function(r){ return id_(r.values[verifyPartsTable.map.SongID]) === reservation.issuedId; });
    const verifyCredits = creditsSheet ? readTable_(creditsSheet).rows.filter(function(r){ return id_(r.values[creditsTable.map.SongID]) === reservation.issuedId; }) : [];
    if (verifySongs.length !== 1 || verifyParts.length !== parts.length || (artist.id === 'G1' && verifyCredits.length !== 1)) throw new Error('登録後の照合に失敗しました。');
    finalizeIdReservation_(reservation, true, '新規曲登録完了: ' + song.title);
    return {ok:true, songId:reservation.issuedId, title:song.title, artist:artist.name};
  } catch (e) {
    rollback.sort(function(a,b){ return b.row-a.row; }).forEach(function(item){
      try { if (item.row >= 2 && item.row <= item.sheet.getLastRow()) item.sheet.deleteRow(item.row); } catch (ignore) {}
    });
    try { finalizeIdReservation_(reservation, false, '新規曲登録失敗: ' + song.title); } catch (ignore) {}
    throw e;
  }
}

function universeServiceRequireLyricsSong_(ss,songId) {
  const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  const matches = songs.rows.filter(row => id_(row.values[songs.map.SongID]) === songId);
  if (matches.length !== 1) throw new Error('曲を一意に確認できません。');
  if (universeServicePersonalSong_(songs,matches[0])) throw new Error('個人曲の歌詞は登録できません。');
}

function replaceSongPartsCore_(ss, songId, incoming) {
  universeServiceRequireLyricsSong_(ss,songId);
  const singerById = universeServiceSingerById_(ss);
  const normalized = incoming.map(function(part,index){
    const lyrics = String(part && part.lyrics || '').trim();
    if (!lyrics) throw new Error('Part ' + (index + 1) + ' の歌詞が空です。');
    const singer = Array.isArray(part && part.singers)
      ? encodeUniverseServiceSingerAssignments_(part.singers, singerById)
      : validateUniverseServiceSingerString_(String(part && part.singer || ''), singerById);
    if (!singer) throw new Error('Part ' + (index + 1) + ' のSingerを選択してください。');
    return {partOrder:index + 1, singer:singer, lyrics:lyrics};
  });
  const sheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
  let table = readTable_(sheet);
  requireColumns_(table, ['SongID','PartOrder','Singer','Lyrics']);
  const oldRows = table.rows.filter(function(r){ return id_(r.values[table.map.SongID]) === songId; }).map(function(r){ return {rowNumber:r.rowNumber, values:r.values.slice()}; });
  try {
    oldRows.slice().sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(r){sheet.deleteRow(r.rowNumber);});
    table = readTable_(sheet);
    normalized.forEach(function(part){
      const values = new Array(table.header.length).fill('');
      values[table.map.SongID] = songId;
      values[table.map.PartOrder] = part.partOrder;
      values[table.map.Singer] = part.singer;
      values[table.map.Lyrics] = part.lyrics;
      appendStyledRow_(sheet, values);
    });
    SpreadsheetApp.flush();
    const verify = readTable_(sheet);
    const rows = verify.rows.filter(function(r){ return id_(r.values[verify.map.SongID]) === songId; });
    if (rows.length !== normalized.length) throw new Error('歌詞保存後の照合に失敗しました。');
    return {ok:true, songId:songId, parts:normalized};
  } catch (e) {
    const current = readTable_(sheet);
    current.rows.filter(function(r){ return id_(r.values[current.map.SongID]) === songId; }).sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(r){try{sheet.deleteRow(r.rowNumber);}catch(ignore){}});
    const restoredTable = readTable_(sheet);
    oldRows.forEach(function(old){
      const values = old.values.slice(0, restoredTable.header.length);
      while (values.length < restoredTable.header.length) values.push('');
      appendStyledRow_(sheet, values);
    });
    SpreadsheetApp.flush();
    throw e;
  }
}

