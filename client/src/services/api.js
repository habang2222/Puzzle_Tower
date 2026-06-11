import { fallbackStages } from '../data/stages.js';

const deployedApiBaseUrl = 'https://puzzletower-production.up.railway.app';
const localApiBaseUrl = 'http://localhost:4000';
const isLocalFrontend =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || (isLocalFrontend ? localApiBaseUrl : deployedApiBaseUrl));
const authTokenKey = 'puzzle-tower-auth-token';

clearLegacyAuthToken();

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function getAuthToken() {
  return getSessionStorage()?.getItem(authTokenKey) || '';
}

export function setAuthToken(token) {
  const storage = getSessionStorage();
  if (token) {
    storage?.setItem(authTokenKey, token);
  } else {
    storage?.removeItem(authTokenKey);
  }
  clearLegacyAuthToken();
}

function getSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (error) {
    return null;
  }
}

function clearLegacyAuthToken() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(authTokenKey);
    }
  } catch (error) {
    // Storage can be blocked by browser privacy settings.
  }
}

export async function fetchHealth() {
  return request('/api/health');
}

export async function fetchStorageStatus() {
  return request('/api/storage/status');
}

export async function fetchStages(filters = {}) {
  try {
    return await request(withQuery('/api/stages', filters));
  } catch (error) {
    return filterFallbackStages(fallbackStages, filters);
  }
}

export async function registerUser(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function loginUser(payload) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function requestPasswordReset(payload) {
  return request('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function confirmPasswordReset(payload) {
  return request('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function fetchMe() {
  return request('/api/auth/me', {
    auth: true
  });
}

export async function saveRecord(record) {
  return request('/api/records', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(record)
  });
}

export async function fetchRankings(stageId = '', limit = 20) {
  const params = new URLSearchParams();
  if (stageId) {
    params.set('stageId', stageId);
  }
  params.set('limit', String(limit));
  return request(`/api/rankings?${params.toString()}`);
}

export async function createStage(stage, token) {
  return adminRequest('/api/admin/stages', 'POST', stage, token);
}

export async function fetchCommunityStages(filters = {}) {
  return request(withQuery('/api/community/stages', filters));
}

export async function fetchCommunityMessages(limit = 100) {
  return request(withQuery('/api/community/messages', { limit }));
}

export async function createCommunityMessage(body) {
  return request('/api/community/messages', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ body })
  });
}

export async function reactToStage(stageId, reaction) {
  return request(`/api/community/stages/${stageId}/reaction`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ reaction })
  });
}

export async function fetchStageComments(stageId) {
  return request(`/api/community/stages/${stageId}/comments`);
}

export async function createStageComment(stageId, body) {
  return request(`/api/community/stages/${stageId}/comments`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ body })
  });
}

export async function reportComment(commentId, reason) {
  return request(`/api/comments/${commentId}/report`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ reason })
  });
}

export async function fetchMyStages() {
  return request('/api/me/stages', {
    auth: true
  });
}

export async function publishCommunityStage(stage) {
  return request('/api/community/stages', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(stage)
  });
}

export async function updateCommunityStage(stageId, stage) {
  return request(`/api/community/stages/${stageId}`, {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(stage)
  });
}

export async function deleteCommunityStage(stageId) {
  return request(`/api/community/stages/${stageId}`, {
    method: 'DELETE',
    auth: true
  });
}

export async function fetchPublicBlocks(filters = {}) {
  return request(withQuery('/api/blocks', filters));
}

export async function fetchMyBlocks() {
  return request('/api/me/blocks', {
    auth: true
  });
}

export async function createCustomBlock(block) {
  return request('/api/blocks', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(block)
  });
}

export async function updateCustomBlock(blockId, block) {
  return request(`/api/blocks/${blockId}`, {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(block)
  });
}

export async function deleteCustomBlock(blockId) {
  return request(`/api/blocks/${blockId}`, {
    method: 'DELETE',
    auth: true
  });
}

export async function downloadCustomBlock(blockId) {
  return request(`/api/blocks/${blockId}/download`, {
    method: 'POST'
  });
}

export async function updateStage(stageId, stage, token) {
  return adminRequest(`/api/admin/stages/${stageId}`, 'PUT', stage, token);
}

export async function deleteStage(stageId, token) {
  return request(`/api/admin/stages/${stageId}`, {
    method: 'DELETE',
    headers: createAdminHeaders(token)
  });
}

export async function configureAdminLogin(payload, token) {
  return adminRequest('/api/admin/login', 'POST', payload, token);
}

export async function fetchAdminCommentReports(token) {
  return request('/api/admin/comment-reports', {
    headers: createAdminHeaders(token)
  });
}

export async function deleteAdminComment(commentId, token) {
  return request(`/api/admin/comments/${commentId}`, {
    method: 'DELETE',
    headers: createAdminHeaders(token)
  });
}

export async function deleteAdminUser(userId, token) {
  return request(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: createAdminHeaders(token)
  });
}

function adminRequest(path, method, body, token) {
  return request(path, {
    method,
    headers: createAdminHeaders(token),
    body: JSON.stringify(body)
  });
}

function createAdminHeaders(token) {
  const headers = {
    'x-admin-token': String(token || '').trim()
  };
  const authToken = getAuthToken();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

function withQuery(path, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function filterFallbackStages(stages, filters = {}) {
  const q = String(filters.q || filters.search || '').trim().toLowerCase();
  const creator = String(filters.creator || filters.maker || '').trim().toLowerCase();
  const tag = String(filters.tag || filters.tags || '').trim().toLowerCase();
  const sort = String(filters.sort || 'recent').trim().toLowerCase();

  const filtered = stages.filter((stage) => {
    const tags = Array.isArray(stage.tags) ? stage.tags.map((item) => String(item).toLowerCase()) : [];
    const matchesQuery = !q || [stage.title, stage.difficulty, tags.join(' ')].some((value) => String(value || '').toLowerCase().includes(q));
    const matchesCreator = !creator || String(stage.creatorNickname || '').toLowerCase().includes(creator);
    const matchesTag = !tag || tags.includes(tag);
    return matchesQuery && matchesCreator && matchesTag;
  });

  if (['likes', 'dislikes', 'comments', 'plays'].includes(sort)) {
    const keyMap = {
      likes: 'likeCount',
      dislikes: 'dislikeCount',
      comments: 'commentCount',
      plays: 'playCount'
    };
    return [...filtered].sort((a, b) => Number(b[keyMap[sort]] || 0) - Number(a[keyMap[sort]] || 0));
  }

  return filtered;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (options.auth) {
    const token = getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '요청에 실패했습니다.' }));
    throw new Error(error.message || '요청에 실패했습니다.');
  }

  return response.json();
}
