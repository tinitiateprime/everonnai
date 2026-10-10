CREATE TABLE everonn_platform.build_reviews (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,build_id uuid NOT NULL,
 seal_sha256 text NOT NULL CHECK(seal_sha256 ~ '^[a-f0-9]{64}$'),
 request_key uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('approved','changes_requested')),
 notes text NOT NULL CHECK(length(notes) BETWEEN 10 AND 5000),
 checklist jsonb NOT NULL,reviewer_id uuid NOT NULL REFERENCES everonn_platform.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),UNIQUE(build_id,request_key),
 FOREIGN KEY(tenant_id,project_id,build_id) REFERENCES everonn_platform.website_builds(tenant_id,project_id,id)
);
ALTER TABLE everonn_platform.build_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE everonn_platform.build_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON everonn_platform.build_reviews FOR SELECT USING (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND everonn_platform.project_permission(tenant_id,project_id,'view'));
CREATE POLICY scoped_insert ON everonn_platform.build_reviews FOR INSERT WITH CHECK (
 tenant_id=NULLIF(current_setting('everonn.tenant_id',true),'')::uuid AND project_id=NULLIF(current_setting('everonn.project_id',true),'')::uuid
 AND reviewer_id=everonn_platform.actor_id() AND everonn_platform.project_permission(tenant_id,project_id,'review')
 AND EXISTS(SELECT 1 FROM everonn_platform.website_builds b WHERE b.id=build_id AND b.seal_sha256=build_reviews.seal_sha256 AND b.status='ready'));
GRANT SELECT,INSERT ON everonn_platform.build_reviews TO everonn_platform_app;
CREATE TRIGGER immutable_review BEFORE UPDATE OR DELETE ON everonn_platform.build_reviews FOR EACH ROW EXECUTE FUNCTION everonn_platform.reject_evidence_mutation();
-- Reviewers may record the review audit without receiving edit/publish access.
CREATE POLICY review_audit_insert ON everonn_platform.audit_events FOR INSERT WITH CHECK (
 actor_id=everonn_platform.actor_id() AND action='build.reviewed'
 AND project_id IS NOT NULL AND everonn_platform.project_permission(tenant_id,project_id,'review')
 AND EXISTS(SELECT 1 FROM everonn_platform.build_reviews r WHERE r.id=subject_id AND r.reviewer_id=everonn_platform.actor_id()));
CREATE INDEX reviews_build_time ON everonn_platform.build_reviews(build_id,created_at DESC,id DESC);
