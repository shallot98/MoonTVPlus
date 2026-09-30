import type { EpisodeBroadcastGroup } from '@/lib/types';

/** ISO（带偏移）取字面上的日期与时分，与文件名里的本地时间保持一致 */
function parseIsoWallClock(iso: string | null | undefined) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, md: `${m[2]}-${m[3]}`, hm: `${m[4]}:${m[5]}` };
}

export function formatBroadcastDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分`;
}

/** 整场时间范围：`MM-DD HH:MM–HH:MM`（跨天 `次日HH:MM`）；无法解析时返回空串 */
export function formatBroadcastRange(
  group: Pick<EpisodeBroadcastGroup, 'start' | 'end'>
): string {
  const start = parseIsoWallClock(group.start);
  const end = parseIsoWallClock(group.end);
  if (!start) return '';
  let range = `${start.md} ${start.hm}`;
  if (end) {
    if (end.date === start.date) {
      range += `–${end.hm}`;
    } else {
      const nextDay = new Date(`${start.date}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      range +=
        nextDay.toISOString().slice(0, 10) === end.date
          ? `–次日${end.hm}`
          : `–${end.md} ${end.hm}`;
    }
  }
  return range;
}

/** 整场总时长文字（partial_estimated 加「约」）；未知返回空串 */
export function formatBroadcastTotalDuration(
  group: Pick<EpisodeBroadcastGroup, 'dur' | 'state'>
): string {
  if (typeof group.dur !== 'number' || group.dur <= 0) return '';
  return `${group.state === 'partial_estimated' ? '约' : ''}${formatBroadcastDuration(group.dur)}`;
}

/** 整场框头：`MM-DD HH:MM–HH:MM · N 段 · X小时Y分` */
export function formatBroadcastHeader(group: EpisodeBroadcastGroup): string {
  const parts: string[] = [];
  const range = formatBroadcastRange(group);
  if (range) parts.push(range);
  parts.push(`${group.segs} 段`);
  const dur = formatBroadcastTotalDuration(group);
  if (dur) parts.push(dur);
  return parts.join(' · ');
}
