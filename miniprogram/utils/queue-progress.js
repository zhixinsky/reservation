function ymdFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeToMinutes(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
}

function formatWaitRange(totalMinutes) {
  if (totalMinutes <= 0) {
    return {
      statusLevel: 'normal',
      statusText: '进度正常',
      line2: '建议按预约时间到店',
      numberPart: ''
    };
  }
  if (totalMinutes <= 15) {
    return {
      statusLevel: 'slight',
      statusText: '略有推迟',
      line2: '建议比预约时间晚 ',
      numberPart: '约 15–30 分钟'
    };
  }
  if (totalMinutes <= 45) {
    return {
      statusLevel: 'slight',
      statusText: '略有推迟',
      line2: '建议比预约时间晚 ',
      numberPart: '约 30–60 分钟'
    };
  }
  return {
    statusLevel: 'contact',
    statusText: '建议联系商家',
    line2: '排队较长，请先',
    numberPart: '联系商家确认'
  };
}

async function buildProgressRow(app, callApiFn, formatters = {}) {
  const formatDateText = formatters.formatDateText || (ymd => ymd);
  const timeDisplayFn = formatters.timeDisplay || (item => item.time);
  const serviceTypeTextFn = formatters.serviceTypeText || (() => '剪发');

  const todayStr = ymdFromDate(new Date());
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

  const base = {
    key: `${app.id || app.appId}-${app.date}-${app.time}`,
    dateStr: formatDateText(app.date),
    timeDisplay: timeDisplayFn(app),
    serviceTypeText: serviceTypeTextFn(app.serviceType),
    appId: app.appId,
    delayLine1: '',
    delayLine2: '',
    numberPart: '',
    aheadCount: null,
    hasAheadCount: false,
    statusLevel: '',
    statusText: '',
    showStatus: false,
    showHint: false
  };

  if (app.date > todayStr) {
    base.delayLine1 = '未到预约日，当天可查看排队信息';
    return base;
  }
  if (app.date < todayStr) {
    base.delayLine1 = '预约已过期';
    return base;
  }
  if (app.stylistId == null) {
    base.delayLine1 = '暂无法估算排队';
    base.delayLine2 = '请联系商家确认进度';
    base.statusLevel = 'contact';
    base.statusText = '建议联系商家';
    base.showStatus = true;
    return base;
  }

  try {
    const queue = await callApiFn('getDayQueue', {
      date: app.date,
      stylistId: app.stylistId
    });

    if (!Array.isArray(queue) || queue.length === 0) {
      base.delayLine1 = '目前进度正常';
      base.delayLine2 = '建议按预约时间到店';
      base.statusLevel = 'normal';
      base.statusText = '进度正常';
      base.showStatus = true;
      base.showHint = true;
      return base;
    }

    const myIndex = queue.findIndex(q => q.time === app.time && q.serviceType === app.serviceType);
    const aheadCount = myIndex >= 0 ? myIndex : 0;
    const first = queue[0];
    const endPart = first.time.split('-')[1];
    const delayMinutes = endPart ? currentTotalMinutes - timeToMinutes(endPart.trim()) : 0;
    const wait = formatWaitRange(delayMinutes);

    if (aheadCount === 0) {
      base.delayLine1 = '您是当前队列第1位';
      base.delayLine2 = wait.line2;
      base.numberPart = wait.numberPart;
      base.statusLevel = wait.statusLevel;
      base.statusText = wait.statusText;
      base.showStatus = true;
      base.showHint = true;
      return base;
    }

    base.hasAheadCount = true;
    base.aheadCount = aheadCount;
    if (delayMinutes <= 0) {
      base.delayLine2 = '建议按预约时间到店';
      base.statusLevel = 'normal';
      base.statusText = '进度正常';
    } else {
      base.delayLine2 = wait.line2;
      base.numberPart = wait.numberPart;
      base.statusLevel = wait.statusLevel;
      base.statusText = wait.statusText;
    }
    base.showStatus = true;
    base.showHint = true;
    return base;
  } catch (err) {
    base.delayLine1 = '暂无法估算排队';
    base.delayLine2 = '请联系商家确认进度';
    base.statusLevel = 'contact';
    base.statusText = '建议联系商家';
    base.showStatus = true;
    return base;
  }
}

module.exports = {
  ymdFromDate,
  timeToMinutes,
  formatWaitRange,
  buildProgressRow
};
