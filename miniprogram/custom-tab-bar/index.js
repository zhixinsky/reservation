Component({
  data: {
    selected: 0,
    visible: true,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '预约'
      },
      {
        pagePath: '/pages/my/my',
        text: '我的'
      }
    ]
  },

  lifetimes: {
    attached() {
      const app = getApp();
      const hidden = app.globalData && app.globalData.tabBarHidden;
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const route = (page && page.route) || '';
      const selected = route.indexOf('pages/my/my') !== -1 ? 1 : 0;
      this.setData({ selected, visible: !hidden });
    }
  },

  pageLifetimes: {
    show() {
      const app = getApp();
      const hidden = app.globalData && app.globalData.tabBarHidden;
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const route = (page && page.route) || '';
      const selected = route.indexOf('pages/my/my') !== -1 ? 1 : 0;
      this.setData({ selected, visible: !hidden });
    }
  },

  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset;
      if (Number(index) === this.data.selected) return;
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.tabBarHidden = false;
      }
      this.setData({ selected: Number(index), visible: true });
      wx.switchTab({ url: path });
    }
  }
});
