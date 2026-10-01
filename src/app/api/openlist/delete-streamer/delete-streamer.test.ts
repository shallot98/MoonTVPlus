/** @jest-environment ./scripts/jest-node-fetch-environment.cjs */
import { beforeEach, describe, expect, test } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { getGlobalValue: jest.fn(), setGlobalValue: jest.fn(), saveAdminConfig: jest.fn(), getUserInfoV2: jest.fn() } }));
jest.mock('@/lib/permissions', () => ({ requireFeaturePermission: jest.fn() }));
jest.mock('@/lib/openlist.client', () => ({ OpenListClient: jest.fn() }));
jest.mock('@/lib/openlist-cache', () => ({ getCachedMetaInfo: jest.fn(), setCachedMetaInfo: jest.fn(), invalidateMetaInfoCache: jest.fn(), invalidateVideoInfoCache: jest.fn() }));
jest.mock('@/lib/openlist-proxy-cache', () => ({ invalidateOpenListProxyUrl: jest.fn() }));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import { getCachedMetaInfo } from '@/lib/openlist-cache';
import { listQualifiedVideos } from '@/lib/openlist-delete';
import { requireFeaturePermission } from '@/lib/permissions';

import { POST } from './route';

// 仅测试夹具：从不连接真正的 OpenList，更不会删除真实录屏。
const folder = '/抖音/测试主播';
let files: Map<string, { name: string; size: number; is_dir: boolean }>;
const client = { listDirectory: jest.fn(), getFile: jest.fn(), removeEntries: jest.fn() };
const request = (body: unknown, origin = 'https://example.test') => new NextRequest('https://example.test/api/openlist/delete-streamer', {
  method: 'POST', headers: { 'content-type': 'application/json', origin, host: 'example.test' }, body: JSON.stringify(body),
});
const execute = (fileNames = Array.from(files.keys())) => POST(request({ action: 'delete', folder, fileNames }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENLIST_ALLOW_DELETE = '1';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  process.env.OPENLIST_MIN_VIDEO_MB = '50';
  process.env.USERNAME = 'owner';
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({ username: 'owner' });
  (requireFeaturePermission as jest.Mock).mockResolvedValue({});
  const config = { OpenListConfig: { Enabled: true, URL: 'https://openlist.invalid', Username: 'test', Password: 'test', RootPaths: ['/抖音'] } };
  (getConfig as jest.Mock).mockResolvedValue(config);
  const meta = { folders: { current: { folderName: folder }, other: { folderName: '/抖音/其他主播' } } };
  (getCachedMetaInfo as jest.Mock).mockReturnValue(meta);
  (db.getGlobalValue as jest.Mock).mockResolvedValue(JSON.stringify(meta));
  (db.setGlobalValue as jest.Mock).mockResolvedValue(undefined);
  (db.saveAdminConfig as jest.Mock).mockResolvedValue(undefined);
  (OpenListClient as unknown as jest.Mock).mockImplementation(() => client);
  files = new Map([
    ['large.mp4', { name: 'large.mp4', size: 100 * 1024 ** 2, is_dir: false }],
    ['tiny.mp4', { name: 'tiny.mp4', size: 10, is_dir: false }],
  ]);
  client.listDirectory.mockImplementation(async (_folder, page = 1, perPage = 100) => ({ code: 200, data: { content: Array.from(files.values()).slice(((page as number) - 1) * (perPage as number), (page as number) * (perPage as number)) } }));
  client.getFile.mockImplementation(async (path) => {
    const data = files.get(String(path).slice(folder.length + 1));
    return data ? { code: 200, data } : { code: 500, message: 'not found' };
  });
  client.removeEntries.mockImplementation(async (_folder, names) => {
    for (const name of names as string[]) files.delete(name);
    return { code: 200 };
  });
});

