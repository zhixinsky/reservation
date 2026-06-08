/**
 * 预约取消后的短信通知（用户取消 / 门店取消）
 */

function resolveCancelDisplayTime(app, relatedApps) {
    let displayTime = app.time;
    const rows = Array.isArray(relatedApps) ? relatedApps : [];
    if (app.serviceType !== 'dye' || rows.length <= 1) return displayTime;
    const sorted = [...rows].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const [firstStart] = String(sorted[0].time || '').split('-');
    const [, lastEnd] = String(sorted[sorted.length - 1].time || '').split('-');
    return lastEnd ? `${firstStart}-${lastEnd}` : displayTime;
}

function findDyeRelatedApps(app, findAppointments) {
    return findAppointments({
        appId: app.appId,
        phone: app.phone,
        date: app.date,
        serviceType: 'dye'
    });
}

function createCancelNotifiers({
    getStylists,
    findAppointments,
    smsPayloadForStylist,
    sendCancelBookingSMS,
    sendStylistCancelBookingSMS
}) {
    function findStylist(stylistId) {
        const stylists = typeof getStylists === 'function' ? getStylists() : [];
        return stylists.find(s => String(s.id) === String(stylistId));
    }

    function buildPayload(app, stylist, displayTime) {
        return smsPayloadForStylist(stylist, {
            phone: app.phone,
            appId: app.appId,
            stylistName: stylist.name,
            date: app.date,
            time: displayTime
        });
    }

    function notifyUserCancel(app) {
        const stylist = findStylist(app.stylistId);
        if (!stylist || !app.phone) return Promise.resolve(false);
        const related = app.serviceType === 'dye' ? findDyeRelatedApps(app, findAppointments) : [app];
        const displayTime = resolveCancelDisplayTime(app, related);
        return sendCancelBookingSMS(buildPayload(app, stylist, displayTime)).catch((err) => {
            console.error('[短信] 用户取消预约通知失败:', err.message);
            return false;
        });
    }

    function notifyStylistCancel(app) {
        const stylist = findStylist(app.stylistId);
        if (!stylist || !app.phone) return Promise.resolve(false);
        const activeRelated = app.serviceType === 'dye'
            ? findDyeRelatedApps(app, findAppointments).filter(row =>
                row.status !== 'cancelled' && row.status !== 'completed'
            )
            : [app];
        const timeSource = activeRelated.length ? activeRelated : [app];
        const displayTime = resolveCancelDisplayTime(app, timeSource);
        return sendStylistCancelBookingSMS(buildPayload(app, stylist, displayTime)).catch((err) => {
            console.error('[短信] 门店取消预约通知失败:', err.message);
            return false;
        });
    }

    return { notifyUserCancel, notifyStylistCancel, resolveCancelDisplayTime };
}

module.exports = {
    createCancelNotifiers,
    resolveCancelDisplayTime,
    findDyeRelatedApps
};
