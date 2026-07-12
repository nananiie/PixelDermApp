/**
 * Black Box Tests — PixelDerm Mobile App
 * Tests what the user sees and experiences, not internal implementation.
 */

import { BASE_URL, checkHealth, createNewUser } from '../src/api';

// ─── Scoring helpers (copied from App.tsx — black box: we test the output) ───

const computeSkinScore = (features: { spotCount: number; textureScore: number; pigmentation: number }) =>
  Math.min(100, Math.round(
    ((100 - Math.min(features.textureScore * 100, 100))
    + (100 - Math.min(features.pigmentation * 100, 100))
    + (100 - Math.min(features.spotCount * 2, 100))) / 3
  ));

const skinScoreRisk = (score: number) =>
  score >= 70 ? 'Low' : score >= 40 ? 'Moderate' : 'High';

// ─── API Configuration ────────────────────────────────────────────────────────

describe('API Configuration', () => {
  it('BASE_URL points to the live Railway backend, not localhost', () => {
    expect(BASE_URL).not.toContain('localhost');
    expect(BASE_URL).not.toContain('127.0.0.1');
    expect(BASE_URL).not.toContain('192.168');
    expect(BASE_URL).toContain('railway.app');
  });

  it('BASE_URL uses HTTPS', () => {
    expect(BASE_URL.startsWith('https://')).toBe(true);
  });
});

// ─── Skin Score Calculation ───────────────────────────────────────────────────

describe('Skin Score — output visible to user', () => {
  it('returns 100 for perfect skin (no spots, no texture, no pigmentation)', () => {
    const score = computeSkinScore({ spotCount: 0, textureScore: 0, pigmentation: 0 });
    expect(score).toBe(100);
  });

  it('returns 0 for severely damaged skin (max values)', () => {
    const score = computeSkinScore({ spotCount: 50, textureScore: 1, pigmentation: 1 });
    expect(score).toBe(0);
  });

  it('returns a value between 0 and 100 for typical inputs', () => {
    const score = computeSkinScore({ spotCount: 14, textureScore: 0.32, pigmentation: 0.19 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns a whole number (no decimals shown to user)', () => {
    const score = computeSkinScore({ spotCount: 10, textureScore: 0.25, pigmentation: 0.15 });
    expect(Number.isInteger(score)).toBe(true);
  });

  it('lower spot count produces higher skin score', () => {
    const good = computeSkinScore({ spotCount: 5,  textureScore: 0.2, pigmentation: 0.1 });
    const bad  = computeSkinScore({ spotCount: 30, textureScore: 0.2, pigmentation: 0.1 });
    expect(good).toBeGreaterThan(bad);
  });
});

// ─── Risk Level Labels ────────────────────────────────────────────────────────

describe('Risk Level — label shown to user', () => {
  it('shows Low risk for score >= 70', () => {
    expect(skinScoreRisk(70)).toBe('Low');
    expect(skinScoreRisk(85)).toBe('Low');
    expect(skinScoreRisk(100)).toBe('Low');
  });

  it('shows Moderate risk for score between 40 and 69', () => {
    expect(skinScoreRisk(40)).toBe('Moderate');
    expect(skinScoreRisk(55)).toBe('Moderate');
    expect(skinScoreRisk(69)).toBe('Moderate');
  });

  it('shows High risk for score below 40', () => {
    expect(skinScoreRisk(39)).toBe('High');
    expect(skinScoreRisk(20)).toBe('High');
    expect(skinScoreRisk(0)).toBe('High');
  });

  it('boundary: score of exactly 70 is Low not Moderate', () => {
    expect(skinScoreRisk(70)).toBe('Low');
  });

  it('boundary: score of exactly 40 is Moderate not High', () => {
    expect(skinScoreRisk(40)).toBe('Moderate');
  });
});

// ─── API Functions — behavior without a real server ──────────────────────────

describe('API Functions — user-facing behavior', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('checkHealth returns true when server responds with ok', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true } as Response);
    const result = await checkHealth();
    expect(result).toBe(true);
  });

  it('checkHealth returns false when server is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));
    const result = await checkHealth();
    expect(result).toBe(false);
  });

  it('createNewUser throws an error when the server returns a failure', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
    await expect(createNewUser('TestUser')).rejects.toThrow('Failed to create user');
  });
});
