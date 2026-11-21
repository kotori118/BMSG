// Imported from kotori118/BMSG-DB Profiles.gs by scripts/import-gas-sources.mjs. Edit the generator or re-import; do not hand-edit.
/** 入力_プロフィール → 02_Members / 05_Profiles */

const BU_PROFILE = Object.freeze({
  PROFILE_ID_ROW: 5,
  DATA_TYPE_ROW: 6,
  MULTI_ROW: 7,
  GROUP_ROW: 8,
  HEADER_ROW: 9,
  DATA_START_ROW: 10,
  FIXED_COLUMNS: 4,
  EMPTY_FIELD_COLUMNS: 3,
  PROFILE_SETTINGS_SHEET: 'ProfileSettings',
  PROFILE_SETTINGS_HEADERS: Object.freeze([
    'ProfileID', 'FieldName', 'DataType', 'IsMultiValue', 'DisplayGroup',
    'IsCompareTarget', 'DisplayOrder', 'IsActive'
  ]),
});

