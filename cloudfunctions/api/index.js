const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  appointments: 'appointments',
  blockedSlots: 'blocked_slots',
  stylists: 'stylists',
  vacations: 'stylist_vacations',
  announcement: 'announcement',
  sessions: 'sessions'
};

const DEFAULT_STYLISTS = [
  {
    id: 1,
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

async function getAnnouncement() {
  const res = await db.collection(COLLECTIONS.announcement).doc('current').get().catch(() => null);
  return { text: res && res.data && res.data.text ? String(res.data.text).trim() : '' };
}

async function saveAnnouncement(payload) {
  await requireStylistSession(payload);
  const text = payload && payload.text != null ? String(payload.text).trim() : '';
  await db.collection(COLLECTIONS.announcement).doc('current').set({
    data: { text, updatedAt: db.serverDate() }
  });
  return { success: true };
}

async function getAdminAnnouncement(payload) {
  await requireStylistSession(payload);
  return getAnnouncement();
}

async function getStylists() {
  const nowMinutes = currentTotalMinutes();
  const workStartMinutes = 11 * 60;
  const workEndMinutes = 22 * 60 + 30;
  const isWorkTime = nowMinutes >= workStartMinutes && nowMinutes < workEndMinutes;
  const today = getTodayDate();
  const stylists = await getStylistsInternal();

  return stylists.map(s => {
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
  });
}

async function getSlots(payload) {
  const stylistId = payload.stylistId;
  const targetDate = payload.date || getTodayDate();
  const stylists = await getStylistsInternal();
  const stylist = stylists.find(s => String(s.id) === String(stylistId));
  if (!stylist || isYmdInVacation(stylist, targetDate)) return [];

  const today = getTodayDate();
  const nowMinutes = currentTotalMinutes();
  const apps = await getAll(COLLECTIONS.appointments, {
    stylistId: Number(stylistId),
    date: targetDate
  });
  const blocks = await getAll(COLLECTIONS.blockedSlots, {
    stylistId: Number(stylistId),
    date: targetDate
  });

  const slots = [];
  for (let h = 11; h <= 22; h += 1) {
    const minutes = h === 22 ? ['00'] : ['00', '30'];
    for (const m of minutes) {
      const startHour = h;
      const startMin = m;
      const endHour = m === '00' ? h : h + 1;
      const endMin = m === '00' ? '30' : '00';
      const startTime = `${pad2(startHour)}:${startMin}`;
      const endTime = `${pad2(endHour)}:${endMin}`;
      const timeRange = `${startTime}-${endTime}`;

      const isBooked = apps.some(app => app.time === timeRange && app.status !== 'cancelled' && app.status !== 'completed');
      const isBlocked = blocks.some(b => b.time === timeRange);
      const isDefaultMealTime = timeRange === '12:00-12:30' || timeRange === '18:00-18:30';
      const isUnlocked = blocks.some(b => b.time === `${timeRange}_UNLOCKED`);
      const isDefaultBlocked = isDefaultMealTime && !isBooked && !isBlocked && !isUnlocked;

      let isPast = false;
      if (targetDate === today) {
        const startTotal = startHour * 60 + Number(startMin);
        if (nowMinutes > startTotal + 10) isPast = true;
      } else if (targetDate < today) {
        isPast = true;
      }

      let status = 'available';
      if (isPast) status = 'past';
      else if (isBooked) status = 'booked';
      else if (isBlocked || isDefaultBlocked) status = 'blocked';

      slots.push({
        time: timeRange,
        available: !isBooked && !isBlocked && !isDefaultBlocked && !isPast,
        status
      });
    }
  }
  return slots;
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

  const today = getTodayDate();
  const targetDate = date || today;
  if (isYmdInVacation(stylist, targetDate)) {
    return { success: false, message: '该日期发型师休假，无法预约' };
  }

  const timeSlots = String(time).includes(',') ? String(time).split(',').map(t => t.trim()).filter(Boolean) : [String(time)];
  const nowMinutes = currentTotalMinutes();
  const existingForDay = await getAll(COLLECTIONS.appointments, { phone, date: targetDate });
  const validExisting = existingForDay.filter(app => app.status !== 'cancelled' && app.status !== 'completed');
  if (validExisting.length > 0) {
    return {
      success: false,
      message: `您在该日期已有预约（预约号：${validExisting[0].appId}），一个手机号一天内只能预约一次`
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

  for (const timeSlot of timeSlots) {
    if (targetDate === today) {
      const [startTime] = timeSlot.split('-');
      const [startHour, startMin] = startTime.split(':').map(Number);
      if (nowMinutes > startHour * 60 + startMin + 10) {
        return { success: false, message: '该时间段已过期，无法预约' };
      }
    }

    const isBooked = appsForStylist.some(app => app.time === timeSlot && app.status !== 'cancelled' && app.status !== 'completed');
    const isBlocked = blocks.some(b => b.time === timeSlot);
    const isDefaultMealTime = timeSlot === '12:00-12:30' || timeSlot === '18:00-18:30';
    const isUnlocked = blocks.some(b => b.time === `${timeSlot}_UNLOCKED`);
    const isDefaultBlocked = isDefaultMealTime && !isBooked && !isBlocked && !isUnlocked;
    if (isBooked || isBlocked || isDefaultBlocked) {
      return { success: false, message: `时间段 ${timeSlot} 已被预约或锁定` };
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
  const nowMinutes = currentTotalMinutes();
  const rows = await getAll(COLLECTIONS.appointments, { phone });
  const active = rows.filter(app => app.status !== 'cancelled' && app.status !== 'completed' && app.date >= today);
  const merged = mergeDyeAppointments(active);

  const appointments = merged.map(app => {
    const timeToCheck = app.originalTimeSlots && app.originalTimeSlots.length ? app.originalTimeSlots[0] : app.time;
    let canCancel = false;
    let reason = '';
    if (app.date === today) {
      const [startTime] = timeToCheck.split('-');
      const [startHour, startMin] = startTime.split(':').map(Number);
      canCancel = nowMinutes <= startHour * 60 + startMin;
      if (!canCancel) reason = '预约已开始，无法取消';
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
  const nowMinutes = currentTotalMinutes();
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

    if (app.date === today) {
      const [startTime] = app.time.split('-');
      const [startHour, startMin] = startTime.split(':').map(Number);
      if (nowMinutes > startHour * 60 + startMin) {
        errors.push(`预约号 ${app.appId} 已开始，无法取消`);
        continue;
      }
    } else if (app.date < today) {
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

const handlers = {
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
