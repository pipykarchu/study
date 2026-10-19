CREATE TABLE IF NOT EXISTS membership_bridge_state (
  id TEXT PRIMARY KEY,
  status_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS membership_bridge_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  conversation_id TEXT,
  lease_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS membership_jobs_queue ON membership_bridge_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS membership_jobs_owner ON membership_bridge_jobs(owner_id, role_id, profile_id);
CREATE TABLE IF NOT EXISTS membership_bridge_events (
  job_id TEXT NOT NULL REFERENCES membership_bridge_jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY(job_id, seq)
);
CREATE TABLE IF NOT EXISTS membership_bridge_tools (
  job_id TEXT NOT NULL REFERENCES membership_bridge_jobs(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  result_json TEXT,
  PRIMARY KEY(job_id, call_id)
);
