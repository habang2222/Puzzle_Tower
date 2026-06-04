import { fallbackStages } from '../data/stages.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function fetchHealth() {
  return request('/api/health');
}

export async function fetchStages() {
  try {
    return await request('/api/stages');
  } catch (error) {
    return fallbackStages;
  }
}

export async function saveRecord(record) {
  return request('/api/records', {
    method: 'POST',
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

export async function updateStage(stageId, stage, token) {
  return adminRequest(`/api/admin/stages/${stageId}`, 'PUT', stage, token);
}

export async function deleteStage(stageId, token) {
  return request(`/api/admin/stages/${stageId}`, {
    method: 'DELETE',
    headers: {
      'x-admin-token': token
    }
  });
}

function adminRequest(path, method, body, token) {
  return request(path, {
    method,
    headers: {
      'x-admin-token': token
    },
    body: JSON.stringify(body)
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '요청에 실패했습니다.' }));
    throw new Error(error.message || '요청에 실패했습니다.');
  }

  return response.json();
}
