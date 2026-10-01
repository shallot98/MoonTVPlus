/** @jest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

jest.mock('./auth', () => ({ getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }), clearAuthCookie: jest.fn() }));

let api: typeof import('./db.client');
let fetchMock: jest.Mock;
const segment = { contentId: 'content', folder: '/主播', fileName: 'A.mp4', title: '片段 A' };
const favorite = { title: '主播 · A', source_name: '私人影库', year: '', cover: '', total_episodes: 1, save_time: 1, segment };
const id = `segment-v1:${encodeURIComponent(JSON.stringify([segment.folder, segment.fileName]))}`;

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  localStorage.clear();
  (window as any).RUNTIME_CONFIG = { STORAGE_TYPE: 'd1' };
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  global.fetch = fetchMock;
  api = await import('./db.client');
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('分段收藏客户端等待持久化确认', () => {
  test('写入失败不发布亮星事件，也不更改缓存', async () => {
    const listener = jest.fn();
    window.addEventListener('favoritesUpdated', listener);
    fetchMock.mockImplementation(async (_url, options) => options?.method === 'POST'
      ? { ok: false, status: 500 }
      : { ok: true, status: 200, json: async () => ({}) });
    await expect(api.saveFavorite('openlist', id, favorite)).rejects.toThrow();
    expect(await api.isFavorited('openlist', id)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('favoritesUpdated', listener);
  });

  test('请求处理中不乐观亮星；成功后只保存该段，再取消只删除该key', async () => {
    let finish!: (value: any) => void;
    fetchMock.mockImplementation(async (_url, options) => options?.method === 'POST'
      ? await new Promise((resolve) => { finish = resolve; })
      : { ok: true, status: 200, json: async () => options?.method === 'DELETE' ? { success: true } : {} });
    const saving = api.saveFavorite('openlist', id, favorite);
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    expect(await api.isFavorited('openlist', id)).toBe(false);
    finish({ ok: true, status: 200, json: async () => ({ success: true }) });
    await saving;
    expect(await api.isFavorited('openlist', id)).toBe(true);
    await api.deleteFavorite('openlist', id);
    expect(await api.isFavorited('openlist', id)).toBe(false);
    expect(fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')?.[0])
      .toBe(`/api/favorites?key=${encodeURIComponent(`openlist+${id}`)}`);
  });

  test('取消失败保持已收藏状态', async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === 'DELETE'
      ? { ok: false, status: 500 }
      : { ok: true, status: 200, json: async () => options?.method === 'POST' ? { success: true } : {} });
    await api.saveFavorite('openlist', id, favorite);
    await expect(api.deleteFavorite('openlist', id)).rejects.toThrow();
    expect(await api.isFavorited('openlist', id)).toBe(true);
  });
});