describe('删除主播全部视频', () => {
  test('预览包含隐藏小视频，排除图片和目录，预览没有删除副作用', async () => {
    files.set('poster.jpg', { name: 'poster.jpg', size: 100, is_dir: false });
    files.set('child.mp4', { name: 'child.mp4', size: 100, is_dir: true });
    const response = await POST(request({ action: 'preview', folder }));
    expect(response.status).toBe(200);
    expect((await response.json()).fileNames).toEqual(['large.mp4', 'tiny.mp4']);
    expect(client.removeEntries).not.toHaveBeenCalled();
  });

  test('列举完整分页且原有合格分集过滤不变', async () => {
    for (let i = 0; i < 200; i++) files.set(`${i}.mp4`, { name: `${i}.mp4`, size: 1, is_dir: false });
    expect(await listQualifiedVideos(client as never, folder, true)).toHaveLength(202);
    expect(await listQualifiedVideos(client as never, folder)).toHaveLength(1);
  });

  test('空目录必须明确为空，分页短页仍按total继续，分页异常不当作成功', async () => {
    client.listDirectory.mockResolvedValue({ code: 200, data: { content: null, total: 0 } });
    expect(await listQualifiedVideos(client as never, folder, true)).toEqual([]);
    client.listDirectory.mockResolvedValue({ code: 200, data: {} });
    await expect(listQualifiedVideos(client as never, folder, true)).rejects.toThrow('列目录失败');
    client.listDirectory.mockImplementation(async (_folder, page) => ({ code: 200, data: {
      total: 2, content: page === 1 ? [files.get('large.mp4')] : page === 2 ? [files.get('tiny.mp4')] : [],
    } }));
    expect(await listQualifiedVideos(client as never, folder, true)).toHaveLength(2);
  });

  test.each([
    ['关闭开关', () => { process.env.OPENLIST_ALLOW_DELETE = '0'; }, 404],
    ['未登录', () => { (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null); }, 401],
    ['普通用户', () => { (getAuthInfoFromCookie as jest.Mock).mockReturnValue({ username: 'viewer' }); (db.getUserInfoV2 as jest.Mock).mockResolvedValue({ role: 'user' }); }, 403],
  ])('%s拒绝且不删除', async (_name, setup, status) => {
    (setup as () => void)();
    expect((await execute()).status).toBe(status);
    expect(client.removeEntries).not.toHaveBeenCalled();
  });

  test('跨站和越界目录被拒绝', async () => {
    expect((await POST(request({ action: 'delete', folder, fileNames: ['large.mp4'] }, 'https://evil.invalid'))).status).toBe(403);
    for (const bad of ['/抖音', '/别处/主播', '/抖音/../主播', '/抖音/未登记']) {
      expect((await POST(request({ action: 'preview', folder: bad }))).status).toBeGreaterThanOrEqual(400);
    }
    expect(client.removeEntries).not.toHaveBeenCalled();
  });

  test('清单变化返回409，重复/非视频文件名返回400，预检失败零删除', async () => {
    expect((await execute(['large.mp4'])).status).toBe(409);
    expect((await execute(['large.mp4', 'large.mp4'])).status).toBe(400);
    expect((await execute(['../large.mp4'])).status).toBe(400);
    client.getFile.mockResolvedValue({ code: 500, message: 'not found' });
    expect((await execute()).status).toBe(409);
    expect(client.removeEntries).not.toHaveBeenCalled();
  });

  test('全部成功：删除大小视频，只移除当前主播条目', async () => {
    const response = await execute();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.deleted).toEqual(['large.mp4', 'tiny.mp4']);
    expect(data.folderRemoved).toBe(true);
    const saved = JSON.parse((db.setGlobalValue as jest.Mock).mock.calls[0][1] as string);
    expect(saved.folders.current).toBeUndefined();
    expect(saved.folders.other).toBeDefined();
    expect(client.removeEntries.mock.calls.every(([path]) => path === folder)).toBe(true);
  });

  test('小视频删除失败：部分成功如实报告，保留主播条目用于重试', async () => {
    client.removeEntries.mockImplementation(async (_folder, names) => {
      if ((names as string[])[0] === 'tiny.mp4') return { code: 500, message: 'permission denied' };
      files.delete('large.mp4');
      return { code: 200 };
    });
    const response = await execute();
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.deleted).toEqual(['large.mp4']);
    expect(data.failed[0].name).toBe('tiny.mp4');
    expect(data.folderRemoved).toBe(false);
    expect(db.setGlobalValue).not.toHaveBeenCalled();
  });

  test('OpenList假成功但文件仍存在时，不报告删除成功', async () => {
    client.removeEntries.mockResolvedValue({ code: 200 });
    const response = await execute();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.deleted).toEqual([]);
    expect(data.failed).toHaveLength(2);
    expect(db.setGlobalValue).not.toHaveBeenCalled();
  });
});
