App({
  globalData: {
    tabBarHidden: false
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '初始化失败',
        content: '当前微信版本不支持云开发，请升级微信。'
      });
      return;
    }

    wx.cloud.init({
      env: 'reservation-d2gf73dgv8fd17503',
      traceUser: true
    });

    const { loadAppFonts } = require('./utils/load-fonts');
    loadAppFonts().then(ok => {
      if (!ok) {
        console.warn('[fonts] Noto Serif SC failed to load, using system fallback');
      }
    });
  }
});
