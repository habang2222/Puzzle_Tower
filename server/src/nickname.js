export const ADMIN_NICKNAME = 'Admin';
export const ADMIN_NICKNAME_KEY = 'admin';

const invisibleOrControlPattern = /[\p{C}\p{M}\u200B-\u200F\u202A-\u202E\u2060-\u206F]/u;
const allowedNicknamePattern = /^[A-Za-z0-9가-힣_-]{2,18}$/u;
const leetMap = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  l: 'i',
  '|': 'i'
};

export function validateNicknameInput(value, options = {}) {
  const allowAdmin = options.allowAdmin === true;
  const raw = String(value || '');
  const normalized = raw.normalize('NFKC').trim();

  if (!normalized) {
    return { ok: false, message: '닉네임이 필요합니다.' };
  }
  if (normalized !== raw.trim()) {
    return { ok: false, message: '전각 문자나 유니코드 변형 닉네임은 사용할 수 없습니다.' };
  }
  if (invisibleOrControlPattern.test(normalized)) {
    return { ok: false, message: '투명 문자, 제어 문자, 조합 문자는 닉네임에 사용할 수 없습니다.' };
  }
  if (!allowedNicknamePattern.test(normalized)) {
    return { ok: false, message: '닉네임은 한글, 영문, 숫자, _, - 만 사용해서 2~18자로 입력하세요.' };
  }

  const key = createNicknameKey(normalized);
  if (!allowAdmin && isReservedNicknameKey(key)) {
    return { ok: false, message: 'admin 또는 admin과 비슷한 닉네임은 사용할 수 없습니다.' };
  }

  return { ok: true, nickname: normalized, key };
}

export function createNicknameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/[013457l|]/g, (char) => leetMap[char] || char);
}

export function sanitizeDisplayText(value, maxLength = 40, fallback = '') {
  const normalized = String(value || '').normalize('NFKC').replace(invisibleOrControlPattern, '').trim();
  return normalized.slice(0, maxLength) || fallback;
}

export function parseTags(value, maxTags = 5) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [];

  source.forEach((item) => {
    const tag = sanitizeDisplayText(item, 18, '')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .toLowerCase();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  });

  return tags.slice(0, maxTags);
}

export function isReservedNicknameKey(key) {
  if (!key) {
    return false;
  }

  return key.includes(ADMIN_NICKNAME_KEY) || levenshteinDistance(key, ADMIN_NICKNAME_KEY) <= 1;
}

function levenshteinDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let col = 1; col <= b.length; col += 1) {
    rows[0][col] = col;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      rows[row][col] = Math.min(
        rows[row - 1][col] + 1,
        rows[row][col - 1] + 1,
        rows[row - 1][col - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}
