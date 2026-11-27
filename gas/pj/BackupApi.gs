/**
 * 月次の自動バックアップ。Core DB と Log DB のスプレッドシートを、Drive の「バックアップ」フォルダへコピーする。
 * 呼び出し元：GitHub Actions の月次スケジュール（.github/workflows/backup.yml）。手動でも呼べる。
 * 同じ月にすでに作ってあれば何もしない（何度呼んでも1か月に1回分だけ）。古いバックアップは自動では消さない。
 */
function runMonthlyBackup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date();
    const month = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
    const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd_HHmm');
    const folder = backupMonthlyFolder_();
    const kinds = [
      {label: 'Core DB', id: UNIVERSE_CONFIG.CORE_DB_ID},
      {label: 'Log DB', id: UNIVERSE_CONFIG.LOG_DB_ID}
    ];
    const created = [];
    const skipped = [];
    kinds.forEach(function(kind) {
      const prefix = month + '-';
      const marker = '｜' + kind.label + '｜BACKUP｜月次自動';
      const existing = folder.getFiles();
      let found = false;
      while (existing.hasNext()) {
        const name = existing.next().getName();
        if (name.indexOf(prefix) === 0 && name.indexOf(marker) >= 0) { found = true; break; }
      }
      if (found) { skipped.push(kind.label); return; }
      const name = stamp + marker + '｜月次の保全（' + month + '）';
      const copy = DriveApp.getFileById(kind.id).makeCopy(name, folder);
      created.push({label: kind.label, name: name, fileId: copy.getId()});
    });
    return {ok: true, month: month, created: created, skipped: skipped, folder: folder.getName()};
  } finally {
    lock.releaseLock();
  }
}

// 「バックアップ」フォルダ > 「BMSG Universe」 > 「月次自動」（なければ作る）
function backupMonthlyFolder_() {
  const root = DriveApp.getFolderById(UNIVERSE_CONFIG.BACKUP_FOLDER_ID);
  return backupChildFolder_(backupChildFolder_(root, 'BMSG Universe'), '月次自動');
}

function backupChildFolder_(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
