// Originally imported from kotori118/BMSG-DB Lyrics.gs (2026-11-21). This repository is now the source: edit this file directly.
/**
 * BMSG Universe 本体GAS
 * Lyrics.gs v1.0 - 歌詞自由入力解析・確認登録
 *
 * 入力_歌詞 の貼り付け素材を解析し、
 * 同じシート内の解析ステータス／解析結果へ出力する。
 *
 * プレビュー後の確定操作で06_Songs / 08_LyricsPartsへ保存する。
 */

const BU_LYRICS = {
  SHEETS: {
    INPUT: '入力_歌詞',
    GROUPS: '01_Groups',
    MEMBERS: '02_Members',
    GUESTS: '03_Guests',
    SONGS: '06_Songs',
  },
  TITLE_CELL: 'B2',
  GROUP_CELL: 'D2',
  DATE_CELL: 'F2',
  INPUT_CELL: 'B5',
  STATUS_CELL: 'B18',
  RESULT_CELL: 'B21',
  MAX_PREVIEW_LYRICS: 52,
};

function parseLyricsParts_(bodyLines, singers, errors) {
  const parts = [];
  let current = null;

  bodyLines.forEach((rawLine, index) => {
    const singer = resolveSingerLine_(rawLine, singers);

    if (singer) {
      if (current) {
        finalizeLyricsPart_(current, parts, errors);
      }

      current = {
        singerDisplay: singer.displayNames.join(', '),
        mainSingerIds: singer.ids,
        rawLyricsLines: [],
        bodyLineNumber: index + 1,
      };
      return;
    }

    if (!current) {
      // 最初のSinger前はbodyに来ない想定。
      // 万一あっても推測で扱わない。
      if (cleanLyricsText_(rawLine) !== '') {
        errors.push(
          `歌唱者を確定する前に未分類行があります: ${cleanLyricsText_(rawLine)}`
        );
      }
      return;
    }

    current.rawLyricsLines.push(rawLine);
  });

  if (current) {
    finalizeLyricsPart_(current, parts, errors);
  }

  return parts;
}

function finalizeLyricsPart_(current, parts, errors) {
  const lyrics = trimBoundaryBlankLines_(current.rawLyricsLines).join('\n');

  parts.push({
    partOrder: parts.length + 1,
    mainSingerIds: current.mainSingerIds,
    singerDisplay: current.singerDisplay,
    lyrics,
  });
}

function normalizeSingerLabel_(rawLine) {
  let text = cleanLyricsText_(rawLine);
  if (!text) return { text: '', wrapped: false, wrapper: '' };

  const wrappers = [
    ['[', ']'], ['【', '】'], ['(', ')'], ['（', '）'],
    ['「', '」'], ['『', '』'], ['｢', '｣'], ['〈', '〉'],
    ['《', '》'], ['＜', '＞'], ['<', '>'], ['“', '”'], ['\"', '\"']
  ];

  let wrapped = false;
  let wrapper = '';
  let changed = true;
  while (changed && text) {
    changed = false;
    for (const pair of wrappers) {
      if (text.startsWith(pair[0]) && text.endsWith(pair[1]) && text.length > pair[0].length + pair[1].length) {
        wrapper = pair[0] + pair[1];
        text = cleanLyricsText_(text.slice(pair[0].length, text.length - pair[1].length));
        wrapped = true;
        changed = true;
        break;
      }
    }
  }

  text = text.replace(/[：:]\s*$/, '').trim();
  return { text, wrapped, wrapper };
}

function splitSingerTokens_(text) {
  return cleanLyricsText_(text)
    .split(/\s*(?:、|,|，|､|＆|&|＋|\+|／|\/|・|×)\s*/)
    .map(cleanLyricsText_)
    .filter(Boolean);
}

