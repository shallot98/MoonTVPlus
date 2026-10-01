-- 分段收藏的稳定文件定位信息；旧收藏保持 NULL。
ALTER TABLE favorites ADD COLUMN segment_json TEXT;
