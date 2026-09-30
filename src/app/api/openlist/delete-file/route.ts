/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient, OpenListGetResponse } from '@/lib/openlist.client';
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

export const runtime = 'nodejs';

// 控制字符（含换行、NUL）一律拒绝
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

function jsonError(status: number, error: string, details?: string) {
  return NextResponse.json(
    details ? { error, details } : { error },
    { status }
  );
}

/** OpenList fs/get 的「不存在」错误（OpenList 以 JSON code 500 + message 表示） */
function isOpenListNotFound(message?: string): boolean {
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

function validateFileName(fileName: string): string | null {
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

/** 统计文件夹内剩余的合格分集（扩展名 + OPENLIST_MIN_VIDEO_MB，与详情接口一致） */
async function countQualifiedVideos(
  client: OpenListClient,
  folder: string
): Promise<number> {
  let count = 0;
  let page = 1;
  const perPage = 100;
  for (;;) {
    const res = await client.listDirectory(folder, page, perPage);
    if (res.code !== 200) {
      throw new Error(`列目录失败: ${res.message || res.code}`);
    }
    const content = res.data?.content || [];
    count += content.filter((item) => isQualifiedVideoFile(item)).length;
    if (content.length < perPage) break;
    page++;
  }
  return count;
}

/**
 * POST /api/openlist/delete-file
 * body: { folder, fileName }，folder/fileName 与 /api/openlist/play 的参数完全一致
 * 从 OpenList 永久删除私人影库中的单个分集文件（需 OPENLIST_ALLOW_DELETE=1，仅 owner/admin）
 */
export async function POST(request: NextRequest) {
  if (process.env.OPENLIST_ALLOW_DELETE !== '1') {
    return jsonError(404, 'Not Found');
  }

  try {
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

    let body: { folder?: unknown; fileName?: unknown } | null;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, '请求体不是有效 JSON');
    }
    const folder = typeof body?.folder === 'string' ? body.folder : '';
    const fileName = typeof body?.fileName === 'string' ? body.fileName : '';

    const fileNameError = validateFileName(fileName);
    if (fileNameError) {
      return jsonError(400, fileNameError);
    }

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

    // folder 必须是私人影库中已登记的文件夹（与详情接口生成的 folder 参数逐字相同）
    const metaInfo = await loadMetaInfo();
    const folderKey = metaInfo
      ? Object.keys(metaInfo.folders).find(
          (key) => metaInfo.folders[key]?.folderName === folder
        )
      : undefined;
    if (!folderKey) {
      return jsonError(404, '该文件夹不在私人影库中');
    }

    // 与 /api/openlist/play 完全相同的路径解析：folder 即完整路径
    const filePath = `${folder}/${fileName}`;
    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 1. 删除前确认文件存在且不是目录
    let before: OpenListGetResponse;
    try {
      before = await client.getFile(filePath);
    } catch (error) {
      return jsonError(502, '查询 OpenList 文件失败', (error as Error).message);
    }
    if (before.code !== 200) {
      if (isOpenListNotFound(before.message)) {
        return jsonError(404, '文件不存在', before.message);
      }
      return jsonError(
        502,
        '查询 OpenList 文件失败',
        `code=${before.code} ${before.message || ''}`.trim()
      );
    }
    if (!before.data || before.data.is_dir) {
      return jsonError(404, '目标不是文件');
    }

    // 2. 删除（HTTP 与 JSON code 都要检查）
    let removeResult: { code: number; message: string };
    try {
      removeResult = await client.removeEntries(folder, [fileName]);
    } catch (error) {
      return jsonError(502, 'OpenList 删除失败', (error as Error).message);
    }
    if (removeResult.code !== 200) {
      return jsonError(
        502,
        'OpenList 删除失败',
        `code=${removeResult.code} ${removeResult.message || ''}`.trim()
      );
    }

    // 3. 删除后复查（OpenList 对不存在的文件也返回 200，必须二次确认）
    let after: OpenListGetResponse;
    try {
      after = await client.getFile(filePath);
    } catch (error) {
      return jsonError(
        500,
        'OpenList 返回删除成功，但删除后复查失败',
        (error as Error).message
      );
    }
    if (after.code === 200) {
      return jsonError(
        500,
        'OpenList 返回删除成功，但文件仍然存在',
        `path=${filePath}`
      );
    }
    if (!isOpenListNotFound(after.message)) {
      return jsonError(
        500,
        'OpenList 返回删除成功，但删除后复查异常',
        `code=${after.code} ${after.message || ''}`.trim()
      );
    }

    console.log(
      `[openlist/delete-file] 审计: user=${username} role=${role} 删除 OpenList 文件 ${filePath}（OpenList=${openListConfig.URL} 账号=${openListConfig.Username}）`
    );

    // 4. 清理缓存：videoInfo（/api/openlist/detail 用 folder；/api/detail、source-detail 用 RootPath 拼接后的路径）、代理直链缓存
    const legacyRoot = openListConfig.RootPath || '/';
    invalidateVideoInfoCache(folder);
    invalidateVideoInfoCache(
      `${legacyRoot}${legacyRoot.endsWith('/') ? '' : '/'}${folder}`
    );
    invalidateOpenListProxyUrl(filePath);

    // 5. 文件夹已无合格分集时，从私人影库移除该条目（扫描不会自动剔除，文件夹本身不动）
    let remainingEpisodes: number | null = null;
    let folderRemoved = false;
    let warning: string | undefined;
    try {
      remainingEpisodes = await countQualifiedVideos(client, folder);
    } catch (error) {
      warning = `文件已删除，但统计剩余分集失败: ${(error as Error).message}`;
      console.error('[openlist/delete-file]', warning);
    }

    if (remainingEpisodes === 0) {
      try {
        const raw = await db.getGlobalValue('video.metainfo');
        if (raw) {
          const latest: MetaInfo = JSON.parse(raw);
          if (latest.folders[folderKey]?.folderName === folder) {
            delete latest.folders[folderKey];
            await db.setGlobalValue('video.metainfo', JSON.stringify(latest));
            invalidateMetaInfoCache();
            setCachedMetaInfo(latest);
            if (config.OpenListConfig) {
              config.OpenListConfig.ResourceCount = Object.keys(
                latest.folders
              ).length;
              await db.saveAdminConfig(config);
            }
            folderRemoved = true;
            console.log(
              `[openlist/delete-file] 审计: user=${username} 文件夹 ${folder} 已无分集，已从私人影库移除条目 key=${folderKey}`
            );
          }
        }
      } catch (error) {
        warning = `文件已删除，但移除私人影库空条目失败: ${(error as Error).message}`;
        console.error('[openlist/delete-file]', warning);
      }
    }

    return NextResponse.json({
      success: true,
      deleted: filePath,
      remainingEpisodes,
      folderRemoved,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error('[openlist/delete-file] 删除失败:', error);
    return jsonError(500, '删除失败', (error as Error).message);
  }
}
