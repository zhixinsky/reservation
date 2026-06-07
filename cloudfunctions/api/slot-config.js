/**
 * 门店预约时段规则（从 stores 配置生成，替代硬编码）
 */

const DEFAULT_STORE_RULES = {
    workStart: '11:00',
    workEnd: '22:30',
    slotIntervalMinutes: 30,
    bookAheadDays: 3,
    defaultBlockedSlots: ['12:00-12:30', '18:00-18:30'],
    dyeSlotCount: 4
};

function pad2(n) {
    return String(n).padStart(2, '0');
}

function parseTimeToMinutes(timeStr) {
    const parts = String(timeStr || '').trim().split(':');
    if (parts.length < 2) return 0;
    return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${pad2(h)}:${pad2(m)}`;
}

function normalizeStoreRules(store) {
    const base = store || {};
    let defaultBlocked = DEFAULT_STORE_RULES.defaultBlockedSlots;
    if (base.defaultBlockedSlots) {
        if (Array.isArray(base.defaultBlockedSlots)) {
            defaultBlocked = base.defaultBlockedSlots;
        } else if (typeof base.defaultBlockedSlots === 'string') {
            try {
                const parsed = JSON.parse(base.defaultBlockedSlots);
                if (Array.isArray(parsed)) defaultBlocked = parsed;
            } catch (_) {
                defaultBlocked = DEFAULT_STORE_RULES.defaultBlockedSlots;
            }
        }
    }
    return {
        workStart: base.workStart || DEFAULT_STORE_RULES.workStart,
        workEnd: base.workEnd || DEFAULT_STORE_RULES.workEnd,
        slotIntervalMinutes: Number(base.slotIntervalMinutes) || DEFAULT_STORE_RULES.slotIntervalMinutes,
        bookAheadDays: Number(base.bookAheadDays) || DEFAULT_STORE_RULES.bookAheadDays,
        defaultBlockedSlots: defaultBlocked.filter(Boolean),
        dyeSlotCount: Number(base.dyeSlotCount) || DEFAULT_STORE_RULES.dyeSlotCount
    };
}

/** 生成某日所有时段字符串，如 11:00-11:30 */
function generateTimeRanges(rules) {
    const cfg = normalizeStoreRules(rules);
    const interval = Math.max(15, cfg.slotIntervalMinutes);
    const start = parseTimeToMinutes(cfg.workStart);
    const end = parseTimeToMinutes(cfg.workEnd);
    const ranges = [];

    for (let cursor = start; cursor < end; cursor += interval) {
        const next = Math.min(cursor + interval, end);
        if (next <= cursor) break;
        ranges.push(`${minutesToTime(cursor)}-${minutesToTime(next)}`);
    }
    return ranges;
}

function isDefaultBlocked(timeRange, rules, isBooked, isBlocked, isUnlocked) {
    const cfg = normalizeStoreRules(rules);
    const inDefault = cfg.defaultBlockedSlots.includes(timeRange);
    return inDefault && !isBooked && !isBlocked && !isUnlocked;
}

function evaluateSlotState({
    timeRange,
    startHour,
    startMin,
    targetDate,
    today,
    currentHour,
    currentMinute,
    isBooked,
    isBlocked,
    isUnlocked,
    rules
}) {
    const isDefaultBlockedSlot = isDefaultBlocked(timeRange, rules, isBooked, isBlocked, isUnlocked);
    let isPast = false;
    if (targetDate === today) {
        const startTotal = startHour * 60 + Number(startMin);
        const currentTotal = currentHour * 60 + currentMinute;
        if (currentTotal > startTotal + 10) isPast = true;
    } else if (targetDate < today) {
        isPast = true;
    }

    let status = 'available';
    if (isPast) status = 'past';
    else if (isBooked) status = 'booked';
    else if (isBlocked || isDefaultBlockedSlot) status = 'blocked';

    return {
        time: timeRange,
        available: !isBooked && !isBlocked && !isDefaultBlockedSlot && !isPast,
        status
    };
}

function buildSlotsForDate({
    rules,
    targetDate,
    today,
    now = new Date(),
    stylistId,
    appointmentsFind,
    blockedFind
}) {
    const ranges = generateTimeRanges(rules);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const slots = [];

    ranges.forEach(timeRange => {
        const [startTime] = timeRange.split('-');
        const [startHour, startMin] = startTime.split(':');

        const bookedApps = appointmentsFind({
            stylistId,
            date: targetDate,
            time: timeRange
        }).filter(app => app.status !== 'cancelled' && app.status !== 'completed');
        const isBooked = bookedApps.length > 0;

        const blocked = blockedFind({ stylistId, date: targetDate, time: timeRange });
        const isBlocked = blocked.length > 0;
        const unlocked = blockedFind({ stylistId, date: targetDate, time: `${timeRange}_UNLOCKED` });
        const isUnlocked = unlocked.length > 0;

        slots.push(evaluateSlotState({
            timeRange,
            startHour: Number(startHour),
            startMin: Number(startMin),
            targetDate,
            today,
            currentHour,
            currentMinute,
            isBooked,
            isBlocked,
            isUnlocked,
            rules
        }));
    });

    return slots;
}

function validateSlotBookable({ timeSlot, targetDate, today, now, stylistId, rules, appointmentsFind, blockedFind }) {
    if (targetDate === today) {
        const [startTime] = timeSlot.split('-');
        const [startHour, startMin] = startTime.split(':').map(Number);
        const currentTotal = now.getHours() * 60 + now.getMinutes();
        const startTotal = startHour * 60 + startMin;
        if (currentTotal > startTotal + 10) {
            return { ok: false, message: '该时间段已过期，无法预约' };
        }
    }

    const bookedApps = appointmentsFind({
        stylistId,
        date: targetDate,
        time: timeSlot
    }).filter(app => app.status !== 'cancelled' && app.status !== 'completed');
    const isBooked = bookedApps.length > 0;

    const blocked = blockedFind({ stylistId, date: targetDate, time: timeSlot });
    const isBlocked = blocked.length > 0;
    const unlocked = blockedFind({ stylistId, date: targetDate, time: `${timeSlot}_UNLOCKED` });
    const isUnlocked = unlocked.length > 0;
    const isDefaultBlockedSlot = isDefaultBlocked(timeSlot, rules, isBooked, isBlocked, isUnlocked);

    if (isBooked || isBlocked || isDefaultBlockedSlot) {
        return { ok: false, message: `时间段 ${timeSlot} 已被预约或锁定` };
    }
    return { ok: true };
}

module.exports = {
    DEFAULT_STORE_RULES,
    normalizeStoreRules,
    generateTimeRanges,
    buildSlotsForDate,
    validateSlotBookable
};
