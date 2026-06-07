function applyTabBar(page, handler, attempt) {
  if (!page || typeof page.getTabBar !== 'function') return;

  const run = tabBar => {
    if (tabBar && typeof tabBar.setData === 'function') {
      handler(tabBar);
      return true;
    }
    return false;
  };

  const syncTabBar = page.getTabBar();
  if (run(syncTabBar)) return;

  page.getTabBar(tabBar => {
    if (run(tabBar)) return;
    if (attempt >= 10) return;
    setTimeout(() => applyTabBar(page, handler, attempt + 1), 50);
  });
}

function withTabBar(page, handler) {
  applyTabBar(page, handler, 0);
}

function setTabBarVisible(visible) {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.tabBarHidden = !visible;
  }
}

function setTabBarState(page, data) {
  if (data.visible !== undefined) {
    setTabBarVisible(data.visible);
  }
  withTabBar(page, tabBar => tabBar.setData(data));
}

function showTabBar(page, extra = {}) {
  setTabBarState(page, { visible: true, ...extra });
}

function hideTabBar(page) {
  setTabBarState(page, { visible: false });
}

function shouldShowIndexTabBar(pageData) {
  if (!pageData) return true;
  return !pageData.drawerVisible
    && !pageData.phoneModalVisible
    && !pageData.confirmModalVisible
    && !pageData.successVisible
    && !pageData.cancelModalVisible
    && !pageData.progressModalVisible;
}

function syncIndexTabBar(page) {
  if (!page || typeof page.data !== 'object') return;
  if (shouldShowIndexTabBar(page.data)) {
    showTabBar(page, { selected: 0, visible: true });
  } else {
    hideTabBar(page);
  }
}

module.exports = {
  withTabBar,
  setTabBarState,
  showTabBar,
  hideTabBar,
  shouldShowIndexTabBar,
  syncIndexTabBar
};
