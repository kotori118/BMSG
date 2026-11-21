// Imported from kotori118/BMSG-PJ ManagementPageApi.gs by scripts/import-gas-sources.mjs. Edit the generator or re-import; do not hand-edit.
/** All Universe users share management; readiness is read-only. */
function getManagementPageAccess(userId) {
  const uid=catalogManagementSiteAccess_(userId);
  const schema=getCatalogManagementReadinessForUniverse({userId:uid});
  return {registered:true,catalog:true,initialSetupRequired:!schema.ready};
}
