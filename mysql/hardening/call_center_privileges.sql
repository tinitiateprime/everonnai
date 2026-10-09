-- Optional DBA hardening for the Live Agent Desk schema. Run as an
-- administrator after the migration; replace the account names and hosts.

-- Runtime account: may read and write desk tables, but can only append to the
-- audit log and usage meter (HIL-011, SEC-009, BIL-004).
CREATE USER IF NOT EXISTS 'everonn_desk_app'@'%' IDENTIFIED BY 'replace-with-a-generated-secret';
GRANT SELECT, INSERT ON everonn_call_center.* TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.tenants TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.client_desk_profiles TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.greeting_scripts TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.operators TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.operator_client_grants TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.operator_presence TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.operator_shifts TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.contacts TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.conversations TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.requests TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.escalations TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.call_offers TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.desk_handlings TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.approvals TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.tasks TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.unresolved_line_incidents TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.outbox_events TO 'everonn_desk_app'@'%';
GRANT UPDATE ON everonn_call_center.audit_chain_head TO 'everonn_desk_app'@'%';
GRANT DELETE ON everonn_call_center.idempotency_keys TO 'everonn_desk_app'@'%';
-- audit_log and usage_events intentionally keep only SELECT and INSERT.

-- Optional triggers (requires SUPER, or log_bin_trust_function_creators=1).
-- CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON everonn_call_center.audit_log FOR EACH ROW
--   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
-- CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON everonn_call_center.audit_log FOR EACH ROW
--   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
