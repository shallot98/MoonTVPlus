/* eslint-disable no-console */

/**
 * 私人影库列表快照（sessionStorage）：离开列表页前保存已加载的分页、筛选与滚动位置，
 * 返回时先用快照渲染并恢复滚动，避免无限滚动已加载内容丢失、回到顶部。
 *
 * key 按来源（URL 的 source 参数）区分；OpenList 分类等筛选不在 URL 里，存在快照内并一起恢复。
 */

const SNAPSHOT_PREFIX = 'moontv:private-library:snapshot:v1:';
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export interface PrivateLibrarySnapshot<TVideo = unknown> {
  savedAt: number;
  sourceType: string;
  embyKey?: string;
  selectedView: string;
  sortBy: string;
  sortOrder: 'Ascending' | 'Descending';
  openlistCategory: string;
  openlistCategories: string[];
  videos: TVideo[];
  /** 已完整加载的页数 */
  page: number;
  hasMore: boolean;
  scrollTop: number;
}

function storageKey(sourceKey: string): string {
  return `${SNAPSHOT_PREFIX}${sourceKey}`;
}

export function readPrivateLibrarySnapshot<TVideo>(
  sourceKey: string
): PrivateLibrarySnapshot<TVideo> | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(sourceKey));
    if (!raw) return null;
    const snap = JSON.parse(raw) as PrivateLibrarySnapshot<TVideo>;
    if (
      !snap ||
      typeof snap.savedAt !== 'number' ||
      Date.now() - snap.savedAt > SNAPSHOT_TTL_MS ||
      !Array.isArray(snap.videos) ||
      snap.videos.length === 0 ||
      typeof snap.page !== 'number' ||
      snap.page < 1
    ) {
      window.sessionStorage.removeItem(storageKey(sourceKey));
      return null;
    }
    return snap;
  } catch (err) {
    console.warn('[private-library] 读取列表快照失败:', err);
    return null;
  }
}

export function writePrivateLibrarySnapshot<TVideo>(
  sourceKey: string,
  snap: PrivateLibrarySnapshot<TVideo>
): void {
  try {
    window.sessionStorage.setItem(storageKey(sourceKey), JSON.stringify(snap));
  } catch (err) {
    console.warn('[private-library] 保存列表快照失败:', err);
  }
}

/** 列表内容已变化（如删除了文件夹）时清除所有快照，下次进入重新加载 */
export function clearPrivateLibrarySnapshots(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(SNAPSHOT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (err) {
    console.warn('[private-library] 清除列表快照失败:', err);
  }
}
