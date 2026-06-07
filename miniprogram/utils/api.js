const ENV_ID = 'reservation-d2gf73dgv8fd17503';
const SERVICE_NAME = 'express-vbry';

function qs(params) {
  const pairs = Object.keys(params || {})
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

function containerRequest({ path, method = 'GET', data = {}, sessionId }) {
  const header = {
    'X-WX-SERVICE': SERVICE_NAME
  };
  if (sessionId) {
    header['x-session-id'] = sessionId;
  }

  return wx.cloud.callContainer({
    config: {
      env: ENV_ID
    },
    path,
    header,
    method,
    data
  }).then(res => res.data);
}

function callApi(action, payload = {}) {
  const sessionId = payload.sessionId;

  switch (action) {
    case 'getStores':
      return containerRequest({ path: '/api/stores' });
    case 'getAnnouncement':
      return containerRequest({ path: `/api/announcement${qs({ storeId: payload.storeId })}` });
    case 'getStylists':
      return containerRequest({ path: `/api/stylists${qs({ storeId: payload.storeId })}` });
    case 'getSlots':
      return containerRequest({
        path: `/api/slots/${encodeURIComponent(payload.stylistId)}${qs({ date: payload.date })}`
      });
    case 'bookAppointment':
      return containerRequest({ path: '/api/book', method: 'POST', data: payload });
    case 'getPhoneNumber':
      return containerRequest({ path: '/api/wechat/phone-number', method: 'POST', data: { code: payload.code } });
    case 'queryAppointments':
      return containerRequest({ path: '/api/appointments/query', method: 'POST', data: payload });
    case 'queryAppointmentHistory':
      return containerRequest({ path: '/api/appointments/history', method: 'POST', data: payload });
    case 'getDayQueue':
      return containerRequest({
        path: `/api/appointments/day-queue${qs({ date: payload.date, stylistId: payload.stylistId })}`
      });
    case 'cancelAppointments':
      return containerRequest({
        path: '/api/cancel',
        method: 'POST',
        data: { appointmentIds: payload.appointmentIds }
      });
    case 'adminLogin':
      return containerRequest({ path: '/api/auth/login', method: 'POST', data: payload });
    case 'verifySession':
      return containerRequest({ path: '/api/auth/verify', sessionId });
    case 'getAdminAppointments':
      return containerRequest({ path: '/api/admin/appointments', sessionId });
    case 'adminCancelAppointment':
      return containerRequest({
        path: '/api/admin/cancel',
        method: 'POST',
        data: { appointmentId: payload.appointmentId },
        sessionId
      });
    case 'completeAppointment':
      return containerRequest({
        path: '/api/admin/complete',
        method: 'POST',
        data: { appointmentId: payload.appointmentId },
        sessionId
      });
    case 'getAdminBlockedSlots':
      return containerRequest({
        path: `/api/admin/blocked-slots${qs({ stylistId: payload.stylistId, date: payload.date })}`,
        sessionId
      });
    case 'adminBlockSlot':
      return containerRequest({
        path: '/api/admin/block',
        method: 'POST',
        data: {
          stylistId: payload.stylistId,
          date: payload.date,
          time: payload.time
        },
        sessionId
      });
    case 'adminUnblockSlot':
      return containerRequest({
        path: '/api/admin/unblock',
        method: 'POST',
        data: {
          stylistId: payload.stylistId,
          date: payload.date,
          time: payload.time
        },
        sessionId
      });
    case 'getStylistInfo':
      return containerRequest({ path: '/api/admin/stylist/info', sessionId });
    case 'saveStylistVacation':
      return containerRequest({
        path: '/api/admin/stylist/vacation',
        method: 'POST',
        data: { vacationRanges: payload.vacationRanges || [] },
        sessionId
      });
    case 'getAdminAnnouncement':
      return containerRequest({ path: '/api/admin/announcement', sessionId });
    case 'saveAnnouncement':
      return containerRequest({
        path: '/api/admin/announcement',
        method: 'POST',
        data: { text: payload.text || '' },
        sessionId
      });
    default:
      return Promise.reject(new Error(`未知操作: ${action}`));
  }
}

module.exports = {
  callApi,
  containerRequest
};
