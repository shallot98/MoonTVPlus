/** @jest-environment ./scripts/jest-node-fetch-environment.cjs */
import { describe, expect, test } from '@jest/globals';
// Jest 27 不识别 node:sqlite；从 Node 22+ 的内置模块入口读取真实 SQLite。
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

jest.mock('./notification-dispatch', () => ({ dispatchNotificationChannels: jest.fn() }));
jest.mock('./user-cache', () => ({ userInfoCache: { delete: jest.fn() } }));
import { SQLiteAdapter } from './d1-adapter';
import { D1Storage } from './d1.db';
import { makeOpenListSegmentFavoriteId } from './openlist-segment-favorite';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE manga_shelf (id TEXT);
    CREATE TABLE favorites (username TEXT, key TEXT, source_name TEXT, total_episodes INTEGER,
      title TEXT, year TEXT, cover TEXT, save_time INTEGER, search_title TEXT, origin TEXT,
      is_completed INTEGER, vod_remarks TEXT, PRIMARY KEY(username,key));`);
  return db;
}
const favorite = (fileName: string) => ({
  title: `主播 · ${fileName}`, source_name: '私人影库', total_episodes: 1,
  year: '', cover: '', save_time: 1, search_title: '',
  segment: { contentId: 'original', folder: '/主播', fileName, title: fileName },
});

describe('SQLite 分段收藏实际持久化', () => {
  test('老表幂等迁移，重新读取仍有文件定位，取消A不影响B和旧收藏', async () => {
    const db = database();
    const storage = new D1Storage(new SQLiteAdapter(db));
    const a = makeOpenListSegmentFavoriteId('/主播', 'A.mp4');
    const b = makeOpenListSegmentFavoriteId('/主播', 'B.mp4');
    await storage.setFavorite('u', `openlist+${a}`, favorite('A.mp4'));
    await storage.setFavorite('u', `openlist+${b}`, favorite('B.mp4'));
    await storage.setFavorite('u', 'openlist+legacy', { ...favorite('legacy'), segment: undefined });
    const all = await storage.getAllFavorites('u');
    expect(all[`openlist+${a}`].segment).toEqual(favorite('A.mp4').segment);
    expect(all[`openlist+${b}`].segment).toEqual(favorite('B.mp4').segment);
    expect(all['openlist+legacy'].segment).toBeUndefined();
    await storage.deleteFavorite('u', `openlist+${a}`);
    expect(await storage.getFavorite('u', `openlist+${a}`)).toBeNull();
    expect((await storage.getFavorite('u', `openlist+${b}`))?.segment?.fileName).toBe('B.mp4');
    // 再次触发真实的表结构检查，不重复添加字段。
    const reopened = new D1Storage(new SQLiteAdapter(db));
    await reopened.setFavorite('u', `openlist+${b}`, favorite('B.mp4'));
    expect(Object.keys(await reopened.getAllFavorites('u'))).toHaveLength(2);
  });

  test('SQLite返回success=false也必须抛错，不能向前端报告保存成功', async () => {
    const db = database();
    const storage = new D1Storage(new SQLiteAdapter(db));
    await storage.setFavorite('u', 'seed', favorite('A.mp4'));
    db.exec("CREATE TRIGGER fail_favorite BEFORE INSERT ON favorites BEGIN SELECT RAISE(FAIL, 'write denied'); END;");
    await expect(storage.setFavorite('u', 'blocked', favorite('B.mp4'))).rejects.toThrow('write denied');
    expect(await storage.getFavorite('u', 'blocked')).toBeNull();
  });
});
