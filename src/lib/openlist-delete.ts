/* eslint-disable no-console */

/**
 * 私人影库（OpenList）删除接口的公共逻辑：
 * /api/openlist/delete-file（删除单个分段）与 /api/openlist/delete-broadcast（删除整场）共用，
 * 保证开关、鉴权、CSRF、参数校验、缓存清理、空条目移除完全一致。
 */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  invalidateVideoInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import {
  isQualifiedVideoFile,
  OPENLIST_VIDEO_EXTENSIONS,
} from '@/lib/openlist-env-options';
import { normalizeOpenListPath } from '@/lib/openlist-path-meta';
import { invalidateOpenListProxyUrl } from '@/lib/openlist-proxy-cache';
import { requireFeaturePermission } from '@/lib/permissions';

// 控制字符（含换行、NUL）一律拒绝
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export function jsonError(status: number, error: string, details?: string) {
  return NextResponse.json(details ? { error, details } : { error }, {
    status,
  });
}

/** 删除功能总开关（未开启时接口一律 404） */
export function isOpenListDeleteEnabled(): boolean {
  return process.env.OPENLIST_ALLOW_DELETE === '1';
}

/** OpenList fs/get 的「不存在」错误（OpenList 以 JSON code 500 + message 表示） */
export function isOpenListNotFound(message?: string): boolean {
  return /not found|不存在/i.test(message || '');
}

/**
 * CSRF：必须是 JSON 请求，且 Origin 的 host 与本站 host（x-forwarded-host 或 host）一致
 */
function checkCsrf(request: NextRequest): string | null {
  const contentType = (request.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    return 'Content-Type 必须为 application/json';
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return '缺少 Origin 头';
  }

  let originHost = '';
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return 'Origin 头无效';
  }

  const forwardedHost = (request.headers.get('x-forwarded-host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = (request.headers.get('host') || '').trim().toLowerCase();

  if (!originHost || (originHost !== forwardedHost && originHost !== host)) {
    return 'Origin 与站点不一致';
  }
  return null;
}

/** 与 /api/admin/* 一致：USERNAME 为 owner；其余用户需数据库角色为 admin 且未封禁 */
async function resolvePrivilegedRole(
  username: string
): Promise<'owner' | 'admin' | null> {
  if (username === process.env.USERNAME) {
    return 'owner';
  }
  const userInfo = await db.getUserInfoV2(username);
  if (userInfo && userInfo.role === 'admin' && !userInfo.banned) {
    return 'admin';
  }
  return null;
}

export function validateFileName(fileName: string): string | null {
  if (!fileName) return '缺少 fileName';
  if (fileName.includes('/') || fileName.includes('\\')) {
    return 'fileName 不能包含路径分隔符';
  }
  if (fileName === '.' || fileName === '..' || fileName.startsWith('.')) {
    return 'fileName 无效';
  }
  if (CONTROL_CHARS_RE.test(fileName)) {
    return 'fileName 包含非法字符';
  }
  const lower = fileName.toLowerCase();
  if (!OPENLIST_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'fileName 不是视频文件';
  }
  return null;
}

function validateFolder(folder: string, rootPaths: string[]): string | null {
  if (!folder) return '缺少 folder';
  if (!folder.startsWith('/')) return 'folder 必须为绝对路径';
  if (folder.includes('\\') || CONTROL_CHARS_RE.test(folder)) {
    return 'folder 包含非法字符';
  }
  const segments = folder.split('/').slice(1);
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return 'folder 路径无效（不允许 . / .. / 空段）';
  }

  // 必须位于某个已配置根目录之下（不允许是根目录本身）
  const inRoot = rootPaths.some((root) => {
    if (!root) return false;
    const prefix = root === '/' ? '/' : `${root}/`;
    return folder !== root && folder.startsWith(prefix);
  });
  if (!inRoot) {
    return 'folder 不在已配置的 OpenList 根目录内';
  }
  return null;
}

async function loadMetaInfo(): Promise<MetaInfo | null> {
  const cached = getCachedMetaInfo();
  if (cached) return cached;
  const raw = await db.getGlobalValue('video.metainfo');
  if (!raw) return null;
  const parsed: MetaInfo = JSON.parse(raw);
  setCachedMetaInfo(parsed);
  return parsed;
}

export interface DeleteAuthInfo {
  username: string;
  role: 'owner' | 'admin';
}

/**
 * 登录（401）→ CSRF（403）→ 存储模式（403）→ owner/admin（403）→ private_library 权限。
 * 失败时返回可直接响应的 NextResponse。
 */
export async function authorizeOpenListDelete(
  request: NextRequest
): Promise<DeleteAuthInfo | NextResponse> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return jsonError(401, '未授权');
  }
  const username = authInfo.username;

  const csrfError = checkCsrf(request);
  if (csrfError) {
    return jsonError(403, csrfError);
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return jsonError(403, '本地存储模式不支持删除');
  }

  const role = await resolvePrivilegedRole(username);
  if (!role) {
    return jsonError(403, '仅站长或管理员可删除文件');
  }

  const permission = await requireFeaturePermission(
    request,
    'private_library',
    '无权限访问私人影库'
  );
  if (permission instanceof NextResponse) return permission;

  return { username, role };
}

