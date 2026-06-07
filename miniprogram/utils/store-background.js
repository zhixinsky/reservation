const DEFAULT_PAGE_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/background.png';

function resolveStorePageBg(store) {
  const custom = store && String(store.backgroundImage || '').trim();
  return custom || DEFAULT_PAGE_BG;
}

module.exports = {
  DEFAULT_PAGE_BG,
  resolveStorePageBg
};
