const STYLIST_AVATAR_CUT = '/images/11.png';
const STYLIST_AVATAR_DYE = '/images/22.png';

function resolveStylistAvatar(stylist, serviceType) {
  const photo = stylist && String(stylist.photo || '').trim();
  if (photo) return photo;
  return serviceType === 'dye' ? STYLIST_AVATAR_DYE : STYLIST_AVATAR_CUT;
}

module.exports = {
  STYLIST_AVATAR_CUT,
  STYLIST_AVATAR_DYE,
  resolveStylistAvatar
};
