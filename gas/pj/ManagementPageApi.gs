// Originally imported from kotori118/BMSG-PJ ManagementPageApi.gs (2026-11-21). This repository is now the source: edit this file directly.
/** All Universe users share management; readiness is read-only. */
function getManagementPageAccess(userId) {
  const uid=catalogManagementSiteAccess_(userId);
  const schema=getCatalogManagementReadinessForUniverse({userId:uid});
  return {registered:true,catalog:true,initialSetupRequired:!schema.ready};
}
