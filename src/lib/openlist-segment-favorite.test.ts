import { describe, expect, test } from '@jest/globals';

import {
  buildOpenListSegmentPlayUrl,
  findOpenListSegmentIndex,
  makeOpenListSegmentFavoriteId,
  parseOpenListEpisodeUrl,
} from './openlist-segment-favorite';

const episode = (folder: string, fileName: string) => `/api/openlist/play?${new URLSearchParams({ folder, fileName })}`;

describe('OpenList 分段收藏', () => {
  test('同场两段和不同主播的同名文件分别使用独立稳定标识', () => {
    const a = makeOpenListSegmentFavoriteId('/主播甲', '001.mp4');
    expect(a).not.toBe(makeOpenListSegmentFavoriteId('/主播甲', '002.mp4'));
    expect(a).not.toBe(makeOpenListSegmentFavoriteId('/主播乙', '001.mp4'));
    expect(a).toBe(makeOpenListSegmentFavoriteId('/主播甲', '001.mp4'));
  });

  test('中文、加号与路径分隔符不会破坏 source+id 存储格式', () => {
    const folder = '/抖音/甲+乙';
    const fileName = '[录屏]&片段+001.mp4';
    const id = makeOpenListSegmentFavoriteId(folder, fileName);
    expect(id).not.toContain('+');
    expect(`openlist+${id}`.split('+')).toHaveLength(2);
    expect(parseOpenListEpisodeUrl(episode(folder, fileName))).toEqual({ folder, fileName });
  });

  test('分段重排、插入和删除后按文件定位，而非使用历史下标', () => {
    const a = episode('/主播', 'a.mp4');
    const b = episode('/主播', 'b.mp4');
    expect(findOpenListSegmentIndex([a, b], '/主播', 'b.mp4')).toBe(1);
    expect(findOpenListSegmentIndex([b, a], '/主播', 'b.mp4')).toBe(0);
    expect(findOpenListSegmentIndex([a], '/主播', 'b.mp4')).toBe(-1);
    expect(parseOpenListEpisodeUrl('https://example.test/transient.mp4')).toBeNull();
  });

  test('收藏链接携带原内容与稳定文件标识，不携带旧分集下标或直链', () => {
    const segment = { contentId: 'original-id', folder: '/主播', fileName: 'b+.mp4', title: '片段 B' };
    const url = new URL(buildOpenListSegmentPlayUrl(segment), 'https://example.test');
    expect(url.searchParams.get('id')).toBe('original-id');
    expect(url.searchParams.get('segmentFolder')).toBe(segment.folder);
    expect(url.searchParams.get('segmentFileName')).toBe(segment.fileName);
    expect(url.searchParams.has('episode')).toBe(false);
  });
});
