export const captureDraftsSql = `
CREATE TABLE capture_drafts (
  slot TEXT PRIMARY KEY NOT NULL,
  content_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX action_logs_action_id ON action_logs(json_extract(proposal_json, '$.actionId')) WHERE json_valid(proposal_json);
`;
