const { DEFAULT_STORE_RULES, normalizeStoreRules } = require('./slot-config');

function parseTimeToMinutes(timeStr) {
  const parts = String(timeStr || '').trim().split(':');
  if (parts.length < 2) return 0;
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function storeRulesFromDoc(store) {
  return normalizeStoreRules(store || DEFAULT_STORE_RULES);
}

function isStoreWorkTime(store, totalMinutes) {
  const cfg = storeRulesFromDoc(store);
  const start = parseTimeToMinutes(cfg.workStart);
  const end = parseTimeToMinutes(cfg.workEnd);
  return totalMinutes >= start && totalMinutes < end;
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function cloudStorePayload(row) {
  if (!row) return null;
  const data = row.data || row;
  return {
    id: Number(data.id),
    name: data.name || '',
    code: data.code || '',
    status: data.status || 'active',
    address: data.address || '',
    phone: data.phone || '',
    latitude: data.latitude != null ? Number(data.latitude) : null,
    longitude: data.longitude != null ? Number(data.longitude) : null,
    workStart: data.workStart || DEFAULT_STORE_RULES.workStart,
    workEnd: data.workEnd || DEFAULT_STORE_RULES.workEnd,
    slotIntervalMinutes: Number(data.slotIntervalMinutes) || DEFAULT_STORE_RULES.slotIntervalMinutes,
    bookAheadDays: Number(data.bookAheadDays) || DEFAULT_STORE_RULES.bookAheadDays,
    defaultBlockedSlots: Array.isArray(data.defaultBlockedSlots)
      ? data.defaultBlockedSlots
      : DEFAULT_STORE_RULES.defaultBlockedSlots,
    dyeSlotCount: Number(data.dyeSlotCount) || DEFAULT_STORE_RULES.dyeSlotCount,
    announcementText: data.announcementText || '',
    smsCompanyName: data.smsCompanyName || '',
    miniProgramUrl: data.miniProgramUrl || ''
  };
}

module.exports = {
  DEFAULT_STORE_RULES,
  storeRulesFromDoc,
  isStoreWorkTime,
  normalizePhoneDigits,
  cloudStorePayload
};
