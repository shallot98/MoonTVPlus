/**
 * 私人影库（OpenList）相关的环境变量开关
 *
 * - OPENLIST_SKIP_TMDB=1：扫描时不调用 TMDB，直接以文件夹名入库（无 TMDB Key 时自动生效）
 * - OPENLIST_POSTER_URL_TEMPLATE：跳过 TMDB 时的海报 URL 模板，{name} 替换为 encodeURIComponent(文件夹名)
 * - OPENLIST_EPISODE_TITLE_FROM_FILENAME=1：分集标题取文件名，并按文件名字典序排序
 * - OPENLIST_MIN_VIDEO_MB：小于该大小（MB）的视频文件不计入分集，默认 0 不过滤
 */

export function isOpenListSkipTMDB(tmdbApiKey?: string): boolean {
  return process.env.OPENLIST_SKIP_TMDB === '1' || !tmdbApiKey;
}

export function buildOpenListPosterUrl(folderName: string): string | null {
  const template = process.env.OPENLIST_POSTER_URL_TEMPLATE;
  if (!template) return null;
  return template.split('{name}').join(encodeURIComponent(folderName));
}

export function isEpisodeTitleFromFilename(): boolean {
  return process.env.OPENLIST_EPISODE_TITLE_FROM_FILENAME === '1';
}

const RECORDING_NAME_RE =
  /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-\d{2}\]\[[^\]]*\]\[(.*)\](\d{3})?$/;

/**
 * 由文件名生成分集标题：去扩展名；
 * 录播格式 `[YYYY-MM-DD HH-MM-SS][主播][标题]NNN` 美化为 `MM-DD HH:MM 标题 Pn`
 */
export function formatFilenameEpisodeTitle(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const m = base.match(RECORDING_NAME_RE);
  if (!m) return base;
  const [, , month, day, hour, minute, title, part] = m;
  let result = `${month}-${day} ${hour}:${minute} ${title}`;
  if (part) result += ` P${parseInt(part, 10)}`;
  return result;
}

/** 文件名字典序（按码点，不受 locale 影响） */
export function compareFileName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * OPENLIST_EPISODE_TITLE_FROM_FILENAME=1 时的分集列表：
 * 按文件名字典序升序（录播文件名以时间开头即时间顺序，新文件追加在末尾），标题取文件名
 */
export function buildFilenameEpisodes<T extends { name: string; size?: number }>(
  files: T[]
) {
  return [...files]
    .sort((a, b) => compareFileName(a.name, b.name))
    .map((file, index) => ({
      fileName: file.name,
      episode: index + 1,
      season: undefined as number | undefined,
      title: formatFilenameEpisodeTitle(file.name),
      size: file.size,
      isOVA: false as boolean | undefined,
    }));
}
