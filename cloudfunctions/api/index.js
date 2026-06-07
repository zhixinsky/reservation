const cloud = require('wx-server-sdk');
const { buildSlotsForDate, validateSlotBookable, DEFAULT_STORE_RULES } = require('./slot-config');
const {
  storeRulesFromDoc,
  isStoreWorkTime,
  normalizePhoneDigits,
  cloudStorePayload
} = require('./store-helpers');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  appointments: 'appointments',
  blockedSlots: 'blocked_slots',
  stylists: 'stylists',
  vacations: 'stylist_vacations',
  announcement: 'announcement',
  sessions: 'sessions',
  stores: 'stores',
  phoneBlacklist: 'phone_blacklist'
};

const DEFAULT_STYLISTS = [
  {
    id: 1,
    storeId: 1,
    name: '店长',
    workStatus: 'working',
    username: 'tony',
    password: 'change-me',
    vacationRanges: []
  }
];

function shanghaiParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTodayDate() {
  const p = shanghaiParts();
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function currentTotalMinutes() {
  const p = shanghaiParts();
  return p.hour * 60 + p.minute;
}

function isYmdInVacation(stylist, ymd) {
  const ranges = Array.isArray(stylist && stylist.vacationRanges) ? stylist.vacationRanges : [];
  return ranges.some(r => r.vacationStartDate && r.vacationEndDate && ymd >= r.vacationStartDate && ymd <= r.vacationEndDate);
}

function resolveStylistStoreId(stylistId, stylists) {
  const stylist = stylists.find(s => String(s.id) === String(stylistId));
  return stylist && stylist.storeId != null ? Number(stylist.storeId) : 1;
}

function publicStylist(stylist) {
  const { password, ...pub } = stylist;
  return pub;
}

async function getAll(collection, where = {}) {
  const result = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const res = await db.collection(collection).where(where).skip(skip).limit(limit).get().catch(err => {
      console.warn(`[cloud-db] ${collection} query failed:`, err && err.message);
      return { data: [] };
    });
    result.push(...res.data);
    if (res.data.length < limit) break;
    skip += limit;
  }
  return result;
}

async function getStylistsInternal() {
  const stylists = await getAll(COLLECTIONS.stylists);
  const list = stylists.length ? stylists : DEFAULT_STYLISTS;
  const vacationRows = await getAll(COLLECTIONS.vacations);
  return list.map(s => {
    const dbRanges = vacationRows
      .filter(r => String(r.stylistId) === String(s.id))
      .map(r => ({
        vacationStartDate: r.vacationStartDate,
        vacationEndDate: r.vacationEndDate
      }))
      .filter(r => r.vacationStartDate && r.vacationEndDate);
    return {
      ...s,
      vacationRanges: dbRanges.length ? dbRanges : (Array.isArray(s.vacationRanges) ? s.vacationRanges : [])
    };
  });
}

async function getStoreById(storeId) {
  const id = Number(storeId) || 1;
  const res = await db.collection(COLLECTIONS.stores).where({ id }).limit(1).get().catch(() => ({ data: [] }));
  if (res.data && res.data[0]) return cloudStorePayload(res.data[0]);
  return {
    id,
    ...DEFAULT_STORE_RULES,
    name: '默认门店',
    status: 'active',
    announcementText: ''
  };
}

async function getActiveStores() {
  const rows = await getAll(COLLECTIONS.stores);
  const stores = rows.map(cloudStorePayload).filter(s => s.status === 'active');
  if (stores.length) {
    return stores.map(s => ({
      id: s.id,
      name: s.name,
      phone: s.phone || '',
      latitude: s.latitude,
      longitude: s.longitude,
      status: s.status
    }));
  }
  return [{
    id: 1,
    name: '默认门店',
    phone: '',
    latitude: null,
    longitude: null,
    status: 'active'
  }];
}

async function getStoreForStylist(stylist) {
  const storeId = stylist && stylist.storeId != null ? Number(stylist.storeId) : 1;
  return getStoreById(storeId);
}

async function findActiveBlacklist(phone, storeId) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const rows = await getAll(COLLECTIONS.phoneBlacklist);
  const now = Date.now();
  return rows.find((row) => {
    if (normalizePhoneDigits(row.phone) !== digits) return false;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) return false;
    if (row.storeId == null || row.storeId === '') return true;
    return Number(row.storeId) === Number(storeId);
  }) || null;
}

