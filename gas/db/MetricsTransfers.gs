// Originally imported from kotori118/BMSG-DB MetricsTransfers.gs (2026-11-21). This repository is now the source: edit this file directly.

/**
 * New-song writer only: append a single metrics row instead of clearing and
 * rebuilding the entire two-header performance table.
 * Calling code already holds withSharedWriterLock_.
 * Returns the newly appended row for writer rollback, or null if present.
 */
function ensurePerformanceMetricRowForSong_(ss, songId) {
  const sheet=requireSheet_(ss,UNIVERSE_CONFIG.SHEETS.PERFORMANCE_METRICS);
  const id=id_(songId);
  if(!id)throw new Error('秒数行のSongIDがありません。');
  const last=sheet.getLastRow();
  const ids=last>=3?sheet.getRange(3,1,last-2,1).getValues():[];
  const found=[];
  ids.forEach(function(row,index){if(id_(row[0])===id)found.push(index+3);});
  if(found.length>1)throw new Error('10_PerformanceMetricsにSongID重複: '+id);
  if(found.length===1)return {created:false,row:found[0]};
  const cols=Math.max(13,sheet.getLastColumn());
  const vals=new Array(cols).fill('');
  vals[0]=id;
  const added=appendStyledRow_(sheet,vals);
  if(id_(sheet.getRange(added,1).getValue())!==id)throw new Error('秒数行の保存照合に失敗しました: '+id);
  return {created:true,row:added,sheet:sheet};
}

