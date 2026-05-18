import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = 'https://longitudinalskinanalysissystem-production.up.railway.app';

const TIMEOUT_MS = 15000;

function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

const USER_ID_KEY = '@pixelderm_user_id';

// In-memory fallback used when AsyncStorage native module isn't linked yet.
// Once the app is rebuilt with the native module, AsyncStorage takes over.
let _memoryUserId: string | null = null;

async function storageGet(key: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(key); } catch { return null; }
}

async function storageSet(key: string, value: string): Promise<void> {
  try { await AsyncStorage.setItem(key, value); } catch { /* not yet linked */ }
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export async function createNewUser(displayName?: string, pin?: string): Promise<string> {
  const deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetchWithTimeout(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceIdentifier: deviceId, deviceType: 'android', name: displayName, pin }),
  });
  if (!res.ok) throw new Error('Failed to create user');
  const data = await res.json();
  return data.userId ?? data.user_id ?? data.id;
}

export async function updateUserName(userId: string, name: string, pin?: string): Promise<void> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(pin !== undefined && { pin }) }),
  });
  if (!res.ok) throw new Error('Failed to update user name');
}

export async function getOrCreateUserId(): Promise<string> {
  const stored = (await storageGet(USER_ID_KEY)) ?? _memoryUserId;
  if (stored) return stored;

  const deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetchWithTimeout(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceIdentifier: deviceId, deviceType: 'android' }),
  });

  if (!res.ok) throw new Error('Failed to create user');
  const data = await res.json();
  const userId: string = data.userId ?? data.user_id ?? data.id;
  _memoryUserId = userId;
  await storageSet(USER_ID_KEY, userId);
  return userId;
}

export async function getUserStats(userId: string) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/users/${userId}`);
  if (!res.ok) throw new Error('Failed to fetch user stats');
  return res.json();
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type AnalyzeResult = {
  success: boolean;
  analysis: { analysisId: string; sessionId: string; imageId: string; timestamp: string };
  features: { spotCount: number; textureScore: number; pigmentation: number };
  baseline: { spotCount: number; textureScore: number; pigmentation: number } | null;
  recommendation: { status: string; advice: string; recommendationId: string };
  currentImageUrl?: string;
  previousImageUrl?: string | null;
  uvDamage?: { damageScore: number; level: string; advice: string };
  geminiRecommendation?: string;
};

export type SunProfile = {
  sunExposure?: string;
  sunscreenUse?: string;
  outdoorFrequency?: string;
  lastSunburn?: string;
};

export async function analyzeImage(
  imageUri: string,
  userId: string,
  bodyArea: string,
  sunProfile?: SunProfile,
): Promise<AnalyzeResult> {
  const form = new FormData();
  form.append('userId', userId);
  form.append('bodyArea', bodyArea.toLowerCase());
  form.append('image', {
    uri: imageUri,
    name: 'skin.jpg',
    type: 'image/jpeg',
  } as any);

  if (sunProfile?.sunExposure) form.append('sunExposure', sunProfile.sunExposure);
  if (sunProfile?.sunscreenUse) form.append('sunscreenUse', sunProfile.sunscreenUse);
  if (sunProfile?.outdoorFrequency) form.append('outdoorFrequency', sunProfile.outdoorFrequency);
  if (sunProfile?.lastSunburn) form.append('lastSunburn', sunProfile.lastSunburn);

  const res = await fetchWithTimeout(`${BASE_URL}/api/analyze/upload`, {
    method: 'POST',
    body: form,
    // Do NOT set Content-Type manually — fetch sets multipart boundary automatically
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Analysis failed');
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export async function getComparison(userId: string, bodyArea: string) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/comparison/${userId}/${bodyArea.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch comparison');
  return res.json();
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export async function getTrends(userId: string, bodyArea: string, days = 90) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/trends/${userId}/${bodyArea.toLowerCase()}?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch trends');
  return res.json();
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export async function getRecommendations(userId: string) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/recommendations/${userId}`);
  if (!res.ok) throw new Error('Failed to fetch recommendations');
  return res.json();
}

export async function markRecommendationViewed(recommendationId: string) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/recommendations/${recommendationId}/viewed`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error('Failed to mark recommendation');
  return res.json();
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
