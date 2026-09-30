/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { OpenListGetResponse } from '@/lib/openlist.client';
import {
  authorizeOpenListDelete,
  invalidateDeletedFileCaches,
  isOpenListDeleteEnabled,
  isOpenListNotFound,
  jsonError,
  removeFolderIfEmpty,
  resolveDeleteFolder,
  validateFileName,
} from '@/lib/openlist-delete';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/delete-file
 * body: { folder, fileName }，folder/fileName 与 /api/openlist/play 的参数完全一致
 * 从 OpenList 永久删除私人影库中的单个分集文件（需 OPENLIST_ALLOW_DELETE=1，仅 owner/admin）
 */
export async function POST(request: NextRequest) {
  if (!isOpenListDeleteEnabled()) {
    return jsonError(404, 'Not Found');
  }

  try {
    const auth = await authorizeOpenListDelete(request);
    if (auth instanceof NextResponse) return auth;

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

    const ctx = await resolveDeleteFolder(folder);
    if (ctx instanceof NextResponse) return ctx;
    const { client, openListConfig } = ctx;

    // 与 /api/openlist/play 完全相同的路径解析：folder 即完整路径
    const filePath = `${folder}/${fileName}`;

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
      `[openlist/delete-file] 审计: user=${auth.username} role=${auth.role} 删除 OpenList 文件 ${filePath}（OpenList=${openListConfig.URL} 账号=${openListConfig.Username}）`
    );

    // 4. 清理缓存
    invalidateDeletedFileCaches(ctx, folder, [filePath]);

    // 5. 文件夹已无合格分集时，从私人影库移除该条目
    const { remainingEpisodes, folderRemoved, warning } =
      await removeFolderIfEmpty(ctx, folder, auth, 'openlist/delete-file');

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
