export interface OpenListSegmentFavorite {
  contentId: string;
  folder: string;
  fileName: string;
  title: string;
}

/** 与 OpenList 播放接口使用相同的路径解码，不保存会过期的直链或不稳定的分集下标。 */
export function parseOpenListEpisodeUrl(url?: string): { folder: string; fileName: string } | null {
  if (!url?.startsWith('/api/openlist/play?')) return null;
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const folder = params.get('folder');
  const fileName = params.get('fileName');
  return folder && fileName ? { folder, fileName } : null;
}

export function makeOpenListSegmentFavoriteId(folder: string, fileName: string): string {
  // encodeURIComponent 会转义 +，兼容现有 source+id 存储键的解析。
  return `segment-v1:${encodeURIComponent(JSON.stringify([folder, fileName]))}`;
}

export function findOpenListSegmentIndex(episodes: string[], folder: string, fileName: string): number {
  return episodes.findIndex((url) => {
    const segment = parseOpenListEpisodeUrl(url);
    return segment?.folder === folder && segment.fileName === fileName;
  });
}

export function buildOpenListSegmentPlayUrl(segment: OpenListSegmentFavorite): string {
  const params = new URLSearchParams({
    source: 'openlist',
    id: segment.contentId,
    segmentFolder: segment.folder,
    segmentFileName: segment.fileName,
  });
  return `/play?${params}`;
}