function resolveSingerLine_(rawLine, singers) {
  const label = normalizeSingerLabel_(rawLine);
  const line = label.text;
  if (!line) return null;

  const direct = singers.byName[line] || [];
  if (direct.length === 1) {
    return { ids: [String(direct[0].id)], displayNames: [direct[0].name] };
  }
  if (direct.length > 1) return null;

  const tokens = splitSingerTokens_(line);
  if (tokens.length < 2) return null;

  const resolved = [];
  for (const token of tokens) {
    const matches = singers.byName[token] || [];
    if (matches.length !== 1) return null;
    resolved.push(matches[0]);
  }

  return {
    ids: resolved.map(x => String(x.id)),
    displayNames: resolved.map(x => x.name),
  };
}
function looksLikeUnknownSingerName_(name) {
  const text = cleanLyricsText_(name);
  if (!text || text.length > 48) return false;
  if (parseLyricsDate_(text)) return false;
  if (/[!?！？。]/.test(text)) return false;
  if (/\b(?:the|and|but|cause|because|when|what|your|you|me|my|we|our|is|are|to|of|in|on|for|with)\b/i.test(text) && /\s/.test(text)) return false;
  if (!/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž一-龠ぁ-んァ-ヶ々ー・.'’\- ]+$/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;

  if (/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž.'’\- ]+$/.test(text) && words.length >= 2) {
    const nameLike = words.every(w => /^[A-Z0-9À-ÖØ-Þ]/.test(w) || /^[A-Z0-9.'’\-]+$/.test(w));
    if (!nameLike) return false;
  }

  return true;
}

function getUnknownSingerTokensFromLine_(rawLine, singers, context) {
  const label = normalizeSingerLabel_(rawLine);
  if (!label.text || resolveSingerLine_(rawLine, singers)) return [];

  const tokens = splitSingerTokens_(label.text);
  if (!tokens.length) return [];
  const knownCount = tokens.filter(token => (singers.byName[token] || []).length === 1).length;
  const unknown = tokens.filter(token => {
    const matches = singers.byName[token] || [];
    return matches.length === 0 && looksLikeUnknownSingerName_(token);
  });
  if (!unknown.length) return [];

  if (knownCount > 0) return unknown;
  if (label.wrapped && label.wrapper !== '()' && label.wrapper !== '（）') return unknown;

  const prevBlank = !context || context.prevBlank;
  const nextHasText = !context || context.nextHasText;
  const separatedLikeHeader = prevBlank && nextHasText;
  if (separatedLikeHeader && looksLikeUnknownSingerName_(label.text)) return unknown;

  // 丸括弧は歌詞にも頻出するため、独立ヘッダーらしい場合だけ候補にする。
  if ((label.wrapper === '()' || label.wrapper === '（）') && separatedLikeHeader && looksLikeUnknownSingerName_(label.text)) {
    return unknown;
  }

  return [];
}

function findUnknownLyricsGuestCandidates_(raw, masters) {
  const lines = normalizeLineEndings_(raw).split('\n');
  const seen = {};
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const context = {
      prevBlank: i === 0 || cleanLyricsText_(lines[i - 1]) === '',
      nextHasText: i + 1 < lines.length && cleanLyricsText_(lines[i + 1]) !== '',
    };
    getUnknownSingerTokensFromLine_(lines[i], masters.singers, context).forEach(name => {
      if (seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
  }
  return out;
}

function loadLyricsSingers_(ss) {
  const byName = {};

  const memberSheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.MEMBERS);
  const memberValues = memberSheet.getDataRange().getDisplayValues();
  const mh = memberValues[0];

  const memberIdCol = mh.indexOf('MemberID');
  const memberNameCol = mh.indexOf('DisplayName');

  memberValues.slice(1).forEach(row => {
    const id = cleanLyricsText_(row[memberIdCol]);
    const name = cleanLyricsText_(row[memberNameCol]);
    if (!id || !name) return;
    addSingerName_(byName, name, { id, name, type: 'MEMBER' });
  });

  const guestSheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.GUESTS);
  const guestValues = guestSheet.getDataRange().getDisplayValues();
  const gh = guestValues[0];

  const guestIdCol = gh.indexOf('GuestID');
  const guestNameCol = gh.indexOf('DisplayName');

  guestValues.slice(1).forEach(row => {
    const id = cleanLyricsText_(row[guestIdCol]);
    const name = cleanLyricsText_(row[guestNameCol]);
    if (!id || !name) return;
    addSingerName_(byName, name, { id, name, type: 'GUEST' });
  });

  // Universeで確定済みの疑似Singer。
  addSingerName_(byName, 'ALL', { id: '99', name: 'ALL', type: 'PSEUDO' });
  addSingerName_(byName, 'その他', { id: '109', name: 'その他', type: 'PSEUDO' });

  return { byName };
}

function addSingerName_(byName, name, singer) {
  if (!byName[name]) byName[name] = [];
  byName[name].push(singer);
}

function parseLyricsDate_(value) {
  const text = cleanLyricsText_(value);
  if (!text) return '';

  let m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return formatYmd_(m[1], m[2], m[3]);

  m = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return formatYmd_(m[1], m[2], m[3]);

  return '';
}

function formatYmd_(y, m, d) {
  const yy = String(Number(y)).padStart(4, '0');
  const mm = String(Number(m)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function trimBoundaryBlankLines_(lines) {
  const out = lines.slice();

  while (out.length && cleanLyricsText_(out[0]) === '') out.shift();
  while (out.length && cleanLyricsText_(out[out.length - 1]) === '') out.pop();

  return out;
}

function normalizeLineEndings_(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function cleanLyricsText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function requireLyricsSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`必要なシート「${name}」がありません。`);
  return sheet;
}