async function getStores() {
  return getActiveStores();
}

async function getAnnouncement(payload = {}) {
  const storeId = Number(payload.storeId) || 1;
  const store = await getStoreById(storeId);
  if (store.announcementText) {
    return { text: String(store.announcementText).trim() };
  }
  const res = await db.collection(COLLECTIONS.announcement).doc('current').get().catch(() => null);
  return { text: res && res.data && res.data.text ? String(res.data.text).trim() : '' };
}

async function saveAnnouncement(payload) {
  const session = await requireStylistSession(payload);
  const text = payload && payload.text != null ? String(payload.text).trim() : '';
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => Number(s.id) === Number(session.stylistId));
  const store = await getStoreForStylist(stylist);
  const existing = await db.collection(COLLECTIONS.stores).where({ id: store.id }).limit(1).get().catch(() => ({ data: [] }));
  if (existing.data && existing.data[0]) {
    await db.collection(COLLECTIONS.stores).doc(existing.data[0]._id).update({
      data: { announcementText: text, updatedAt: db.serverDate() }
    });
  } else {
    await db.collection(COLLECTIONS.stores).add({
      data: { ...store, announcementText: text, updatedAt: db.serverDate() }
    });
  }
  await db.collection(COLLECTIONS.announcement).doc('current').set({
    data: { text, updatedAt: db.serverDate() }
  }).catch(() => null);
  return { success: true };
}

async function getAdminAnnouncement(payload) {
  await requireStylistSession(payload);
  const session = await getSession(payload.sessionId);
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => Number(s.id) === Number(session.stylistId));
  const store = await getStoreForStylist(stylist);
  return getAnnouncement({ storeId: store.id });
}

async function getStylists(payload = {}) {
  const storeIdFilter = payload.storeId != null && payload.storeId !== ''
    ? Number(payload.storeId)
    : null;
  const nowMinutes = currentTotalMinutes();
  const today = getTodayDate();
  let stylists = await getStylistsInternal();
  if (storeIdFilter != null && !Number.isNaN(storeIdFilter)) {
    stylists = stylists.filter(s => Number(s.storeId || 1) === storeIdFilter);
  }

  return Promise.all(stylists.map(async (s) => {
    const store = await getStoreForStylist(s);
    const isWorkTime = isStoreWorkTime(store, nowMinutes);
    let displayStatus = 'working';
    let statusText = '';
    if (isYmdInVacation(s, today)) {
      displayStatus = 'resting';
      statusText = '休假中';
    } else if (s.workStatus === 'resting') {
      displayStatus = 'resting';
      statusText = '休息中';
    } else if (!isWorkTime) {
      displayStatus = 'resting';
      statusText = '休息中';
    }
    return publicStylist({
      ...s,
      displayStatus,
      statusText
    });
  }));
}

async function getSlots(payload) {
  const stylistId = payload.stylistId;
  const targetDate = payload.date || getTodayDate();
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => String(s.id) === String(stylistId));
  if (!stylist || isYmdInVacation(stylist, targetDate)) return [];

  const store = await getStoreForStylist(stylist);
  const today = getTodayDate();
  const p = shanghaiParts();
  const now = { getHours: () => p.hour, getMinutes: () => p.minute };
  const apps = await getAll(COLLECTIONS.appointments, {
    stylistId: Number(stylistId),
    date: targetDate
  });
  const blocks = await getAll(COLLECTIONS.blockedSlots, {
    stylistId: Number(stylistId),
    date: targetDate
  });

  return buildSlotsForDate({
    rules: storeRulesFromDoc(store),
    targetDate,
    today,
    now,
    stylistId: Number(stylistId),
    appointmentsFind: (cond) => apps.filter(a =>
      Number(a.stylistId) === Number(cond.stylistId) &&
      a.date === cond.date &&
      a.time === cond.time
    ),
    blockedFind: (cond) => blocks.filter(b =>
      Number(b.stylistId) === Number(cond.stylistId) &&
      b.date === cond.date &&
      b.time === cond.time
    )
  });
}

