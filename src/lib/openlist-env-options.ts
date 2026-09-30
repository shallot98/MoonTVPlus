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
