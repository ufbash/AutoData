ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE client_briefs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE client_briefs ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at);
CREATE INDEX IF NOT EXISTS idx_client_briefs_deleted_at ON client_briefs(deleted_at);