async function bookAppointment(payload) {
  const { stylistId, time, userName, date, phone, serviceType } = payload;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return { success: false, message: '请输入正确的手机号码' };
  }
  if (!stylistId || !time) {
    return { success: false, message: '请选择预约时间' };
  }

  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => String(s.id) === String(stylistId));
  if (!stylist) return { success: false, message: '发型师不存在' };
  if (stylist.workStatus === 'resting') return { success: false, message: '该发型师正在休息中，无法预约' };

  const store = await getStoreForStylist(stylist);
  const storeId = store.id || Number(stylist.storeId) || 1;
  const blacklistHit = await findActiveBlacklist(phone, storeId);
  if (blacklistHit) {
    const reason = blacklistHit.reason;
    return {
      success: false,
      message: reason ? `无法预约：${reason}` : '您的手机号已被限制预约，请联系门店'
    };
  }

  const today = getTodayDate();
  const targetDate = date || today;
  if (isYmdInVacation(stylist, targetDate)) {
    return { success: false, message: '该日期发型师休假，无法预约' };
  }

  const timeSlots = String(time).includes(',') ? String(time).split(',').map(t => t.trim()).filter(Boolean) : [String(time)];
  const existingForDay = await getAll(COLLECTIONS.appointments, { phone, date: targetDate });
  const validExisting = existingForDay.filter(app =>
    app.status !== 'cancelled' &&
    app.status !== 'completed' &&
    resolveStylistStoreId(app.stylistId, stylists) === Number(storeId)
  );
  if (validExisting.length > 0) {
    return {
      success: false,
      message: `您在该门店当日已有预约（预约号：${validExisting[0].appId}），同一门店一天内只能预约一次`
    };
  }

  const appsForStylist = await getAll(COLLECTIONS.appointments, {
    stylistId: Number(stylistId),
    date: targetDate
  });
  const blocks = await getAll(COLLECTIONS.blockedSlots, {
    stylistId: Number(stylistId),
    date: targetDate
  });
  const p = shanghaiParts();
  const now = { getHours: () => p.hour, getMinutes: () => p.minute };

  for (const timeSlot of timeSlots) {
    const check = validateSlotBookable({
      timeSlot,
      targetDate,
      today,
      now,
      stylistId: Number(stylistId),
      rules: storeRulesFromDoc(store),
      appointmentsFind: (cond) => appsForStylist.filter(a =>
        Number(a.stylistId) === Number(cond.stylistId) &&
        a.date === cond.date &&
        a.time === cond.time
      ),
      blockedFind: (cond) => blocks.filter(b =>
        Number(b.stylistId) === Number(cond.stylistId) &&
        b.date === cond.date &&
        b.time === cond.time
      )
    });
    if (!check.ok) {
      return { success: false, message: check.message };
    }
  }

  const appId = phone.slice(-4);
  const baseTime = Date.now();
  const batchId = `${baseTime}-${Math.random().toString(36).slice(2, 9)}`;
  await Promise.all(timeSlots.map((timeSlot, index) => {
    const id = `${baseTime}-${index}-${Math.random().toString(36).slice(2, 11)}`;
    return db.collection(COLLECTIONS.appointments).add({
      data: {
        id,
        appId,
        batchId,
        stylistId: Number(stylistId),
        date: targetDate,
        time: timeSlot,
        userName: userName || '',
        user: userName || '',
        phone,
        status: 'booked',
        createdAt: db.serverDate(),
        serviceType: serviceType || 'cut'
      }
    });
  }));

  return { success: true, appId };
}

