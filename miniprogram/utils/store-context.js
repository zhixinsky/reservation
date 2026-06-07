const STORAGE_ID_KEY = 'selected_store_id';
const STORAGE_INFO_KEY = 'selected_store_info';

function normalizeStoreList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.stores)) return raw.stores;
  return [];
}

function isActiveStore(store) {
  return store && store.id != null && store.status !== 'disabled';
}

function parsePositiveStoreId(value) {
  if (value == null || value === '') return null;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** 从启动参数解析扫码/链接带入的 storeId（小程序码 scene 或 query） */
function parseLaunchStoreId(options) {
  if (!options) return null;

  const direct = parsePositiveStoreId(options.storeId);
  if (direct != null) return direct;

  if (options.query) {
    const fromQuery = parsePositiveStoreId(options.query.storeId);
    if (fromQuery != null) return fromQuery;
  }

  const scene = options.scene;
  if (!scene) return null;

  const decoded = decodeURIComponent(String(scene));
  const match = decoded.match(/(?:^|[&?])storeId=(\d+)/i)
    || decoded.match(/(?:^|[&?])s=(\d+)/i)
    || decoded.match(/^(\d+)$/);
  return match ? parsePositiveStoreId(match[1]) : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoords(store) {
  return store
    && store.latitude != null
    && store.longitude != null
    && !Number.isNaN(Number(store.latitude))
    && !Number.isNaN(Number(store.longitude));
}

function pickNearestStore(stores, lat, lng) {
  if (!Array.isArray(stores) || !stores.length) return null;
  const withCoords = stores.filter(hasCoords);
  const pool = withCoords.length ? withCoords : stores;
  if (lat != null && lng != null && withCoords.length) {
    return [...withCoords].sort((a, b) => (
      haversineKm(lat, lng, Number(a.latitude), Number(a.longitude))
      - haversineKm(lat, lng, Number(b.latitude), Number(b.longitude))
    ))[0];
  }
  return pool[0];
}

function getSavedStoreId() {
  const value = wx.getStorageSync(STORAGE_ID_KEY);
  return value != null && value !== '' ? Number(value) : null;
}

function clampBookAheadDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(1, Math.round(n)));
}

const STORE_NAME_MAX_LEN = 6;

function formatStoreName(name) {
  const s = String(name || '门店').trim() || '门店';
  return s.length > STORE_NAME_MAX_LEN ? s.slice(0, STORE_NAME_MAX_LEN) : s;
}

function saveStoreSelection(store) {
  if (!store) return;
  wx.setStorageSync(STORAGE_ID_KEY, Number(store.id));
  wx.setStorageSync(STORAGE_INFO_KEY, {
    id: Number(store.id),
    name: formatStoreName(store.name),
    phone: store.phone || '',
    latitude: store.latitude != null ? Number(store.latitude) : null,
    longitude: store.longitude != null ? Number(store.longitude) : null,
    bookAheadDays: clampBookAheadDays(store.bookAheadDays)
  });
}

function getCachedStore() {
  try {
    const info = wx.getStorageSync(STORAGE_INFO_KEY);
    return info && info.id != null ? info : null;
  } catch (_) {
    return null;
  }
}

function requestUserLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
  });
}

async function resolveStoreContext(fetchStores, opts = {}) {
  const raw = await fetchStores();
  const stores = normalizeStoreList(raw).filter(isActiveStore);
  const preferredId = parsePositiveStoreId(opts.preferredStoreId);

  if (preferredId != null) {
    const preferred = stores.find((s) => Number(s.id) === preferredId);
    if (preferred) {
      saveStoreSelection(preferred);
      return {
        stores,
        storeId: Number(preferred.id),
        selectedStore: preferred,
        showPicker: stores.length > 1,
        fromScan: true
      };
    }
  }

  if (stores.length <= 1) {
    const store = stores[0] || { id: 1, name: '默认门店' };
    saveStoreSelection(store);
    return {
      stores,
      storeId: Number(store.id),
      selectedStore: store,
      showPicker: false
    };
  }

  const savedId = getSavedStoreId();
  const savedStore = savedId != null
    ? stores.find((s) => Number(s.id) === savedId)
    : null;
  if (savedStore) {
    saveStoreSelection(savedStore);
    return {
      stores,
      storeId: Number(savedStore.id),
      selectedStore: savedStore,
      showPicker: true
    };
  }

  let nearest = stores[0];
  try {
    const loc = await requestUserLocation();
    nearest = pickNearestStore(stores, loc.latitude, loc.longitude) || nearest;
  } catch (_) {
    nearest = pickNearestStore(stores) || nearest;
  }
  saveStoreSelection(nearest);
  return {
    stores,
    storeId: Number(nearest.id),
    selectedStore: nearest,
    showPicker: true
  };
}

module.exports = {
  resolveStoreContext,
  parseLaunchStoreId,
  saveStoreSelection,
  getCachedStore,
  getSavedStoreId,
  pickNearestStore,
  hasCoords,
  formatStoreName
};
