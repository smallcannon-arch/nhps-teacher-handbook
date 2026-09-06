CREATE TABLE IF NOT EXISTS feedback_reports (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  title TEXT NOT NULL,
  office TEXT NOT NULL,
  links_json TEXT NOT NULL,
  issue TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('待處理', '處理中', '已完成')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback_reports(status);