function mergeDyeAppointments(userAppointments) {
  const merged = [];
  const processed = new Set();
  const sorted = [...userAppointments].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  sorted.forEach(app => {
    if (processed.has(app.id)) return;
    if (app.serviceType === 'dye') {
      const related = sorted.filter(a =>
        !processed.has(a.id) &&
        a.appId === app.appId &&
        a.phone === app.phone &&
        a.date === app.date &&
        a.serviceType === 'dye' &&
        a.status === app.status &&
        (a.batchId === app.batchId || !app.batchId)
      );
      if (related.length > 1) {
        related.sort((a, b) => a.time.localeCompare(b.time));
        const [firstStart] = related[0].time.split('-');
        const [, lastEnd] = related[related.length - 1].time.split('-');
        merged.push({
          ...app,
          time: `${firstStart}-${lastEnd}`,
          originalTimeSlots: related.map(a => a.time),
          originalIds: related.map(a => a.id)
        });
        related.forEach(a => processed.add(a.id));
      } else {
        merged.push({ ...app, originalIds: [app.id] });
        processed.add(app.id);
      }
    } else {
      merged.push({ ...app, originalIds: [app.id] });
      processed.add(app.id);
    }
  });
  return merged;
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  const res = await db.collection(COLLECTIONS.sessions).where({ sessionId }).limit(1).get().catch(() => ({ data: [] }));
  const session = res.data[0];
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

async function requireStylistSession(payload) {
  const session = await getSession(payload && payload.sessionId);
  if (!session || session.role !== 'stylist') {
    const err = new Error('未登录');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return session;
}

async function adminLogin(payload) {
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '').trim();
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => s.username === username && s.password === password);
  if (!stylist) return { success: false, message: '用户名或密码错误' };

  const sessionId = `stylist_${stylist.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection(COLLECTIONS.sessions).add({
    data: {
      sessionId,
      role: 'stylist',
      stylistId: Number(stylist.id),
      username: stylist.name,
      createdAt: db.serverDate(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  return {
    success: true,
    sessionId,
    role: 'stylist',
    stylistId: Number(stylist.id),
    stylistName: stylist.name
  };
}

async function verifySession(payload) {
  const session = await getSession(payload.sessionId);
  if (!session) return { valid: false };
  return {
    valid: true,
    role: session.role,
    stylistId: session.stylistId,
    username: session.username
  };
}

async function getAdminAppointments(payload) {
  const session = await requireStylistSession(payload);
  const allApps = await getAll(COLLECTIONS.appointments, { stylistId: Number(session.stylistId) });
  const merged = mergeDyeAppointments(allApps);
  const byPhone = {};
  allApps.forEach(app => {
    if (!byPhone[app.phone]) byPhone[app.phone] = [];
    byPhone[app.phone].push(app);
  });

  return merged.map(app => {
    const originalIds = app.originalIds || [app.id];
    const completedBefore = (byPhone[app.phone] || []).some(a => {
      if (originalIds.includes(a.id)) return false;
      return a.status === 'completed';
    });
    return {
      id: originalIds[0],
      appId: app.appId,
      stylistId: app.stylistId,
      date: app.date,
      time: app.time,
      phone: app.phone,
      status: app.status,
      serviceType: app.serviceType || 'cut',
      createdAt: app.createdAt,
      originalIds,
      originalTimeSlots: app.originalTimeSlots,
      isNewUser: !completedBefore
    };
  }).sort((a, b) => {
    const order = { booked: 0, pending: 0, completed: 1, cancelled: 2 };
    const ao = order[a.status] == null ? 3 : order[a.status];
    const bo = order[b.status] == null ? 3 : order[b.status];
    if (ao !== bo) return ao - bo;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return String(a.time).localeCompare(String(b.time));
  });
}

async function updateAppointmentStatusById(id, status) {
  const res = await db.collection(COLLECTIONS.appointments).where({ id }).limit(1).get();
  const row = res.data[0];
  if (!row) return false;
  await db.collection(COLLECTIONS.appointments).doc(row._id).update({
    data: { status, updatedAt: db.serverDate() }
  });
  return true;
}

async function findAppointmentByBusinessId(id) {
  const res = await db.collection(COLLECTIONS.appointments).where({ id }).limit(1).get();
  return res.data[0] || null;
}

async function getRelatedActiveDyeApps(app) {
  const rows = await getAll(COLLECTIONS.appointments, {
    appId: app.appId,
    phone: app.phone,
    date: app.date,
    serviceType: 'dye'
  });
  return rows.filter(a => a.status !== 'cancelled' && a.status !== 'completed' && (!app.batchId || a.batchId === app.batchId));
}

async function adminCancelAppointment(payload) {
  const session = await requireStylistSession(payload);
  const app = await findAppointmentByBusinessId(payload.appointmentId);
  if (!app) return { success: false, message: '预约不存在' };
  if (Number(app.stylistId) !== Number(session.stylistId)) return { success: false, message: '无权取消此预约' };
  if (app.status === 'cancelled') return { success: false, message: '该预约已取消' };
  if (app.status === 'completed') return { success: false, message: '该预约已完成' };

  const related = app.serviceType === 'dye' ? await getRelatedActiveDyeApps(app) : [app];
  const targets = related.length ? related : [app];
  await Promise.all(targets.map(a => updateAppointmentStatusById(a.id, 'cancelled')));
  return { success: true };
}

async function completeAppointment(payload) {
  const session = await requireStylistSession(payload);
  const app = await findAppointmentByBusinessId(payload.appointmentId);
  if (!app) return { success: false, message: '预约不存在' };
  if (Number(app.stylistId) !== Number(session.stylistId)) return { success: false, message: '无权操作此预约' };
  if (app.status === 'cancelled') return { success: false, message: '该预约已取消' };
  if (app.status === 'completed') return { success: false, message: '该预约已完成' };

  const related = app.serviceType === 'dye' ? await getRelatedActiveDyeApps(app) : [app];
  const targets = related.length ? related : [app];
  await Promise.all(targets.map(a => updateAppointmentStatusById(a.id, 'completed')));
  return { success: true };
}

async function getAdminBlockedSlots(payload) {
  const session = await requireStylistSession(payload);
  if (Number(payload.stylistId) !== Number(session.stylistId)) return [];
  return getAll(COLLECTIONS.blockedSlots, {
    stylistId: Number(payload.stylistId),
    date: payload.date
  });
}

async function removeBlockedSlot(stylistId, date, time) {
  const rows = await getAll(COLLECTIONS.blockedSlots, { stylistId: Number(stylistId), date, time });
  await Promise.all(rows.map(row => db.collection(COLLECTIONS.blockedSlots).doc(row._id).remove()));
}

async function createBlockedSlot(stylistId, date, time) {
  await removeBlockedSlot(stylistId, date, time);
  await db.collection(COLLECTIONS.blockedSlots).add({
    data: {
      stylistId: Number(stylistId),
      date,
      time,
      createdAt: db.serverDate()
    }
  });
}

async function adminBlockSlot(payload) {
  const session = await requireStylistSession(payload);
  if (Number(payload.stylistId) !== Number(session.stylistId)) return { success: false, message: '无权操作此时间段' };
  const targetDate = payload.date || getTodayDate();
  const time = payload.time;
  const isDefaultMealTime = time === '12:00-12:30' || time === '18:00-18:30';
  if (isDefaultMealTime) {
    await removeBlockedSlot(payload.stylistId, targetDate, `${time}_UNLOCKED`);
  } else {
    await createBlockedSlot(payload.stylistId, targetDate, time);
  }
  return { success: true };
}

async function adminUnblockSlot(payload) {
  const session = await requireStylistSession(payload);
  if (Number(payload.stylistId) !== Number(session.stylistId)) return { success: false, message: '无权操作此时间段' };
  const targetDate = payload.date || getTodayDate();
  const time = payload.time;
  const isDefaultMealTime = time === '12:00-12:30' || time === '18:00-18:30';
  if (isDefaultMealTime) {
    await createBlockedSlot(payload.stylistId, targetDate, `${time}_UNLOCKED`);
  } else {
    await removeBlockedSlot(payload.stylistId, targetDate, time);
  }
  return { success: true };
}

async function getStylistInfo(payload) {
  const session = await requireStylistSession(payload);
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => Number(s.id) === Number(session.stylistId));
  if (!stylist) return { success: false, message: '发型师不存在' };
  return publicStylist(stylist);
}

function normalizeVacationRanges(payload) {
  if (!Array.isArray(payload.vacationRanges)) return [];
  return payload.vacationRanges
    .map(r => ({
      vacationStartDate: String(r.vacationStartDate || '').trim(),
      vacationEndDate: String(r.vacationEndDate || '').trim()
    }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.vacationStartDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.vacationEndDate));
}

async function saveStylistVacation(payload) {
  const session = await requireStylistSession(payload);
  const ranges = normalizeVacationRanges(payload);
  for (const r of ranges) {
    if (r.vacationStartDate > r.vacationEndDate) {
      return { success: false, message: '开始日期不能晚于结束日期' };
    }
    const conflicts = await getAll(COLLECTIONS.appointments, {
      stylistId: Number(session.stylistId)
    });
    const hasConflict = conflicts.some(app => app.status !== 'cancelled' && app.status !== 'completed' && app.date >= r.vacationStartDate && app.date <= r.vacationEndDate);
    if (hasConflict) {
      return { success: false, message: '休假日期内已有预约，请先取消这些预约后再设置休假。' };
    }
  }

  const existing = await getAll(COLLECTIONS.vacations, { stylistId: Number(session.stylistId) });
  await Promise.all(existing.map(row => db.collection(COLLECTIONS.vacations).doc(row._id).remove()));
  await Promise.all(ranges.map(r => db.collection(COLLECTIONS.vacations).add({
    data: {
      stylistId: Number(session.stylistId),
      vacationStartDate: r.vacationStartDate,
      vacationEndDate: r.vacationEndDate,
      updatedAt: db.serverDate()
    }
  })));
  return { success: true, vacationRanges: ranges };
}

async function queryAppointments(payload) {
  const { phone } = payload;
  if (!phone) return { success: false, message: '请输入手机号' };
  if (!/^1[3-9]\d{9}$/.test(phone)) return { success: false, message: '请输入正确的手机号码' };

  const today = getTodayDate();
  const rows = await getAll(COLLECTIONS.appointments, { phone });
  const active = rows.filter(app => app.status !== 'cancelled' && app.status !== 'completed' && app.date >= today);
  const merged = mergeDyeAppointments(active);

  const appointments = merged.map(app => {
    let canCancel = false;
    let reason = '';
    if (app.date === today) {
      // 当天预约即使已经到点也允许用户取消。
      canCancel = true;
    } else if (app.date > today) {
      canCancel = true;
    } else {
      reason = '预约已过期，无法取消';
    }

    return {
      id: app.originalIds && app.originalIds.length ? app.originalIds[0] : app.id,
      appId: app.appId,
      date: app.date,
      time: app.time,
      serviceType: app.serviceType,
      status: app.status,
      stylistId: app.stylistId,
      canCancel,
      reason,
      originalIds: app.originalIds || [app.id]
    };
  });

  return { success: true, appointments };
}

async function getDayQueue(payload) {
  const { date, stylistId } = payload;
  if (!date || !stylistId) return [];

  const rows = await getAll(COLLECTIONS.appointments, {
    stylistId: Number(stylistId),
    date
  });
  const dayApps = rows.filter(a => a.status !== 'cancelled' && a.status !== 'completed');
  const merged = mergeDyeAppointments(dayApps).map(app => ({
    time: app.time,
    serviceType: app.serviceType
  }));
  merged.sort((a, b) => a.time.localeCompare(b.time));
  return merged;
}

async function cancelAppointments(payload) {
  const { appointmentIds } = payload;
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    return { success: false, message: '请选择要取消的预约' };
  }

  const today = getTodayDate();
  let cancelledCount = 0;
  const errors = [];
  const processed = new Set();

  for (const appointmentId of appointmentIds) {
    if (processed.has(appointmentId)) continue;
    const found = await db.collection(COLLECTIONS.appointments).where({ id: appointmentId }).limit(1).get();
    const app = found.data[0];
    if (!app) {
      errors.push(`预约ID ${appointmentId} 不存在`);
      continue;
    }
    if (app.status === 'cancelled') {
      errors.push(`预约号 ${app.appId} 已取消`);
      continue;
    }
    if (app.status === 'completed') {
      errors.push(`预约号 ${app.appId} 已完成`);
      continue;
    }

    if (app.date < today) {
      errors.push(`预约号 ${app.appId} 已过期，无法取消`);
      continue;
    }

    let relatedApps = [app];
    if (app.serviceType === 'dye') {
      const relatedRows = await getAll(COLLECTIONS.appointments, {
        appId: app.appId,
        phone: app.phone,
        date: app.date,
        serviceType: 'dye'
      });
      relatedApps = relatedRows.filter(a => a.status !== 'cancelled' && a.status !== 'completed' && (!app.batchId || a.batchId === app.batchId));
      if (!relatedApps.some(a => a.id === app.id)) relatedApps.push(app);
    }

    for (const related of relatedApps) {
      if (processed.has(related.id)) continue;
      const row = await db.collection(COLLECTIONS.appointments).where({ id: related.id }).limit(1).get();
      if (row.data[0] && row.data[0]._id) {
        await db.collection(COLLECTIONS.appointments).doc(row.data[0]._id).update({
          data: { status: 'cancelled', cancelledAt: db.serverDate() }
        });
        processed.add(related.id);
        cancelledCount += 1;
      }
    }
  }

  if (cancelledCount === 0) {
    return {
      success: false,
      message: errors.length ? errors.join('; ') : '没有可取消的预约'
    };
  }

  return {
    success: true,
    cancelledCount,
    message: errors.length ? `部分取消成功: ${errors.join('; ')}` : undefined
  };
}

async function upsertCollectionDoc(collection, matchField, matchValue, data) {
  const res = await db.collection(collection).where({ [matchField]: matchValue }).limit(1).get().catch(() => ({ data: [] }));
  if (res.data && res.data[0]) {
    await db.collection(collection).doc(res.data[0]._id).update({
      data: { ...data, updatedAt: db.serverDate() }
    });
    return 'updated';
  }
  await db.collection(collection).add({
    data: { ...data, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  });
  return 'created';
}

async function syncStores(payload = {}) {
  const secret = process.env.PLATFORM_SYNC_SECRET || '';
  if (!secret || payload.secret !== secret) {
    return { success: false, message: '同步密钥无效' };
  }
  const stores = Array.isArray(payload.stores) ? payload.stores : [];
  const blacklist = Array.isArray(payload.blacklist) ? payload.blacklist : [];
  let storeCount = 0;
  let blacklistCount = 0;

  for (const store of stores) {
    const normalized = cloudStorePayload(store);
    if (!normalized || !normalized.id) continue;
    await upsertCollectionDoc(COLLECTIONS.stores, 'id', normalized.id, normalized);
    storeCount += 1;
  }

  for (const row of blacklist) {
    const phone = normalizePhoneDigits(row.phone);
    if (!phone) continue;
    const storeId = row.storeId == null || row.storeId === '' ? null : Number(row.storeId);
    const key = storeId == null ? `global:${phone}` : `${storeId}:${phone}`;
    await upsertCollectionDoc(COLLECTIONS.phoneBlacklist, 'syncKey', key, {
      syncKey: key,
      storeId,
      phone,
      reason: row.reason || '',
      createdBy: row.createdBy || '',
      expiresAt: row.expiresAt || null
    });
    blacklistCount += 1;
  }

  return {
    success: true,
    storeCount,
    blacklistCount,
    message: `已同步 ${storeCount} 家门店、${blacklistCount} 条黑名单`
  };
}

function assertPlatformSecret(payload) {
  const secret = process.env.PLATFORM_SYNC_SECRET;
  if (!secret || payload.secret !== secret) {
    throw new Error('同步密钥无效');
  }
}

async function uploadStylistAvatar(payload) {
  assertPlatformSecret(payload);
  const stylistId = Number(payload.stylistId);
  const base64 = String(payload.imageBase64 || '').trim();
  if (!stylistId || !base64) {
    return { success: false, message: '参数不完整' };
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return { success: false, message: '图片数据为空' };
  const cloudPath = `avatar/stylist-${stylistId}.jpg`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  });
  const fileID = uploadRes.fileID;
  let previewUrl = fileID;
  try {
    const temp = await cloud.getTempFileURL({ fileList: [fileID] });
    const row = temp && temp.fileList && temp.fileList[0];
    if (row && row.tempFileURL) previewUrl = row.tempFileURL;
  } catch (_) { /* ignore */ }
  return { success: true, photo: fileID, previewUrl };
}

async function getFilePreviewUrl(payload) {
  assertPlatformSecret(payload);
  const fileID = String(payload.fileID || '').trim();
  if (!fileID) return { success: false, message: '缺少 fileID' };
  const temp = await cloud.getTempFileURL({ fileList: [fileID] });
  const row = temp && temp.fileList && temp.fileList[0];
  if (!row || !row.tempFileURL) {
    return { success: false, message: '无法获取预览地址' };
  }
  return { success: true, previewUrl: row.tempFileURL };
}

const handlers = {
  getStores,
  syncStores,
  uploadStylistAvatar,
  getFilePreviewUrl,
  getAnnouncement,
  saveAnnouncement,
  getStylists,
  getSlots,
  bookAppointment,
  queryAppointments,
  getDayQueue,
  cancelAppointments,
  adminLogin,
  verifySession,
  getAdminAppointments,
  adminCancelAppointment,
  completeAppointment,
  getAdminBlockedSlots,
  adminBlockSlot,
  adminUnblockSlot,
  getStylistInfo,
  saveStylistVacation,
  getAdminAnnouncement
};

exports.main = async (event) => {
  const action = event && event.action;
  const payload = (event && event.payload) || {};
  if (!handlers[action]) {
    return { success: false, message: `未知操作: ${action || ''}` };
  }
  try {
    return await handlers[action](payload);
  } catch (err) {
    console.error(`[api:${action}]`, err);
    if (err.code === 'UNAUTHORIZED') {
      return { success: false, valid: false, message: '未登录' };
    }
    return { success: false, message: err.message || '服务异常' };
  }
};