export interface DeleteFolderContext {
  config: AdminConfig;
  openListConfig: NonNullable<AdminConfig['OpenListConfig']>;
  /** metainfo 中该文件夹的 key */
  folderKey: string;
  client: OpenListClient;
}

/**
 * OpenList 配置检查 + folder 校验（在已配置根目录内，且为私人影库已登记的文件夹）。
 * folder 与 /api/openlist/play 的参数逐字相同（即完整 OpenList 路径）。
 */
export async function resolveDeleteFolder(
  folder: string
): Promise<DeleteFolderContext | NextResponse> {
  const config = await getConfig();
  const openListConfig = config.OpenListConfig;
  if (
    !openListConfig ||
    !openListConfig.Enabled ||
    !openListConfig.URL ||
    !openListConfig.Username ||
    !openListConfig.Password
  ) {
    return jsonError(400, 'OpenList 未配置或未启用');
  }

  const rootPaths = (
    openListConfig.RootPaths && openListConfig.RootPaths.length > 0
      ? openListConfig.RootPaths
      : [openListConfig.RootPath || '/']
  )
    .map(normalizeOpenListPath)
    .filter(Boolean);

  const folderError = validateFolder(folder, rootPaths);
  if (folderError) {
    return jsonError(400, folderError);
  }

  const metaInfo = await loadMetaInfo();
  const folderKey = metaInfo
    ? Object.keys(metaInfo.folders).find(
        (key) => metaInfo.folders[key]?.folderName === folder
      )
    : undefined;
  if (!folderKey) {
    return jsonError(404, '该文件夹不在私人影库中');
  }

  const client = new OpenListClient(
    openListConfig.URL,
    openListConfig.Username,
    openListConfig.Password
  );
  return { config, openListConfig, folderKey, client };
}

/** 文件夹内的合格分集（扩展名 + OPENLIST_MIN_VIDEO_MB，与详情接口一致），全量分页 */
export async function listQualifiedVideos(
  client: OpenListClient,
  folder: string
): Promise<{ name: string; size: number }[]> {
  const result: { name: string; size: number }[] = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const res = await client.listDirectory(folder, page, perPage);
    if (res.code !== 200) {
      throw new Error(`列目录失败: ${res.message || res.code}`);
    }
    const content = res.data?.content || [];
    for (const item of content) {
      if (isQualifiedVideoFile(item)) {
        result.push({ name: item.name, size: item.size || 0 });
      }
    }
    if (content.length < perPage) break;
    page++;
  }
  return result;
}

/**
 * 清理缓存：videoInfo（/api/openlist/detail 用 folder；/api/detail、source-detail 用 RootPath 拼接后的路径）、代理直链缓存
 */
export function invalidateDeletedFileCaches(
  ctx: DeleteFolderContext,
  folder: string,
  filePaths: string[]
) {
  const legacyRoot = ctx.openListConfig.RootPath || '/';
  invalidateVideoInfoCache(folder);
  invalidateVideoInfoCache(
    `${legacyRoot}${legacyRoot.endsWith('/') ? '' : '/'}${folder}`
  );
  for (const filePath of filePaths) {
    invalidateOpenListProxyUrl(filePath);
  }
}

/**
 * 文件夹已无合格分集时，从私人影库移除该条目（扫描不会自动剔除，文件夹本身不动）。
 * 失败不影响已完成的删除，只以 warning 返回。
 */
export async function removeFolderIfEmpty(
  ctx: DeleteFolderContext,
  folder: string,
  auth: DeleteAuthInfo,
  logTag: string
): Promise<{
  remainingEpisodes: number | null;
  folderRemoved: boolean;
  warning?: string;
}> {
  let remainingEpisodes: number | null = null;
  let folderRemoved = false;
  let warning: string | undefined;
  try {
    remainingEpisodes = (await listQualifiedVideos(ctx.client, folder)).length;
  } catch (error) {
    warning = `文件已删除，但统计剩余分集失败: ${(error as Error).message}`;
    console.error(`[${logTag}]`, warning);
  }

  if (remainingEpisodes === 0) {
    try {
      const raw = await db.getGlobalValue('video.metainfo');
      if (raw) {
        const latest: MetaInfo = JSON.parse(raw);
        if (latest.folders[ctx.folderKey]?.folderName === folder) {
          delete latest.folders[ctx.folderKey];
          await db.setGlobalValue('video.metainfo', JSON.stringify(latest));
          invalidateMetaInfoCache();
          setCachedMetaInfo(latest);
          if (ctx.config.OpenListConfig) {
            ctx.config.OpenListConfig.ResourceCount = Object.keys(
              latest.folders
            ).length;
            await db.saveAdminConfig(ctx.config);
          }
          folderRemoved = true;
          console.log(
            `[${logTag}] 审计: user=${auth.username} 文件夹 ${folder} 已无分集，已从私人影库移除条目 key=${ctx.folderKey}`
          );
        }
      }
    } catch (error) {
      warning = `文件已删除，但移除私人影库空条目失败: ${(error as Error).message}`;
      console.error(`[${logTag}]`, warning);
    }
  }

  return { remainingEpisodes, folderRemoved, ...(warning ? { warning } : {}) };
}
