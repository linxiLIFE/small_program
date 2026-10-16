const STORE_NAME = '四个小姐姐的店';
const SHARE_COVER = '/assets/share-cover.png';

function createShareCard(title, path, imageUrl) {
  return { title: title || STORE_NAME, path, imageUrl: imageUrl || SHARE_COVER };
}

function createInviteShare(profile = {}) {
  const code = String(profile.inviteCode || '').trim().toUpperCase();
  const query = /^[A-Z0-9]{6,16}$/.test(code) ? `?invite=${encodeURIComponent(code)}` : '';
  return createShareCard(`邀请你来${STORE_NAME}`, `/pages/points/index${query}`);
}

module.exports = { STORE_NAME, createShareCard, createInviteShare };
